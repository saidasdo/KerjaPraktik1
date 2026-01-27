from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import xarray as xr
import numpy as np
import struct
from functools import lru_cache
import time as time_module

app = Flask(__name__)
CORS(app)

BASE_URL_TEMPLATE = "http://202.90.199.129:1980/dods/inarcm/{period}/InaRCM_pr_corrected_dd_{period}"

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
        values = pr_subsampled.values
        # Fill value is -9.0E33, so anything > -1e30 and >= 0 is valid land data
        land_mask = (values > -1e30) & (values >= 0)
        
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
def get_cached_precip_data(period, time_index, subsample):
    """Cache processed precipitation data to avoid re-reading NetCDF files"""
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
    
    # 3. Get data for specific time and subsample
    t3 = time_module.time()
    pr_data = ds['pr'].isel(time=time_index)
    pr_data = pr_data.where((pr_data > -1e30) & (pr_data >= 0))
    pr_subsampled = pr_data.isel(lat=slice(None, None, subsample), 
                                  lon=slice(None, None, subsample))
    timings['select_data'] = (time_module.time() - t3) * 1000
    
    # 4. Convert to numpy (THIS IS WHERE ACTUAL DATA TRANSFER HAPPENS!)
    t4 = time_module.time()
    values = pr_subsampled.values
    timings['to_numpy'] = (time_module.time() - t4) * 1000
    
    # 5. Process values
    t5 = time_module.time()
    values = np.nan_to_num(values, nan=-999).astype(np.float32)
    timings['nan_to_num'] = (time_module.time() - t5) * 1000
    
    # 6. Apply land mask
    t6 = time_module.time()
    land_mask = get_land_mask(subsample)
    if land_mask is not None and land_mask.shape == values.shape:
        values = np.where(land_mask, values, -999).astype(np.float32)
    timings['land_mask'] = (time_module.time() - t6) * 1000
    
    # 7. Get coordinates
    t7 = time_module.time()
    lats = pr_subsampled.lat.values
    lons = pr_subsampled.lon.values
    
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
        if actual_max > 200:
            print(f"⚠️  HIGH RAINFALL DETECTED: max={actual_max:.1f} mm/day, mean={actual_mean:.1f} mm/day")
    
    total_times = len(ds.time)
    # DON'T close dataset - keep connection alive for reuse!
    
    timings['total'] = (time_module.time() - t_start) * 1000
    
    # Print detailed timing breakdown
    print(f"\n⏱️ TIMING for {period}/{time_index} (subsample={subsample}):")
    print(f"  📂 open_dataset:  {timings['open_dataset']:>7.0f}ms")
    print(f"  📍 get_bounds:    {timings['get_bounds']:>7.0f}ms")
    print(f"  🔍 select_data:   {timings['select_data']:>7.0f}ms")
    print(f"  📊 to_numpy:      {timings['to_numpy']:>7.0f}ms  ← DATA TRANSFER")
    print(f"  🔢 nan_to_num:    {timings['nan_to_num']:>7.0f}ms")
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
        'total_times': total_times
    }


@app.route('/', methods=['GET'])
def index():
    return jsonify({
        'message': 'Precipitation API',
        'endpoints': {
            '/api/precipitation': {
                'method': 'GET',
                'params': {
                    'period': f'Period YYYYMM (options: {", ".join(AVAILABLE_PERIODS)})',
                    'time': 'Time index (default: 0)',
                    'subsample': 'Subsample rate to reduce data size (default: 2)'
                },
                'description': 'Get precipitation data for a specific time'
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
        period = request.args.get('period', '202512')
        time_index = int(request.args.get('time', 0))
        subsample = int(request.args.get('subsample', 2))  # Reduce data size
        
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
        
        # Get data for specific time
        pr_data = ds['pr'].isel(time=time_index)
        
        # Mask fill values - the _FillValue is -9.0E33
        # Also mask any extremely large negative values
        pr_data = pr_data.where((pr_data > -1e30) & (pr_data >= 0))
        
        # Subsample to reduce data size (every Nth point)
        pr_subsampled = pr_data.isel(lat=slice(None, None, subsample), 
                                      lon=slice(None, None, subsample))
        
        # Convert to numpy and handle NaN
        values = pr_subsampled.values
        values = np.nan_to_num(values, nan=-999)  # Replace NaN with flag value
        
        # Apply land mask to ensure consistency across all periods
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
        period = request.args.get('period', '202512')
        time_index = int(request.args.get('time', 0))
        subsample = int(request.args.get('subsample', 2))
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Use cached data (HUGE speedup for repeated requests)
        t1 = time_module.time()
        cached = get_cached_precip_data(period, time_index, subsample)
        timings['cache_lookup'] = (time_module.time() - t1) * 1000
        
        lats = cached['lats']
        lons = cached['lons']
        values = cached['values']
        bounds = cached['bounds']
        stats = cached['stats']
        total_times = cached['total_times']
        
        # Build binary response
        t2 = time_module.time()
        lat_count = len(lats)
        lon_count = len(lons)
        
        # Pack header (13 values)
        header = struct.pack('<4i9f',
            lat_count, lon_count, time_index, total_times,
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
    try:
        period = request.args.get('period', '202512')
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Build URL
        url = BASE_URL_TEMPLATE.format(period=period)
        
        ds = xr.open_dataset(url, engine="netcdf4")
        times = ds.time.values.astype(str).tolist()
        ds.close()
        return jsonify({'times': times})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/prefetch', methods=['GET'])
def prefetch_period():
    """
    Prefetch all time steps for a period into cache.
    Call this when user selects a new period - cache warms up in background.
    """
    try:
        period = request.args.get('period', '202512')
        subsample = int(request.args.get('subsample', 2))
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Get dataset to find total time steps
        ds = get_dataset(period)
        total_times = len(ds.time)
        
        print(f"🚀 Prefetching {period}: {total_times} time steps...")
        start_time = time_module.time()
        
        cached_count = 0
        already_cached = 0
        
        for t in range(total_times):
            # Check if already in cache by checking cache info
            cache_info_before = get_cached_precip_data.cache_info()
            get_cached_precip_data(period, t, subsample)
            cache_info_after = get_cached_precip_data.cache_info()
            
            if cache_info_after.hits > cache_info_before.hits:
                already_cached += 1
            else:
                cached_count += 1
        
        elapsed = time_module.time() - start_time
        print(f"✅ Prefetch complete: {cached_count} new + {already_cached} already cached in {elapsed:.1f}s")
        
        return jsonify({
            'period': period,
            'totalTimes': total_times,
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
    Get aggregated precipitation data (average over multiple time steps).
    Used for 10-day and monthly views.
    """
    try:
        request_start = time_module.time()
        
        # Get parameters
        period = request.args.get('period', '202512')
        start_time = int(request.args.get('start_time', 0))
        end_time = int(request.args.get('end_time', 0))
        subsample = int(request.args.get('subsample', 2))
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Ensure end_time >= start_time
        if end_time < start_time:
            end_time = start_time
        
        print(f"📊 Aggregating {period}: time {start_time} to {end_time}...")
        
        # Fetch all required time steps and aggregate
        aggregated_values = None
        count = 0
        
        for t in range(start_time, end_time + 1):
            cached = get_cached_precip_data(period, t, subsample)
            values = cached['values'].copy()
            
            # Convert invalid values to NaN for proper averaging
            values = np.where(values == -999, np.nan, values)
            
            if aggregated_values is None:
                aggregated_values = values
                lats = cached['lats']
                lons = cached['lons']
                bounds = cached['bounds']
                total_times = cached['total_times']
            else:
                # Use nanmean logic - stack and average
                aggregated_values = np.nansum([aggregated_values, values], axis=0)
            
            count += 1
        
        # Calculate average
        if count > 1:
            # For nanmean, we need to count valid values
            valid_counts = None
            for t in range(start_time, end_time + 1):
                cached = get_cached_precip_data(period, t, subsample)
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
        
        # Apply land mask
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
            lat_count, lon_count, start_time, total_times,
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
        print(f"📦 Aggregated binary ({count} steps): {len(binary_data)/1024:.1f}KB in {elapsed*1000:.0f}ms")
        
        return Response(binary_data, mimetype='application/octet-stream')
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)