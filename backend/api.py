from flask import Flask, jsonify, request, Response
from flask_cors import CORS
import xarray as xr
import numpy as np
import struct

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

# Cache for land mask
_land_mask_cache = None

def get_land_mask(subsample=2):
    """Get land mask from reference dataset (202508 has proper ocean masking)"""
    global _land_mask_cache
    
    if _land_mask_cache is not None and _land_mask_cache.get('subsample') == subsample:
        return _land_mask_cache['mask']
    
    try:
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
        
        _land_mask_cache = {
            'mask': land_mask,
            'subsample': subsample
        }
        print(f"Land mask loaded: {np.sum(land_mask)} land pixels out of {land_mask.size}")
        
        return land_mask
    except Exception as e:
        print(f"Error loading land mask: {e}")
        return None

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
    """Binary endpoint for faster data transfer"""
    try:
        # Get parameters
        period = request.args.get('period', '202512')
        time_index = int(request.args.get('time', 0))
        subsample = int(request.args.get('subsample', 2))
        
        # Validate period
        if period not in AVAILABLE_PERIODS:
            return jsonify({'error': f'Invalid period. Available: {", ".join(AVAILABLE_PERIODS)}'}), 400
        
        # Build URL
        url = BASE_URL_TEMPLATE.format(period=period)
        
        # Open dataset
        ds = xr.open_dataset(url, engine="netcdf4")
        
        # Get bounds
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
        pr_data = pr_data.where((pr_data > -1e30) & (pr_data >= 0))
        
        # Subsample
        pr_subsampled = pr_data.isel(lat=slice(None, None, subsample), 
                                      lon=slice(None, None, subsample))
        
        # Convert to numpy
        values = pr_subsampled.values
        values = np.nan_to_num(values, nan=-999).astype(np.float32)
        
        # Apply land mask
        land_mask = get_land_mask(subsample)
        if land_mask is not None and land_mask.shape == values.shape:
            values = np.where(land_mask, values, -999).astype(np.float32)
        
        # Get coordinates
        lats = pr_subsampled.lat.values
        lons = pr_subsampled.lon.values
        
        if len(lats) > 1:
            lat_min, lat_max = float(lats[0]), float(lats[-1])
            lats = np.linspace(lat_min, lat_max, len(lats)).astype(np.float32)
        
        if len(lons) > 1:
            lon_min, lon_max = float(lons[0]), float(lons[-1])
            lons = np.linspace(lon_min, lon_max, len(lons)).astype(np.float32)
        
        # Calculate stats
        valid_values = values[values != -999]
        stats_min = 0.0
        stats_max = 100.0
        stats_mean = float(np.mean(valid_values)) if len(valid_values) > 0 else 0.0
        actual_min = float(np.min(valid_values)) if len(valid_values) > 0 else 0.0
        actual_max = float(np.max(valid_values)) if len(valid_values) > 0 else 0.0
        
        total_times = len(ds.time)
        ds.close()
        
        # Build binary response
        # Header: 
        #   4 bytes: lat count (int32)
        #   4 bytes: lon count (int32)
        #   4 bytes: time_index (int32)
        #   4 bytes: total_times (int32)
        #   4x4 bytes: bounds (minLat, maxLat, minLon, maxLon as float32)
        #   5x4 bytes: stats (min, max, mean, actualMin, actualMax as float32)
        # Then: lats array (float32), lons array (float32), values array (float32)
        
        lat_count = len(lats)
        lon_count = len(lons)
        
        # Pack header (13 values)
        header = struct.pack('<4i9f',
            lat_count, lon_count, time_index, total_times,
            actual_bounds['minLat'], actual_bounds['maxLat'],
            actual_bounds['minLon'], actual_bounds['maxLon'],
            stats_min, stats_max, stats_mean, actual_min, actual_max
        )
        
        # Pack arrays as bytes
        lat_bytes = lats.tobytes()
        lon_bytes = lons.tobytes()
        values_bytes = values.tobytes()
        
        # Combine all
        binary_data = header + lat_bytes + lon_bytes + values_bytes
        
        print(f"Binary response: {len(binary_data)} bytes (header: {len(header)}, lats: {len(lat_bytes)}, lons: {len(lon_bytes)}, values: {len(values_bytes)})")
        
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

if __name__ == '__main__':
    app.run(debug=True, port=5000)