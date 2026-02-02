from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import xarray as xr
import numpy as np
import struct
from functools import lru_cache
import time as time_module
from shapely.geometry import shape, Point
from shapely.prepared import prep

app = Flask(__name__)
CORS(app)

BASE_URL_TEMPLATE = "http://202.90.199.129:1980/dods/inarcm/{period}/SRF_{period}"

# SRF data is 6-hourly (4 time steps per day), need to aggregate for daily view
TIME_STEPS_PER_DAY = 4

# Available periods
AVAILABLE_PERIODS = [
    '202412', '202501', '202502', '202503', '202504', '202505', 
    '202506', '202507', '202508', '202509', '202510', '202511', 
    '202512', '202601'
]

# Reference period with proper ocean masking
REFERENCE_PERIOD = '202508'

# Cache for land mask - stores masks for different subsample values
_land_mask_cache = {}

# Cache for open dataset connections (avoids repeated metadata fetches)
_dataset_cache = {}

def get_dataset(period):
    """Cache open dataset connections to avoid repeated metadata fetches"""
    global _dataset_cache
    
    if period in _dataset_cache:
        return _dataset_cache[period]
    
    url = BASE_URL_TEMPLATE.format(period=period)
    print(f"📂 Opening new dataset connection for {period}...")
    ds = xr.open_dataset(url, engine="netcdf4")
    
    # Debug: print available variables
    print(f"📋 Available variables in {period}: {list(ds.data_vars)}")
    
    _dataset_cache[period] = ds
    return ds

def get_land_mask(subsample=2):
    """Get land mask from reference dataset (202508 has proper ocean masking)
    Caches masks for different subsample values separately.
    """
    global _land_mask_cache
    
    # Check if we have this subsample cached
    if subsample in _land_mask_cache:
        return _land_mask_cache[subsample]
    
    try:
        print(f"🗺️ Loading land mask for subsample={subsample}...")
        url = BASE_URL_TEMPLATE.format(period=REFERENCE_PERIOD)
        ds = xr.open_dataset(url, engine="netcdf4")
        
        # Get first time step from reference data
        pr_data = ds['pr'].isel(time=0)
        
        # Subsample to match
        pr_subsampled = pr_data.isel(lat=slice(None, None, subsample), 
                                      lon=slice(None, None, subsample))
        
        # Values that are not fill values are land
        # SRF uses POSITIVE fill value 9.96921E36, old dataset used negative -9.0E33
        values = pr_subsampled.values
        land_mask = (values > -1e30) & (values < 1e30) & (values >= 0)
        
        ds.close()
        
        # Cache this subsample's mask
        _land_mask_cache[subsample] = land_mask
        print(f"✅ Land mask cached for subsample={subsample}: {np.sum(land_mask)} land pixels out of {land_mask.size}")
        
        return land_mask
    except Exception as e:
        print(f"Error loading land mask: {e}")
        return None


# Cache for processed precipitation data (maxsize=500 for more time steps)
@lru_cache(maxsize=500)
def get_cached_precip_data(period, day_index, subsample, apply_mask=False):
    """Cache processed precipitation data to avoid re-reading NetCDF files.
    
    Note: day_index is the DAY number (0 = first day), not the raw time index.
    SRF data has 4 time steps per day (6-hourly), so we average them.
    """
    t_start = time_module.time()
    timings = {}
    
    # 1. Get cached dataset (HUGE speedup - reuses connection!)
    t1 = time_module.time()
    ds = get_dataset(period)  # ← Uses cached connection instead of opening new one
    timings['open_dataset'] = (time_module.time() - t1) * 1000
    
    # 2. Get bounds from full dataset
    t2 = time_module.time()
    full_lats = ds['lat'].values
    full_lons = ds['lon'].values
    bounds = (
        float(np.min(full_lats)), float(np.max(full_lats)),
        float(np.min(full_lons)), float(np.max(full_lons))
    )
    timings['get_bounds'] = (time_module.time() - t2) * 1000
    
    # 3. Get data for specific DAY (average all 4 time steps)
    t3 = time_module.time()
    
    # Check if 'pr' variable exists, if not list available variables
    if 'pr' not in ds.data_vars:
        available = list(ds.data_vars)
        print(f"⚠️ WARNING: 'pr' not found! Available variables: {available}")
        raise ValueError(f"Variable 'pr' not found. Available: {available}")
    
    # Calculate raw time indices for this day
    total_raw_times = len(ds.time)
    total_days = total_raw_times // TIME_STEPS_PER_DAY
    
    start_time_idx = day_index * TIME_STEPS_PER_DAY
    end_time_idx = min(start_time_idx + TIME_STEPS_PER_DAY, total_raw_times)
    
    print(f"📊 Reading 'pr' for day {day_index}: time indices {start_time_idx} to {end_time_idx-1}")
    
    # Average all time steps for this day, tracking valid data mask
    daily_sum = None
    valid_count = None  # Track how many valid readings per pixel
    count = 0
    
    for t_idx in range(start_time_idx, end_time_idx):
        pr_data = ds['pr'].isel(time=t_idx)
        
        pr_subsampled = pr_data.isel(lat=slice(None, None, subsample), 
                                      lon=slice(None, None, subsample))
        
        raw_values = pr_subsampled.values
        
        # SRF dataset uses POSITIVE fill value 9.96921E36
        # Create mask for VALID data (not fill values)
        valid_mask = (raw_values > -1e30) & (raw_values < 1e30) & (raw_values >= 0)
        
        # SRF precipitation is in kg/m²/s, convert to mm/day
        # Set fill values to 0 temporarily for summing
        values = np.where(valid_mask, raw_values * 86400, 0).astype(np.float32)
        
        if daily_sum is None:
            daily_sum = values
            valid_count = valid_mask.astype(np.float32)
            lats = pr_subsampled.lat.values
            lons = pr_subsampled.lon.values
        else:
            daily_sum += values
            valid_count += valid_mask.astype(np.float32)
        count += 1
    
    # Calculate daily average only where we have valid data
    # Avoid division by zero
    safe_count = np.where(valid_count > 0, valid_count, 1)
    values = (daily_sum / safe_count).astype(np.float32)
    
    # Mark pixels with NO valid data as -999 (transparent)
    # Pixels with valid data (including 0 precipitation) are kept
    values = np.where(valid_count > 0, values, -999).astype(np.float32)
    
    timings['select_data'] = (time_module.time() - t3) * 1000
    
    # 4. Process values (skip - already done above)
    t4 = time_module.time()
    timings['to_numpy'] = (time_module.time() - t4) * 1000
    
    # 5. Process values (skip - already done above)
    t5 = time_module.time()
    timings['nan_to_num'] = (time_module.time() - t5) * 1000
    
    # 6. Apply land mask (only if requested)
    t6 = time_module.time()
    if apply_mask:
        land_mask = get_land_mask(subsample)
        if land_mask is not None and land_mask.shape == values.shape:
            values = np.where(land_mask, values, -999).astype(np.float32)
            print(f"🗺️ Applied ocean mask")
    timings['land_mask'] = (time_module.time() - t6) * 1000
    
    # 7. Get coordinates
    t7 = time_module.time()
    if len(lats) > 1:
        lat_min, lat_max = float(lats[0]), float(lats[-1])
        lats = np.linspace(lat_min, lat_max, len(lats)).astype(np.float32)
    
    if len(lons) > 1:
        lon_min, lon_max = float(lons[0]), float(lons[-1])
        lons = np.linspace(lon_min, lon_max, len(lons)).astype(np.float32)
    timings['coords'] = (time_module.time() - t7) * 1000
    
    # 8. Calculate stats
    t8 = time_module.time()
    valid_values = values[values != -999]
    stats = (
        0.0,  # min
        100.0,  # max
        float(np.mean(valid_values)) if len(valid_values) > 0 else 0.0,
        float(np.min(valid_values)) if len(valid_values) > 0 else 0.0,
        float(np.max(valid_values)) if len(valid_values) > 0 else 0.0
    )
    timings['stats'] = (time_module.time() - t8) * 1000
    
    # Log data quality info
    if len(valid_values) > 0:
        actual_min = float(np.min(valid_values))
        actual_max = float(np.max(valid_values))
        actual_mean = float(np.mean(valid_values))
        print(f"📈 Day {day_index}: min={actual_min:.1f}, max={actual_max:.1f}, mean={actual_mean:.1f} mm/day")
        if actual_max > 200:
            print(f"⚠️  HIGH RAINFALL DETECTED: max={actual_max:.1f} mm/day")
    
    # DON'T close dataset - keep connection alive for reuse!
    
    timings['total'] = (time_module.time() - t_start) * 1000
    
    # Print detailed timing breakdown
    print(f"\n⏱️ TIMING for {period}/day{day_index} (subsample={subsample}):")
    print(f"  📂 open_dataset:  {timings['open_dataset']:>7.0f}ms")
    print(f"  📍 get_bounds:    {timings['get_bounds']:>7.0f}ms")
    print(f"  🔍 select_data:   {timings['select_data']:>7.0f}ms  ← {count} time steps averaged")
    print(f"  🗺️  land_mask:     {timings['land_mask']:>7.0f}ms")
    print(f"  📐 coords:        {timings['coords']:>7.0f}ms")
    print(f"  📈 stats:         {timings['stats']:>7.0f}ms")
    print(f"  ─────────────────────────")
    print(f"  ⏱️  TOTAL:         {timings['total']:>7.0f}ms\n")
    
    return {
        'lats': lats,
        'lons': lons,
        'values': values,
        'bounds': bounds,
        'stats': stats,
        'total_days': total_days  # Return DAYS, not raw time steps
    }


@app.route('/', methods=['GET'])
def index():
    return jsonify({
        'message': 'Precipitation API (SRF - Non-corrected)',
        'endpoints': {
            '/api/precipitation': {
                'method': 'GET',
                'params': {
                    'period': f'Period YYYYMM (options: {", ".join(AVAILABLE_PERIODS)})',
                    'time': 'Time index (default: 0)',
                    'masked': 'Apply ocean mask (default: false)'
                },
                'description': 'Get precipitation data for a specific time'
            },
            '/api/precipitation/binary': {
                'method': 'GET',
                'params': {
                    'period': f'Period YYYYMM (options: {", ".join(AVAILABLE_PERIODS)})',
                    'time': 'Time index (default: 0)',
                    'masked': 'Apply ocean mask (default: false)'
                },
                'description': 'Get precipitation data in binary format (faster)'
            },
            '/api/times': {
                'method': 'GET',
                'params': {
                    'period': f'Period YYYYMM (options: {", ".join(AVAILABLE_PERIODS)})'
                },
                'description': 'Get list of available times'
            },
            '/api/periods': {
                'method': 'GET',
                'description': 'Get list of available periods'
            },
            '/api/timeseries': {
                'method': 'GET',
                'params': {
                    'lat': 'Latitude',
                    'lon': 'Longitude',
                    'period': f'Period YYYYMM (default: 202601)',
                    'mode': 'Aggregation mode: day, 10day, monthly (default: day)'
                },
                'description': 'Get precipitation time series for a location'
            }
        }
    })

@app.route('/api/periods', methods=['GET'])
def get_periods():
    return jsonify({'periods': AVAILABLE_PERIODS})

@app.route('/api/precipitation', methods=['GET'])
def get_precipitation():
    try:
        # Get parameters
        period = request.args.get('period', '202601')
        time_index = int(request.args.get('time', 0))
        subsample = 2  # Fixed subsample rate
        apply_mask = request.args.get('masked', 'false').lower() == 'true'  # Default: no mask
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Build URL
        url = BASE_URL_TEMPLATE.format(period=period)
        
        # Open dataset
        ds = xr.open_dataset(url, engine="netcdf4")
        
        # Get ACTUAL bounds from FULL dataset (before subsampling)
        full_lats = ds['lat'].values
        full_lons = ds['lon'].values
        actual_bounds = {
            'minLat': float(np.min(full_lats)),
            'maxLat': float(np.max(full_lats)),
            'minLon': float(np.min(full_lons)),
            'maxLon': float(np.max(full_lons))
        }
        
        # Get data for specific time - ENSURE we use 'pr' (precipitation)
        if 'pr' not in ds.data_vars:
            available = list(ds.data_vars)
            return jsonify({'error': f"Variable 'pr' not found. Available: {available}"}), 500
        
        pr_data = ds['pr'].isel(time=time_index)
        print(f"📊 Reading 'pr' (precipitation) variable")
        
        # SRF dataset uses POSITIVE fill value 9.96921E36, old dataset used negative -9.0E33
        # Mask both types of fill values and negative values
        pr_data = pr_data.where((pr_data > -1e30) & (pr_data < 1e30) & (pr_data >= 0))
        
        # SRF precipitation is in kg/m²/s, need to convert to mm/day
        # 1 kg/m²/s = 86400 mm/day
        pr_data = pr_data * 86400
        
        # Subsample to reduce data size (every Nth point)
        pr_subsampled = pr_data.isel(lat=slice(None, None, subsample), 
                                      lon=slice(None, None, subsample))
        
        # Convert to numpy and handle NaN
        values = pr_subsampled.values
        values = np.nan_to_num(values, nan=-999)  # Replace NaN with flag value
        
        # Apply land mask only if requested
        if apply_mask:
            land_mask = get_land_mask(subsample)
            if land_mask is not None and land_mask.shape == values.shape:
                # Set ocean values to -999 (will be transparent)
                values = np.where(land_mask, values, -999)
                print(f"Applied land mask to period {period}")
        
        # Get coordinates - ensure we get actual coordinate arrays
        lats = pr_subsampled.lat.values
        lons = pr_subsampled.lon.values
        
        # Ensure coordinates are evenly spaced if they should be
        # For linear mapping, reconstruct the grid to ensure consistency
        if len(lats) > 1:
            lat_min, lat_max = float(lats[0]), float(lats[-1])
            lats = np.linspace(lat_min, lat_max, len(lats))
        
        if len(lons) > 1:
            lon_min, lon_max = float(lons[0]), float(lons[-1])
            lons = np.linspace(lon_min, lon_max, len(lons))
        
        lats = lats.tolist()
        lons = lons.tolist()
        
        # Calculate statistics for color scale
        valid_values = values[values != -999]
        
        # Debug info
        print(f"Period: {period}")
        print(f"Data shape: {values.shape}")
        print(f"Lat range: {min(lats):.2f} to {max(lats):.2f}, count: {len(lats)}")
        print(f"Lon range: {min(lons):.2f} to {max(lons):.2f}, count: {len(lons)}")
        print(f"Lat order: {'ascending' if lats[0] < lats[-1] else 'descending'}")
        print(f"Valid values: {len(valid_values)} / {values.size} ({100*len(valid_values)/values.size:.1f}%)")
        print(f"Value range: {np.min(values):.2f} to {np.max(values):.2f}")
        print(f"Actual bounds: {actual_bounds}")
        
        response = {
            'lat': lats,
            'lon': lons,
            'values': values.tolist(),
            'bounds': actual_bounds,
            'stats': {
                'min': 0,  # Fixed scale minimum
                'max': 100,  # Fixed scale maximum (mm/day)
                'mean': float(np.mean(valid_values)) if len(valid_values) > 0 else 0,
                'actualMin': float(np.min(valid_values)) if len(valid_values) > 0 else 0,
                'actualMax': float(np.max(valid_values)) if len(valid_values) > 0 else 0
            },
            'timeIndex': time_index,
            'totalTimes': len(ds.time),
            'debug': {
                'shape': list(values.shape),
                'latOrder': 'ascending' if lats[0] < lats[-1] else 'descending'
            }
        }
        
        ds.close()
        return jsonify(response)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/precipitation/binary', methods=['GET'])
def get_precipitation_binary():
    """Binary endpoint for faster data transfer - uses server-side caching"""
    try:
        request_start = time_module.time()
        timings = {}
        
        # Get parameters
        period = request.args.get('period', '202601')
        time_index = int(request.args.get('time', 0))
        subsample = 2  # Fixed subsample rate
        apply_mask = request.args.get('masked', 'false').lower() == 'true'  # Default: no mask
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Use cached data (HUGE speedup for repeated requests)
        t1 = time_module.time()
        cached = get_cached_precip_data(period, time_index, subsample, apply_mask)
        timings['cache_lookup'] = (time_module.time() - t1) * 1000
        
        lats = cached['lats']
        lons = cached['lons']
        values = cached['values']
        bounds = cached['bounds']
        stats = cached['stats']
        total_days = cached['total_days']
        
        # Build binary response
        t2 = time_module.time()
        lat_count = len(lats)
        lon_count = len(lons)
        
        # Pack header (13 values) - now using total_days instead of total_times
        header = struct.pack('<4i9f',
            lat_count, lon_count, time_index, total_days,
            bounds[0], bounds[1], bounds[2], bounds[3],  # minLat, maxLat, minLon, maxLon
            stats[0], stats[1], stats[2], stats[3], stats[4]  # min, max, mean, actualMin, actualMax
        )
        
        # Pack arrays as bytes
        lat_bytes = lats.tobytes()
        lon_bytes = lons.tobytes()
        values_bytes = values.tobytes()
        
        # Combine all
        binary_data = header + lat_bytes + lon_bytes + values_bytes
        timings['binary_pack'] = (time_module.time() - t2) * 1000
        
        timings['total'] = (time_module.time() - request_start) * 1000
        is_cached = timings['cache_lookup'] < 10  # Less than 10ms means it was cached
        
        print(f"📦 Binary: {len(binary_data)/1024:.1f}KB | cache: {timings['cache_lookup']:.0f}ms | pack: {timings['binary_pack']:.0f}ms | total: {timings['total']:.0f}ms | {'✅ CACHED' if is_cached else '🔄 FRESH'}")
        
        return Response(binary_data, mimetype='application/octet-stream')
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/times', methods=['GET'])
def get_times():
    """Get list of available DAYS (not raw time steps)"""
    try:
        period = request.args.get('period', '202601')
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Build URL
        url = BASE_URL_TEMPLATE.format(period=period)
        
        ds = xr.open_dataset(url, engine="netcdf4")
        raw_times = ds.time.values
        
        # Group by date to get unique days
        unique_dates = []
        seen_dates = set()
        for t in raw_times:
            date_str = str(t)[:10]  # YYYY-MM-DD
            if date_str not in seen_dates:
                seen_dates.add(date_str)
                unique_dates.append(date_str)
        
        ds.close()
        return jsonify({
            'times': unique_dates,
            'totalDays': len(unique_dates),
            'rawTimeSteps': len(raw_times),
            'timeStepsPerDay': TIME_STEPS_PER_DAY
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/prefetch', methods=['GET'])
def prefetch_period():
    """
    Prefetch all time steps for a period into cache.
    Call this when user selects a new period - cache warms up in background.
    """
    try:
        period = request.args.get('period', '202601')
        subsample = 2  # Fixed subsample rate
        apply_mask = request.args.get('masked', 'false').lower() == 'true'  # Default: no mask
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Get dataset to find total DAYS (not raw time steps)
        ds = get_dataset(period)
        total_raw_times = len(ds.time)
        total_days = total_raw_times // TIME_STEPS_PER_DAY
        
        print(f"🚀 Prefetching {period}: {total_days} days ({total_raw_times} raw time steps)...")
        start_time = time_module.time()
        
        cached_count = 0
        already_cached = 0
        
        for day in range(total_days):
            # Check if already in cache by checking cache info
            cache_info_before = get_cached_precip_data.cache_info()
            get_cached_precip_data(period, day, subsample, apply_mask)
            cache_info_after = get_cached_precip_data.cache_info()
            
            if cache_info_after.hits > cache_info_before.hits:
                already_cached += 1
            else:
                cached_count += 1
        
        elapsed = time_module.time() - start_time
        print(f"✅ Prefetch complete: {cached_count} new + {already_cached} already cached in {elapsed:.1f}s")
        
        return jsonify({
            'period': period,
            'totalDays': total_days,
            'newlyCached': cached_count,
            'alreadyCached': already_cached,
            'elapsedSeconds': round(elapsed, 1)
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cache/status', methods=['GET'])
def cache_status():
    """Get current cache status and statistics"""
    cache_info = get_cached_precip_data.cache_info()
    return jsonify({
        'cacheSize': cache_info.currsize,
        'maxSize': cache_info.maxsize,
        'hits': cache_info.hits,
        'misses': cache_info.misses,
        'hitRate': round(cache_info.hits / max(1, cache_info.hits + cache_info.misses) * 100, 1),
        'datasetsOpen': len(_dataset_cache)
    })


@app.route('/api/cache/clear', methods=['POST'])
def clear_cache():
    """Clear all caches (useful for debugging or freeing memory)"""
    global _dataset_cache, _land_mask_cache
    
    # Clear LRU cache
    get_cached_precip_data.cache_clear()
    
    # Close and clear dataset connections
    for period, ds in _dataset_cache.items():
        try:
            ds.close()
        except:
            pass
    _dataset_cache = {}
    
    # Clear land mask cache
    _land_mask_cache = {}
    
    print("🗑️ All caches cleared")
    return jsonify({'status': 'cleared'})


@app.route('/api/precipitation/aggregated/binary', methods=['GET'])
def get_aggregated_precipitation_binary():
    """
    Get aggregated precipitation data (average over multiple DAYS).
    Used for 10-day and monthly views.
    Note: start_time and end_time are DAY indices, not raw time indices.
    """
    try:
        request_start = time_module.time()
        
        # Get parameters
        period = request.args.get('period', '202601')
        start_day = int(request.args.get('start_time', 0))
        end_day = int(request.args.get('end_time', 0))
        subsample = 2  # Fixed subsample rate
        apply_mask = request.args.get('masked', 'false').lower() == 'true'  # Default: no mask
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Ensure end_day >= start_day
        if end_day < start_day:
            end_day = start_day
        
        print(f"📊 Aggregating {period}: days {start_day} to {end_day}...")
        
        # Fetch all required DAYS and aggregate
        aggregated_values = None
        count = 0
        
        for day in range(start_day, end_day + 1):
            cached = get_cached_precip_data(period, day, subsample, apply_mask)
            values = cached['values'].copy()
            
            # Convert invalid values to NaN for proper averaging
            values = np.where(values == -999, np.nan, values)
            
            if aggregated_values is None:
                aggregated_values = values
                lats = cached['lats']
                lons = cached['lons']
                bounds = cached['bounds']
                total_days = cached['total_days']
            else:
                # Use nanmean logic - stack and average
                aggregated_values = np.nansum([aggregated_values, values], axis=0)
            
            count += 1
        
        # Calculate average
        if count > 1:
            # For nanmean, we need to count valid values
            valid_counts = None
            for day in range(start_day, end_day + 1):
                cached = get_cached_precip_data(period, day, subsample, apply_mask)
                values = cached['values'].copy()
                valid_mask = (values != -999).astype(np.float32)
                if valid_counts is None:
                    valid_counts = valid_mask
                else:
                    valid_counts += valid_mask
            
            # Avoid division by zero
            valid_counts = np.where(valid_counts == 0, 1, valid_counts)
            aggregated_values = aggregated_values / valid_counts
        
        # Replace NaN back to -999
        aggregated_values = np.nan_to_num(aggregated_values, nan=-999).astype(np.float32)
        
        # Apply land mask only if requested
        if apply_mask:
            land_mask = get_land_mask(subsample)
            if land_mask is not None and land_mask.shape == aggregated_values.shape:
                aggregated_values = np.where(land_mask, aggregated_values, -999).astype(np.float32)
        
        # Calculate stats for aggregated data
        valid_values = aggregated_values[aggregated_values != -999]
        stats = (
            0.0,  # min (fixed scale)
            100.0,  # max (fixed scale)
            float(np.mean(valid_values)) if len(valid_values) > 0 else 0.0,
            float(np.min(valid_values)) if len(valid_values) > 0 else 0.0,
            float(np.max(valid_values)) if len(valid_values) > 0 else 0.0
        )
        
        # Build binary response
        lat_count = len(lats)
        lon_count = len(lons)
        
        # Pack header (13 values)
        header = struct.pack('<4i9f',
            lat_count, lon_count, start_day, total_days,
            bounds[0], bounds[1], bounds[2], bounds[3],  # minLat, maxLat, minLon, maxLon
            stats[0], stats[1], stats[2], stats[3], stats[4]  # min, max, mean, actualMin, actualMax
        )
        
        # Pack arrays as bytes
        lat_bytes = lats.tobytes()
        lon_bytes = lons.tobytes()
        values_bytes = aggregated_values.tobytes()
        
        # Combine all
        binary_data = header + lat_bytes + lon_bytes + values_bytes
        
        elapsed = time_module.time() - request_start
        print(f"📦 Aggregated binary ({count} days): {len(binary_data)/1024:.1f}KB in {elapsed*1000:.0f}ms")
        
        return Response(binary_data, mimetype='application/octet-stream')
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/timeseries', methods=['GET'])
def get_timeseries():
    """Get precipitation time series for a specific lat/lon point.
    Supports different aggregation modes: 'day', '10day', 'monthly'
    Averages data for the same day if multiple time steps exist.
    """
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
        period = request.args.get('period', '202601')  # Default to latest period
        mode = request.args.get('mode', 'day')  # 'day', '10day', or 'monthly'
        
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Period {period} not available'}), 400
        
        # Get dataset
        ds = get_dataset(period)
        
        # Check if 'pr' variable exists
        if 'pr' not in ds.data_vars:
            available = list(ds.data_vars)
            return jsonify({'error': f"Variable 'pr' not found. Available: {available}"}), 500
        
        # Get lat/lon arrays
        lats = ds['lat'].values
        lons = ds['lon'].values
        
        # Find nearest grid point
        lat_idx = np.argmin(np.abs(lats - lat))
        lon_idx = np.argmin(np.abs(lons - lon))
        
        # Get actual grid coordinates
        actual_lat = float(lats[lat_idx])
        actual_lon = float(lons[lon_idx])
        
        # Extract time series for this grid point
        pr_data = ds['pr'].isel(lat=lat_idx, lon=lon_idx)
        
        # Get time values
        times = ds['time'].values
        
        # Build raw time series and group by date (to handle same-day averaging)
        date_values = {}  # date_str -> list of precipitation values
        date_indices = {}  # date_str -> list of time indices
        
        for i, time_val in enumerate(times):
            precip_val = float(pr_data.isel(time=i).values)
            
            # Handle invalid values - SRF uses positive fill value 9.96921E36
            if precip_val < -1e30 or precip_val > 1e30 or precip_val < 0:
                precip_val = 0  # Treat as no rain instead of skipping
            else:
                # SRF precipitation is in kg/m²/s, convert to mm/day
                precip_val = precip_val * 86400
                
            # Convert numpy datetime64 to ISO string (YYYY-MM-DD)
            time_str = str(time_val)[:10]
            
            if time_str not in date_values:
                date_values[time_str] = []
                date_indices[time_str] = []
            
            date_values[time_str].append(precip_val)
            date_indices[time_str].append(i)
        
        # Average same-day values and build daily series
        daily_series = []
        sorted_dates = sorted(date_values.keys())
        
        for idx, date_str in enumerate(sorted_dates):
            values = date_values[date_str]
            indices = date_indices[date_str]
            avg_precip = np.mean(values)
            
            daily_series.append({
                'date': date_str,
                'day_index': idx,  # Use sequential index for aggregated days
                'original_indices': indices,  # Keep track of original time indices
                'precipitation': round(avg_precip, 2),
                'num_samples': len(values)  # How many samples were averaged
            })
        
        print(f"📊 Timeseries: {len(daily_series)} unique days from {len(times)} time steps")
        
        # Aggregate based on mode
        if mode == 'day':
            time_series = daily_series
        elif mode == '10day':
            # Group into 10-day periods (dekads)
            time_series = []
            for i in range(0, len(daily_series), 10):
                chunk = daily_series[i:i+10]
                if chunk:
                    avg_precip = np.mean([d['precipitation'] for d in chunk])
                    # Collect all original indices
                    all_indices = []
                    for d in chunk:
                        all_indices.extend(d['original_indices'])
                    
                    time_series.append({
                        'date': chunk[0]['date'],
                        'end_date': chunk[-1]['date'],
                        'start_index': min(all_indices),
                        'end_index': max(all_indices),
                        'days': len(chunk),
                        'precipitation': round(avg_precip, 2),
                        'label': f"Days {i+1}-{min(i+10, len(daily_series))}"
                    })
        elif mode == 'monthly':
            # Group by month (entire period is typically one month)
            if daily_series:
                avg_precip = np.mean([d['precipitation'] for d in daily_series])
                # Collect all original indices
                all_indices = []
                for d in daily_series:
                    all_indices.extend(d['original_indices'])
                
                time_series = [{
                    'date': daily_series[0]['date'],
                    'end_date': daily_series[-1]['date'],
                    'start_index': min(all_indices),
                    'end_index': max(all_indices),
                    'days': len(daily_series),
                    'precipitation': round(avg_precip, 2),
                    'label': f"Monthly Average ({len(daily_series)} days)"
                }]
            else:
                time_series = []
        else:
            time_series = daily_series
        
        # Calculate basic statistics
        valid_values = [item['precipitation'] for item in time_series]
        if valid_values:
            stats = {
                'min': round(min(valid_values), 2),
                'max': round(max(valid_values), 2),
                'mean': round(np.mean(valid_values), 2),
                'total_items': len(valid_values),
                'mode': mode
            }
        else:
            stats = {
                'min': 0,
                'max': 0,
                'mean': 0,
                'total_items': 0,
                'mode': mode
            }
        
        return jsonify({
            'requested_coords': {'lat': lat, 'lon': lon},
            'actual_coords': {'lat': actual_lat, 'lon': actual_lon},
            'period': period,
            'mode': mode,
            'time_series': time_series,
            'statistics': stats
        })
        
    except ValueError as e:
        return jsonify({'error': 'Invalid lat/lon coordinates'}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Cache for province masks (province_name -> boolean mask array)
_province_mask_cache = {}

@app.route('/api/timeseries/region', methods=['POST'])
def get_region_timeseries():
    """Get precipitation time series averaged over a region (province polygon).
    
    Accepts POST request with GeoJSON polygon in the body.
    Returns regional average precipitation time series.
    """
    try:
        t_start = time_module.time()
        
        # Get parameters
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        geometry = data.get('geometry')
        province_name = data.get('province_name', 'Unknown')
        period = data.get('period', '202601')
        mode = data.get('mode', 'day')
        
        if not geometry:
            return jsonify({'error': 'No geometry provided'}), 400
        
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Period {period} not available'}), 400
        
        print(f"🗺️ Processing region: {province_name}")
        
        # Create Shapely polygon from GeoJSON
        try:
            polygon = shape(geometry)
            prepared_polygon = prep(polygon)  # Faster point-in-polygon tests
        except Exception as e:
            return jsonify({'error': f'Invalid geometry: {str(e)}'}), 400
        
        # Get dataset
        ds = get_dataset(period)
        
        if 'pr' not in ds.data_vars:
            available = list(ds.data_vars)
            return jsonify({'error': f"Variable 'pr' not found. Available: {available}"}), 500
        
        # Get lat/lon arrays (full resolution for accuracy)
        lats = ds['lat'].values
        lons = ds['lon'].values
        
        # Check if we have a cached mask for this province
        cache_key = f"{province_name}_{len(lats)}_{len(lons)}"
        
        if cache_key in _province_mask_cache:
            region_mask = _province_mask_cache[cache_key]
            print(f"✅ Using cached mask for {province_name}")
        else:
            # Create mask for points inside the polygon
            print(f"🔍 Creating mask for {province_name}...")
            t_mask_start = time_module.time()
            
            # Create mesh grid of coordinates
            lon_grid, lat_grid = np.meshgrid(lons, lats)
            
            # Flatten for point-in-polygon test
            points_lat = lat_grid.flatten()
            points_lon = lon_grid.flatten()
            
            # Test each point (vectorized approach for speed)
            region_mask = np.zeros(len(points_lat), dtype=bool)
            
            # Use bounding box to quickly filter points
            minx, miny, maxx, maxy = polygon.bounds
            
            for i in range(len(points_lat)):
                lon, lat = points_lon[i], points_lat[i]
                # Quick bounding box check first
                if minx <= lon <= maxx and miny <= lat <= maxy:
                    if prepared_polygon.contains(Point(lon, lat)):
                        region_mask[i] = True
            
            # Reshape to grid
            region_mask = region_mask.reshape(lat_grid.shape)
            
            # Cache the mask
            _province_mask_cache[cache_key] = region_mask
            
            mask_time = time_module.time() - t_mask_start
            print(f"✅ Mask created for {province_name}: {np.sum(region_mask)} points in {mask_time:.1f}s")
        
        # Count points in region
        num_points = np.sum(region_mask)
        if num_points == 0:
            return jsonify({'error': f'No data points found in region {province_name}'}), 400
        
        # Get time values
        times = ds['time'].values
        
        # Build time series by averaging over region for each time step
        print(f"📊 Calculating regional averages for {len(times)} time steps...")
        
        date_values = {}  # date_str -> list of regional average values
        
        for i, time_val in enumerate(times):
            # Get precipitation for this time step
            pr_slice = ds['pr'].isel(time=i).values
            
            # Handle fill values
            valid_mask = (pr_slice > -1e30) & (pr_slice < 1e30) & (pr_slice >= 0)
            combined_mask = region_mask & valid_mask
            
            if np.sum(combined_mask) > 0:
                # Calculate regional average (convert kg/m²/s to mm/day)
                regional_avg = float(np.mean(pr_slice[combined_mask])) * 86400
            else:
                regional_avg = 0
            
            # Group by date
            time_str = str(time_val)[:10]
            if time_str not in date_values:
                date_values[time_str] = []
            date_values[time_str].append(regional_avg)
        
        # Average same-day values and build daily series
        daily_series = []
        sorted_dates = sorted(date_values.keys())
        
        for idx, date_str in enumerate(sorted_dates):
            values = date_values[date_str]
            avg_precip = np.mean(values)
            
            daily_series.append({
                'date': date_str,
                'day_index': idx,
                'precipitation': round(avg_precip, 2),
                'num_samples': len(values)
            })
        
        # Aggregate based on mode
        if mode == 'day':
            time_series = daily_series
        elif mode == '10day':
            time_series = []
            for i in range(0, len(daily_series), 10):
                chunk = daily_series[i:i+10]
                if chunk:
                    avg_precip = np.mean([d['precipitation'] for d in chunk])
                    time_series.append({
                        'date': chunk[0]['date'],
                        'end_date': chunk[-1]['date'],
                        'days': len(chunk),
                        'precipitation': round(avg_precip, 2),
                        'label': f"Days {i+1}-{min(i+10, len(daily_series))}"
                    })
        elif mode == 'monthly':
            if daily_series:
                avg_precip = np.mean([d['precipitation'] for d in daily_series])
                time_series = [{
                    'date': daily_series[0]['date'],
                    'end_date': daily_series[-1]['date'],
                    'days': len(daily_series),
                    'precipitation': round(avg_precip, 2),
                    'label': f"Monthly Average ({len(daily_series)} days)"
                }]
            else:
                time_series = []
        else:
            time_series = daily_series
        
        # Calculate statistics
        valid_values = [item['precipitation'] for item in time_series]
        if valid_values:
            stats = {
                'min': round(min(valid_values), 2),
                'max': round(max(valid_values), 2),
                'mean': round(np.mean(valid_values), 2),
                'total_items': len(valid_values),
                'mode': mode
            }
        else:
            stats = {'min': 0, 'max': 0, 'mean': 0, 'total_items': 0, 'mode': mode}
        
        elapsed = time_module.time() - t_start
        print(f"✅ Regional time series for {province_name}: {len(time_series)} items in {elapsed:.1f}s")
        
        return jsonify({
            'province_name': province_name,
            'num_grid_points': int(num_points),
            'period': period,
            'mode': mode,
            'time_series': time_series,
            'statistics': stats,
            'processing_time_seconds': round(elapsed, 2)
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/precipitation/region', methods=['POST'])
def get_region_precipitation():
    """Get current precipitation average for a region.
    
    Quick endpoint to get regional average for current time step.
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        geometry = data.get('geometry')
        province_name = data.get('province_name', 'Unknown')
        period = data.get('period', '202601')
        day_index = data.get('day_index', 0)
        
        if not geometry:
            return jsonify({'error': 'No geometry provided'}), 400
        
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Period {period} not available'}), 400
        
        # Create Shapely polygon
        polygon = shape(geometry)
        prepared_polygon = prep(polygon)
        
        # Get cached precipitation data
        cached = get_cached_precip_data(period, day_index, 2, False)
        lats = cached['lats']
        lons = cached['lons']
        values = cached['values']
        
        # Check cache for mask
        cache_key = f"{province_name}_{len(lats)}_{len(lons)}_subsample"
        
        if cache_key in _province_mask_cache:
            region_mask = _province_mask_cache[cache_key]
        else:
            # Create mask
            lon_grid, lat_grid = np.meshgrid(lons, lats)
            points_lat = lat_grid.flatten()
            points_lon = lon_grid.flatten()
            
            region_mask = np.zeros(len(points_lat), dtype=bool)
            minx, miny, maxx, maxy = polygon.bounds
            
            for i in range(len(points_lat)):
                lon, lat = points_lon[i], points_lat[i]
                if minx <= lon <= maxx and miny <= lat <= maxy:
                    if prepared_polygon.contains(Point(lon, lat)):
                        region_mask[i] = True
            
            region_mask = region_mask.reshape(lat_grid.shape)
            _province_mask_cache[cache_key] = region_mask
        
        # Calculate regional average
        valid_mask = (values != -999) & region_mask
        if np.sum(valid_mask) > 0:
            regional_avg = float(np.mean(values[valid_mask]))
        else:
            regional_avg = 0
        
        return jsonify({
            'province_name': province_name,
            'precipitation': round(regional_avg, 2),
            'num_grid_points': int(np.sum(region_mask)),
            'period': period,
            'day_index': day_index
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)