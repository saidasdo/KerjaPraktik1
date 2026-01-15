'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const Map = dynamic(() => import('./Map'), { ssr: false });

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

    // Draw simple coastlines using Stamen Toner Lite (black and white, no labels)
    const zoom = 6;
    
    // Calculate tile range
    const latToTile = (lat, zoom) => {
      return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    };
    const lonToTile = (lon, zoom) => {
      return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
    };
    
    const minTileX = lonToTile(bounds.minLon, zoom);
    const maxTileX = lonToTile(bounds.maxLon, zoom);
    const minTileY = latToTile(bounds.maxLat, zoom);
    const maxTileY = latToTile(bounds.minLat, zoom);
    
    // Load and draw tiles (using Stamen Toner Lite - just coastlines, no labels)
    const tilePromises = [];
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        // Using Stamen Toner Lite for simple black and white coastlines without labels
        const tileUrl = `https://tiles.stadiamaps.com/tiles/stamen_toner_lite/${zoom}/${x}/${y}.png`;
        const promise = new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve({ img, x, y });
          img.onerror = () => resolve(null);
          img.src = tileUrl;
        });
        tilePromises.push(promise);
      }
    }
    
    const tiles = await Promise.all(tilePromises);
    
    // Draw tiles
    tiles.forEach(tile => {
      if (!tile) return;
      const { img, x, y } = tile;
      
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
    });

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
    
    // Draw smoothed data onto main canvas
    const mapTopLeft = geoToCanvas(bounds.maxLat, bounds.minLon);
    const mapBottomRight = geoToCanvas(bounds.minLat, bounds.maxLon);
    
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

  return (
    <div className="app">
      <h1>Tes 1</h1>

      <div className="content-wrapper">
        <div className="controls-section">
          {/* Add precipitation controls */}
          <section className="control-group">
            <h3>Precipitation Data:</h3>
            
            <div className="dropdown-row" style={{ marginBottom: '10px' }}>
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
            
            <div className="dropdown-row">
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
              <button onClick={fetchPrecipData} disabled={loading}>
                {loading ? 'Loading...' : 'Load Data'}
              </button>
            </div>

            <div className="dropdown-row" style={{ marginTop: '10px' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>View Mode:</label>
              <select 
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="leaflet">Interactive Map (Leaflet)</option>
                <option value="png">Static Image (PNG)</option>
              </select>
            </div>
            
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

          {/* ... your existing controls ... */}
        </div>

        <div className="image-section">
          {/* ... your existing content ... */}
          
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