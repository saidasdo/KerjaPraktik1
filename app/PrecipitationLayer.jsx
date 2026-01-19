'use client';

import { useEffect, useRef } from 'react';

export default function PrecipitationLayer({ map, data, opacity = 0.7 }) {
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map || !data || !data.lat || !data.lon || !data.values || !data.bounds) {
      console.log('Missing data for PrecipitationLayer:', { 
        map: !!map, 
        data: !!data,
        lat: !!data?.lat,
        lon: !!data?.lon,
        values: !!data?.values,
        bounds: !!data?.bounds
      });
      return;
    }

    const L = require('leaflet');

    // Remove old layer if exists
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    const { lat, lon, values, stats, bounds: dataBounds } = data;
    
    console.log('PrecipitationLayer rendering:', {
      latCount: lat.length,
      lonCount: lon.length,
      valuesShape: [values.length, values[0]?.length],
      latRange: [lat[0], lat[lat.length - 1]],
      lonRange: [lon[0], lon[lon.length - 1]],
      actualBounds: dataBounds
    });

    // Upscale factor for smooth interpolation (like Windy.com)
    // Higher = smoother but more processing time
    const upscaleFactor = 8;
    const width = lon.length * upscaleFactor;
    const height = lat.length * upscaleFactor;
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Color scale function (similar to YlGnBu colormap)
    const getColor = (value, min, max) => {
      if (value === -999 || value < 0) return null;
      
      const normalized = Math.max(0, Math.min(1, (value - min) / (max - min + 0.001)));
      
      // YlGnBu-like color scale
      const colors = [
        [255, 255, 204],  // Light yellow
        [199, 233, 180],  // Yellow-green
        [127, 205, 187],  // Light teal
        [65, 182, 196],   // Teal
        [29, 145, 192],   // Blue
        [34, 94, 168],    // Dark blue
        [12, 44, 132]     // Very dark blue
      ];
      
      const index = Math.min(Math.floor(normalized * (colors.length - 1)), colors.length - 2);
      const localNorm = (normalized * (colors.length - 1)) - index;
      
      const c1 = colors[index];
      const c2 = colors[index + 1];
      
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * localNorm);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * localNorm);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * localNorm);
      
      return [r, g, b];
    };

    // Bilinear interpolation with alpha for smooth edges
    const bilinearInterpolateWithAlpha = (x, y, values, latLen, lonLen) => {
      // Clamp coordinates
      const x0 = Math.max(0, Math.floor(x));
      const y0 = Math.max(0, Math.floor(y));
      const x1 = Math.min(x0 + 1, lonLen - 1);
      const y1 = Math.min(y0 + 1, latLen - 1);
      
      const xFrac = x - x0;
      const yFrac = y - y0;
      
      // Get four corner values
      const v00 = values[y0]?.[x0] ?? -999;
      const v01 = values[y0]?.[x1] ?? -999;
      const v10 = values[y1]?.[x0] ?? -999;
      const v11 = values[y1]?.[x1] ?? -999;
      
      // Check validity of each corner (1 = valid, 0 = invalid)
      const a00 = (v00 !== -999 && v00 >= 0) ? 1 : 0;
      const a01 = (v01 !== -999 && v01 >= 0) ? 1 : 0;
      const a10 = (v10 !== -999 && v10 >= 0) ? 1 : 0;
      const a11 = (v11 !== -999 && v11 >= 0) ? 1 : 0;
      
      // Interpolate alpha for smooth edge falloff
      const alpha0 = a00 * (1 - xFrac) + a01 * xFrac;
      const alpha1 = a10 * (1 - xFrac) + a11 * xFrac;
      const alpha = alpha0 * (1 - yFrac) + alpha1 * yFrac;
      
      if (alpha === 0) return { value: -999, alpha: 0 };
      
      // Replace invalid values with 0 for interpolation
      const val00 = a00 ? v00 : 0;
      const val01 = a01 ? v01 : 0;
      const val10 = a10 ? v10 : 0;
      const val11 = a11 ? v11 : 0;
      
      // Weight by validity for proper blending
      const w00 = a00 * (1 - xFrac) * (1 - yFrac);
      const w01 = a01 * xFrac * (1 - yFrac);
      const w10 = a10 * (1 - xFrac) * yFrac;
      const w11 = a11 * xFrac * yFrac;
      const totalWeight = w00 + w01 + w10 + w11;
      
      if (totalWeight === 0) return { value: -999, alpha: 0 };
      
      const value = (val00 * w00 + val01 * w01 + val10 * w10 + val11 * w11) / totalWeight;
      
      return { value, alpha };
    };

    const imageData = ctx.createImageData(width, height);
    const minVal = stats?.min ?? 0;
    const maxVal = stats?.max ?? 100;

    // Check if lat is ascending (south to north) or descending (north to south)
    const latAscending = lat[0] < lat[lat.length - 1];
    
    // Calculate the actual bounds from the data coordinates (not API bounds)
    // This ensures the overlay aligns with the actual data points
    const dataLatMin = Math.min(lat[0], lat[lat.length - 1]);
    const dataLatMax = Math.max(lat[0], lat[lat.length - 1]);
    const dataLonMin = Math.min(lon[0], lon[lon.length - 1]);
    const dataLonMax = Math.max(lon[0], lon[lon.length - 1]);
    
    // Calculate pixel size in geographic units
    const latStep = (dataLatMax - dataLatMin) / (lat.length - 1);
    const lonStep = (dataLonMax - dataLonMin) / (lon.length - 1);
    
    // Extend bounds by half a pixel to properly center the data
    const overlayBounds = {
      minLat: dataLatMin - latStep / 2,
      maxLat: dataLatMax + latStep / 2,
      minLon: dataLonMin - lonStep / 2,
      maxLon: dataLonMax + lonStep / 2
    };

    // Render with bilinear interpolation and smooth edges
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        // Map pixel coordinates back to data coordinates
        const dataX = (px / upscaleFactor);
        const dataY = (py / upscaleFactor);
        
        // Get interpolated value with alpha
        const result = bilinearInterpolateWithAlpha(
          dataX, 
          latAscending ? (lat.length - 1 - dataY) : dataY,
          values, 
          lat.length, 
          lon.length
        );
        
        const pixelIndex = (py * width + px) * 4;
        
        if (result.alpha > 0) {
          const color = getColor(result.value, minVal, maxVal);
          if (color) {
            imageData.data[pixelIndex] = color[0];     // R
            imageData.data[pixelIndex + 1] = color[1]; // G
            imageData.data[pixelIndex + 2] = color[2]; // B
            // Smooth alpha falloff at edges
            imageData.data[pixelIndex + 3] = Math.round(200 * result.alpha);
          } else {
            imageData.data[pixelIndex + 3] = 0;
          }
        } else {
          imageData.data[pixelIndex + 3] = 0; // Fully transparent for invalid values
        }
      }
    }
    
    ctx.putImageData(imageData, 0, 0);

    // Use calculated bounds that properly align with data pixel centers
    const bounds = L.latLngBounds(
      [overlayBounds.minLat, overlayBounds.minLon],  // Southwest corner
      [overlayBounds.maxLat, overlayBounds.maxLon]   // Northeast corner
    );

    console.log('Data bounds:', dataBounds);
    console.log('Overlay bounds (pixel-centered):', overlayBounds);

    // Create image overlay
    const imageUrl = canvas.toDataURL('image/png');
    const imageOverlay = L.imageOverlay(imageUrl, bounds, {
      opacity: opacity,
      interactive: false
    });

    imageOverlay.addTo(map);
    layerRef.current = imageOverlay;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, data, opacity]);

  return null;
}