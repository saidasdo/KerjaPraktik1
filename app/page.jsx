'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

const Map = dynamic(() => import('./Map'), { ssr: false });

// Tile cache - using plain object for better compatibility with Next.js hot reload
const tileCache = {};

// Default bounds for Indonesia region
const DEFAULT_BOUNDS = {
  minLat: -11,
  maxLat: 6,
  minLon: 95,
  maxLon: 141
};

// Pre-calculate tile coordinates for caching
const getTileCoordinates = (bounds, zoom) => {
  const latToTile = (lat, z) => {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
  };
  const lonToTile = (lon, z) => {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
  };
  
  return {
    minTileX: lonToTile(bounds.minLon, zoom),
    maxTileX: lonToTile(bounds.maxLon, zoom),
    minTileY: latToTile(bounds.maxLat, zoom),
    maxTileY: latToTile(bounds.minLat, zoom)
  };
};

// Function to pre-load and cache tiles
const preloadTiles = async (bounds, zoom, onProgress) => {
  const { minTileX, maxTileX, minTileY, maxTileY } = getTileCoordinates(bounds, zoom);
  const totalTiles = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1);
  let loadedCount = 0;
  
  const tilePromises = [];
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      const tileKey = `${zoom}/${x}/${y}`;
      
      // Skip if already cached
      if (tileCache[tileKey]) {
        loadedCount++;
        if (onProgress) onProgress(loadedCount, totalTiles);
        continue;
      }
      
      const tileUrl = `https://tiles.stadiamaps.com/tiles/stamen_toner_lite/${zoom}/${x}/${y}.png`;
      const promise = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          tileCache[tileKey] = img;
          loadedCount++;
          if (onProgress) onProgress(loadedCount, totalTiles);
          resolve({ img, x, y });
        };
        img.onerror = () => {
          loadedCount++;
          if (onProgress) onProgress(loadedCount, totalTiles);
          resolve(null);
        };
        img.src = tileUrl;
      });
      tilePromises.push(promise);
    }
  }
  
  await Promise.all(tilePromises);
  return true;
};

// Get cached tile
const getCachedTile = (x, y, zoom) => {
  const tileKey = `${zoom}/${x}/${y}`;
  return tileCache[tileKey] || null;
};

export default function Home() {
  // ... your existing state ...
  
  const [precipData, setPrecipData] = useState(null);
  const [period, setPeriod] = useState('202512');
  const [timeIndex, setTimeIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [viewMode, setViewMode] = useState('leaflet'); // 'leaflet' or 'png'
  const [pngImage, setPngImage] = useState(null);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [tileLoadProgress, setTileLoadProgress] = useState({ loaded: 0, total: 0 });

  // Pre-load tiles on mount
  useEffect(() => {
    const loadTiles = async () => {
      console.log('Pre-loading map tiles...');
      await preloadTiles(DEFAULT_BOUNDS, 6, (loaded, total) => {
        setTileLoadProgress({ loaded, total });
      });
      setTilesLoaded(true);
      console.log('Map tiles cached successfully!');
    };
    
    loadTiles();
  }, []);

  // Fetch available periods on mount
  useEffect(() => {
    fetch('http://localhost:5000/api/periods')
      .then(res => res.json())
      .then(data => setAvailablePeriods(data.periods))
      .catch(err => console.error('Error fetching periods:', err));
  }, []);

  // Fetch available times when period changes
  useEffect(() => {
    if (!period) return;
    
    fetch(`http://localhost:5000/api/times?period=${period}`)
      .then(res => res.json())
      .then(data => {
        setAvailableTimes(data.times || []);
        setTimeIndex(0); // Reset time index when period changes
      })
      .catch(err => console.error('Error fetching times:', err));
  }, [period]);

  // Generate PNG from precipitation data (matching matplotlib style)
  const generatePNG = async (data) => {
    if (!data || !data.lat || !data.lon || !data.values) return null;

    const { lat, lon, values, stats, bounds } = data;
    
    // Match matplotlib figure size: 14x8 inches at 150 DPI
    const dpi = 150;
    const width = 14 * dpi;  // 2100px
    const height = 8 * dpi;  // 1200px
    const padding = { left: 120, right: 200, top: 120, bottom: 140 };
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    // Calculate map area
    const mapWidth = width - padding.left - padding.right;
    const mapHeight = height - padding.top - padding.bottom;
    
    // Geographic bounds
    const latRange = bounds.maxLat - bounds.minLat;
    const lonRange = bounds.maxLon - bounds.minLon;

    // Convert lat/lon to canvas coordinates
    const geoToCanvas = (lt, ln) => {
      const x = padding.left + ((ln - bounds.minLon) / lonRange) * mapWidth;
      const y = padding.top + mapHeight - ((lt - bounds.minLat) / latRange) * mapHeight;
      return { x, y };
    };

    // Draw tiles from cache (using Stamen Toner Lite - just coastlines, no labels)
    const zoom = 6;
    const { minTileX, maxTileX, minTileY, maxTileY } = getTileCoordinates(bounds, zoom);
    
    // Draw tiles from cache (instant - no network requests!)
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        const img = getCachedTile(x, y, zoom);
        if (!img) continue;
        
        // Convert tile coordinates to lat/lon bounds
        const n = Math.pow(2, zoom);
        const tileLonMin = x / n * 360 - 180;
        const tileLonMax = (x + 1) / n * 360 - 180;
        const tileLatMax = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
        const tileLatMin = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
        
        // Convert to canvas coordinates
        const topLeft = geoToCanvas(tileLatMax, tileLonMin);
        const bottomRight = geoToCanvas(tileLatMin, tileLonMax);
        
        ctx.drawImage(img, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
      }
    }

    // Draw gridlines with labels (matching matplotlib style)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.fillStyle = '#000';
    ctx.font = '18px Arial';

    // Latitude lines (every 5 degrees)
    for (let lt = Math.ceil(bounds.minLat / 5) * 5; lt <= bounds.maxLat; lt += 5) {
      const p1 = geoToCanvas(lt, bounds.minLon);
      const p2 = geoToCanvas(lt, bounds.maxLon);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      
      // Label
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${lt}°`, padding.left - 15, p1.y);
    }

    // Longitude lines (every 10 degrees)
    for (let ln = Math.ceil(bounds.minLon / 10) * 10; ln <= bounds.maxLon; ln += 10) {
      const p1 = geoToCanvas(bounds.minLat, ln);
      const p2 = geoToCanvas(bounds.maxLat, ln);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      
      // Label
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${ln}°`, p1.x, padding.top + mapHeight + 15);
    }

    // Create high-resolution interpolated canvas
    const dataCanvas = document.createElement('canvas');
    const interpFactor = 4; // Interpolation factor for smoother appearance
    dataCanvas.width = lon.length * interpFactor;
    dataCanvas.height = lat.length * interpFactor;
    const dataCtx = dataCanvas.getContext('2d');
    
    // Calculate the actual bounds from the data coordinates
    // This ensures the overlay aligns with the actual data points
    const dataLatMin = Math.min(lat[0], lat[lat.length - 1]);
    const dataLatMax = Math.max(lat[0], lat[lat.length - 1]);
    const dataLonMin = Math.min(lon[0], lon[lon.length - 1]);
    const dataLonMax = Math.max(lon[0], lon[lon.length - 1]);
    
    // Calculate pixel size in geographic units
    const latStep = (dataLatMax - dataLatMin) / (lat.length - 1);
    const lonStep = (dataLonMax - dataLonMin) / (lon.length - 1);
    
    // Extend bounds by half a pixel to properly center the data
    const dataBounds = {
      minLat: dataLatMin - latStep / 2,
      maxLat: dataLatMax + latStep / 2,
      minLon: dataLonMin - lonStep / 2,
      maxLon: dataLonMax + lonStep / 2
    };
    
    // First, draw original data to small canvas
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = lon.length;
    smallCanvas.height = lat.length;
    const smallCtx = smallCanvas.getContext('2d');
    const imageData = smallCtx.createImageData(lon.length, lat.length);
    const latAscending = lat[0] < lat[lat.length - 1];
    
    for (let i = 0; i < lat.length; i++) {
      for (let j = 0; j < lon.length; j++) {
        const value = values[i][j];
        const canvasY = latAscending ? (lat.length - 1 - i) : i;
        const pixelIndex = (canvasY * lon.length + j) * 4;
        
        if (value !== -999 && value >= 0) {
          const normalized = Math.max(0, Math.min(1, (value - stats.min) / (stats.max - stats.min + 0.001)));
          const colors = [[255,255,204],[199,233,180],[127,205,187],[65,182,196],[29,145,192],[34,94,168],[12,44,132]];
          const index = Math.min(Math.floor(normalized * (colors.length - 1)), colors.length - 2);
          const localNorm = (normalized * (colors.length - 1)) - index;
          const c1 = colors[index], c2 = colors[index + 1];
          
          imageData.data[pixelIndex] = Math.round(c1[0] + (c2[0] - c1[0]) * localNorm);
          imageData.data[pixelIndex + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * localNorm);
          imageData.data[pixelIndex + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * localNorm);
          imageData.data[pixelIndex + 3] = 255;
        } else {
          imageData.data[pixelIndex + 3] = 0;
        }
      }
    }
    
    smallCtx.putImageData(imageData, 0, 0);
    
    // Interpolate to higher resolution
    dataCtx.imageSmoothingEnabled = true;
    dataCtx.imageSmoothingQuality = 'high';
    dataCtx.drawImage(smallCanvas, 0, 0, dataCanvas.width, dataCanvas.height);
    
    // Draw smoothed data onto main canvas using pixel-centered bounds
    const mapTopLeft = geoToCanvas(dataBounds.maxLat, dataBounds.minLon);
    const mapBottomRight = geoToCanvas(dataBounds.minLat, dataBounds.maxLon);
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(dataCanvas, 
      mapTopLeft.x, mapTopLeft.y, 
      mapBottomRight.x - mapTopLeft.x, 
      mapBottomRight.y - mapTopLeft.y
    );

    // Draw border around map
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(padding.left, padding.top, mapWidth, mapHeight);

    // Draw colorbar (vertical, matching matplotlib style)
    const colorbarX = width - padding.right + 30;
    const colorbarY = padding.top;
    const colorbarWidth = 30;
    const colorbarHeight = mapHeight;
    
    // Draw gradient
    const gradient = ctx.createLinearGradient(0, colorbarY + colorbarHeight, 0, colorbarY);
    const colors = ['#FFFFCC', '#C7E9B4', '#7FCDBB', '#41B6C4', '#1D91C0', '#225EA8', '#0C2C84'];
    colors.forEach((color, i) => {
      gradient.addColorStop(i / (colors.length - 1), color);
    });
    
    ctx.fillStyle = gradient;
    ctx.fillRect(colorbarX, colorbarY, colorbarWidth, colorbarHeight);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(colorbarX, colorbarY, colorbarWidth, colorbarHeight);

    // Colorbar ticks and labels
    ctx.fillStyle = '#000';
    ctx.font = '20px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const ticks = [0, 20, 40, 60, 80, 100];
    ticks.forEach(tick => {
      const y = colorbarY + colorbarHeight - (tick / stats.max) * colorbarHeight;
      ctx.beginPath();
      ctx.moveTo(colorbarX + colorbarWidth, y);
      ctx.lineTo(colorbarX + colorbarWidth + 5, y);
      ctx.stroke();
      ctx.fillText(tick.toString(), colorbarX + colorbarWidth + 10, y);
    });

    // Colorbar label
    ctx.save();
    ctx.translate(colorbarX + colorbarWidth + 80, padding.top + mapHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Daily Precipitation (mm)', 0, 0);
    ctx.restore();

    // Title
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText('Daily Precipitation - Indonesia Region', width / 2, 60);

    return canvas.toDataURL('image/png');
  };

  // Fetch precipitation data
  const fetchPrecipData = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `http://localhost:5000/api/precipitation?period=${period}&time=${timeIndex}&subsample=1`
      );
      const data = await response.json();
      setPrecipData(data);
      if (viewMode === 'png') {
        const png = await generatePNG(data);
        setPngImage(png);
      }
    } catch (error) {
      console.error('Error fetching precipitation data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Regenerate PNG when switching modes
  useEffect(() => {
    if (viewMode === 'png' && precipData) {
      const png = generatePNG(precipData);
      setPngImage(png);
    }
  }, [viewMode]);

  // Auto-load data when period, timeIndex, or viewMode changes
  useEffect(() => {
    if (period && availableTimes.length > 0) {
      // Add small delay to allow switch animation to complete
      const timer = setTimeout(() => {
        fetchPrecipData();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [period, timeIndex, viewMode]);

  return (
    <div className="app">
      <h1>Precipitation Data</h1>
      <div className="content-wrapper">
        <div className="controls-section">
          <section className="control-group">
            {/* View Mode Switch - First */}
            <div className="dropdown-row" style={{ marginBottom: '15px' }}>
              <div style={{ 
                display: 'flex', 
                width: '100%',
                backgroundColor: '#0000CD', 
                borderRadius: '10px', 
                padding: '4px',
                gap: '0'
              }}>
                <button
                  onClick={() => setViewMode('leaflet')}
                  style={{
                    flex: 1,
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '14px',
                    transition: 'all 0.3s ease',
                    backgroundColor: viewMode === 'leaflet' ? 'white' : 'transparent',
                    color: viewMode === 'leaflet' ? '#0000CD' : 'white',
                    boxShadow: viewMode === 'leaflet' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  Interactive
                </button>
                <button
                  onClick={() => setViewMode('png')}
                  style={{
                    flex: 1,
                    padding: '10px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '14px',
                    transition: 'all 0.3s ease',
                    backgroundColor: viewMode === 'png' ? 'white' : 'transparent',
                    color: viewMode === 'png' ? '#0000CD' : 'white',
                    boxShadow: viewMode === 'png' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  Static
                </button>
              </div>
            </div>

            {/* Period - Second */}
            <div className="dropdown-row" style={{ marginBottom: '15px' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Period:</label>
              <select 
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={{ flex: 1 }}
              >
                {availablePeriods.map((p) => (
                  <option key={p} value={p}>
                    {p.substring(0, 4)}-{p.substring(4, 6)}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Time - Third */}
            <div className="dropdown-row" style={{ marginBottom: '15px' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Time:</label>
              <select 
                value={timeIndex}
                onChange={(e) => setTimeIndex(parseInt(e.target.value))}
                style={{ flex: 1 }}
              >
                <option value="">Select Time</option>
                {availableTimes.map((time, idx) => (
                  <option key={idx} value={idx}>
                    {time}
                  </option>
                ))}
              </select>
              {loading && <span style={{ marginLeft: '10px', color: '#666' }}>Loading...</span>}
            </div>
            
            {/* Stats */}
            {precipData && precipData.stats && (
              <div style={{ marginTop: '10px', fontSize: '12px' }}>
                <p>Min: {precipData.stats.min?.toFixed(2) ?? 'N/A'} mm</p>
                <p>Max: {precipData.stats.max?.toFixed(2) ?? 'N/A'} mm</p>
                <p>Mean: {precipData.stats.mean?.toFixed(2) ?? 'N/A'} mm</p>
                {precipData.stats.actualMax && (
                  <p style={{ fontSize: '11px', color: '#666' }}>
                    Actual: {precipData.stats.actualMin?.toFixed(1)} - {precipData.stats.actualMax?.toFixed(1)} mm
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Visualization - Fourth */}
        <div className="image-section">
          <div className="map-display">
            <h3>Precipitation Visualization:</h3>
            {viewMode === 'leaflet' ? (
              <Map precipData={precipData} />
            ) : (
              <div style={{ marginTop: '20px' }}>
                {pngImage ? (
                  <img 
                    src={pngImage} 
                    alt="Precipitation PNG" 
                    style={{ 
                      width: '100%', 
                      height: 'auto',
                      border: '1px solid #ccc'
                    }} 
                  />
                ) : (
                  <p>Load data to view PNG</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}