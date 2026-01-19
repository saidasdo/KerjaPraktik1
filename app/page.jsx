'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { renderPrecipitationWebGL } from './PrecipitationLayerWebGL';

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
      
      const tileUrl = `https://a.basemaps.cartocdn.com/light_nolabels/${zoom}/${x}/${y}.png`;
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

// Format period YYYYMM to readable format like "December 2024"
const formatPeriod = (periodStr) => {
  if (!periodStr || periodStr.length !== 6) return periodStr;
  const year = periodStr.substring(0, 4);
  const month = parseInt(periodStr.substring(4, 6));
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[month - 1]} ${year}`;
};

// Format period for dropdown with short month
const formatPeriodShort = (periodStr) => {
  if (!periodStr || periodStr.length !== 6) return periodStr;
  const year = periodStr.substring(0, 4);
  const month = parseInt(periodStr.substring(4, 6));
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[month - 1]} ${year}`;
};

// Format time string "2024-12-01T00:00:00" to "1 Dec 2024" or "Dec 1, 2024"
const formatTime = (timeStr) => {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return timeStr;
  }
};

// Format time for title (longer format)
const formatTimeLong = (timeStr) => {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    const day = date.getDate();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return timeStr;
  }
};
// Parse binary precipitation data (much faster than JSON)
const parseBinaryPrecipData = (buffer) => {
  const view = new DataView(buffer);
  let offset = 0;
  
  // Read header (4 int32 + 9 float32 = 52 bytes)
  const latCount = view.getInt32(offset, true); offset += 4;
  const lonCount = view.getInt32(offset, true); offset += 4;
  const timeIndex = view.getInt32(offset, true); offset += 4;
  const totalTimes = view.getInt32(offset, true); offset += 4;
  
  const minLat = view.getFloat32(offset, true); offset += 4;
  const maxLat = view.getFloat32(offset, true); offset += 4;
  const minLon = view.getFloat32(offset, true); offset += 4;
  const maxLon = view.getFloat32(offset, true); offset += 4;
  
  const statsMin = view.getFloat32(offset, true); offset += 4;
  const statsMax = view.getFloat32(offset, true); offset += 4;
  const statsMean = view.getFloat32(offset, true); offset += 4;
  const actualMin = view.getFloat32(offset, true); offset += 4;
  const actualMax = view.getFloat32(offset, true); offset += 4;
  
  // Read lat array
  const lat = new Float32Array(buffer, offset, latCount);
  offset += latCount * 4;
  
  // Read lon array
  const lon = new Float32Array(buffer, offset, lonCount);
  offset += lonCount * 4;
  
  // Read values as 2D array (convert from flat Float32Array)
  const flatValues = new Float32Array(buffer, offset, latCount * lonCount);
  const values = [];
  for (let i = 0; i < latCount; i++) {
    values.push(Array.from(flatValues.slice(i * lonCount, (i + 1) * lonCount)));
  }
  
  return {
    lat: Array.from(lat),
    lon: Array.from(lon),
    values,
    bounds: { minLat, maxLat, minLon, maxLon },
    stats: {
      min: statsMin,
      max: statsMax,
      mean: statsMean,
      actualMin,
      actualMax
    },
    timeIndex,
    totalTimes
  };
};

// Fetch binary data (3-4x faster than JSON)
// subsample: 1 = full resolution, 2 = half resolution (4x less data), etc.
const fetchBinaryPrecipData = async (periodParam, timeParam, subsample = 1) => {
  const response = await fetch(
    `http://localhost:5000/api/precipitation/binary?period=${periodParam}&time=${timeParam}&subsample=${subsample}`
  );
  const buffer = await response.arrayBuffer();
  return parseBinaryPrecipData(buffer);
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
  
  // Animation state
  const [animationFrom, setAnimationFrom] = useState(0);
  const [animationTo, setAnimationTo] = useState(0);
  const [animationFps, setAnimationFps] = useState(2);
  const [isPlaying, setIsPlaying] = useState(false);
  const animationRef = useRef(null);
  const isPlayingRef = useRef(false);
  
  // Data cache for animation
  const [dataCache, setDataCache] = useState({});
  const [isCachingData, setIsCachingData] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ loaded: 0, total: 0 });

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
        // Set animation range to full period
        setAnimationFrom(0);
        setAnimationTo((data.times || []).length - 1);
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

    // Draw tiles from cache (label-free basemap - only coastlines and borders)
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
    }

    // Longitude lines (every 10 degrees)
    for (let ln = Math.ceil(bounds.minLon / 10) * 10; ln <= bounds.maxLon; ln += 10) {
      const p1 = geoToCanvas(bounds.minLat, ln);
      const p2 = geoToCanvas(bounds.maxLat, ln);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Create high-resolution canvas for WebGL rendering (increase multiplier for smoother edges)
    const dataCanvas = document.createElement('canvas');
    const resolutionMultiplier = 12; // Higher = smoother but slower
    dataCanvas.width = lon.length * resolutionMultiplier;
    dataCanvas.height = lat.length * resolutionMultiplier;
    
    // Calculate the actual bounds from the data coordinates
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
    
    // Render using WebGL (much faster!)
    renderPrecipitationWebGL(dataCanvas, data, stats.min, stats.max, 0.9);
    
    // Draw WebGL-rendered data onto main canvas using pixel-centered bounds
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

    // Title with period and time
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    
    // Get current time string for the title
    const currentTimeStr = availableTimes[data.timeIndex] || availableTimes[timeIndex] || '';
    const titleDate = formatTimeLong(currentTimeStr);
    const titlePeriod = formatPeriod(period);
    
    // Draw main title
    ctx.fillText(`Daily Precipitation - ${titlePeriod}`, width / 2, 40);
    
    // Draw date subtitle
    ctx.font = '22px Arial';
    ctx.fillText(titleDate, width / 2, 75);

    return canvas.toDataURL('image/png');
  };

  // Fetch precipitation data (using binary for speed)
  const fetchPrecipData = async () => {
    setLoading(true);
    try {
      const startTime = performance.now();
      const data = await fetchBinaryPrecipData(period, timeIndex);
      const elapsed = performance.now() - startTime;
      console.log(`Binary fetch took ${elapsed.toFixed(0)}ms`);
      
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

  // Auto-load data when period, timeIndex, or viewMode changes (only when not playing animation)
  useEffect(() => {
    if (period && availableTimes.length > 0 && !isPlaying) {
      // Add small delay to allow switch animation to complete
      const timer = setTimeout(() => {
        fetchPrecipData();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [period, timeIndex, viewMode]);

  // Pre-cache data for animation range (using binary for speed)
  const cacheAnimationData = async () => {
    const totalFrames = animationTo - animationFrom + 1;
    setCacheProgress({ loaded: 0, total: totalFrames });
    setIsCachingData(true);
    
    const newCache = {};
    const startTime = performance.now();
    
    for (let i = animationFrom; i <= animationTo; i++) {
      const cacheKey = `${period}_${i}`;
      
      // Skip if already cached
      if (dataCache[cacheKey]) {
        newCache[cacheKey] = dataCache[cacheKey];
        setCacheProgress(prev => ({ ...prev, loaded: prev.loaded + 1 }));
        continue;
      }
      
      try {
        const data = await fetchBinaryPrecipData(period, i);
        newCache[cacheKey] = data;
      } catch (error) {
        console.error(`Error caching frame ${i}:`, error);
      }
      
      setCacheProgress(prev => ({ ...prev, loaded: prev.loaded + 1 }));
    }
    
    const elapsed = performance.now() - startTime;
    console.log(`Cached ${totalFrames} frames in ${elapsed.toFixed(0)}ms (${(elapsed/totalFrames).toFixed(0)}ms per frame)`);
    
    setDataCache(prev => ({ ...prev, ...newCache }));
    setIsCachingData(false);
    return newCache;
  };

  // Animation playback logic - fetches frames on-demand for instant start
  const playAnimation = async () => {
    if (isPlaying) return;
    
    setIsPlaying(true);
    isPlayingRef.current = true;
    setTimeIndex(animationFrom);
    
    let currentFrame = animationFrom;
    const localCache = { ...dataCache }; // Local copy to avoid state sync issues
    const ANIMATION_SUBSAMPLE = 2; // Use lower resolution for smoother animation (4x less data)
    const PREFETCH_COUNT = 3; // Number of frames to prefetch ahead
    
    // Prefetch next frames in parallel
    const prefetchFrames = (fromFrame) => {
      const promises = [];
      for (let i = 1; i <= PREFETCH_COUNT; i++) {
        let nextFrame = fromFrame + i;
        if (nextFrame > animationTo) nextFrame = animationFrom + (nextFrame - animationTo - 1);
        const cacheKey = `${period}_${nextFrame}_anim`;
        if (!localCache[cacheKey]) {
          promises.push(
            fetchBinaryPrecipData(period, nextFrame, ANIMATION_SUBSAMPLE)
              .then(data => {
                localCache[cacheKey] = data;
              })
              .catch(() => {})
          );
        }
      }
      // Fire and forget - don't await
      Promise.all(promises);
    };
    
    const animate = async () => {
      if (!isPlayingRef.current) return;
      
      const cacheKey = `${period}_${currentFrame}_anim`;
      let frameData = localCache[cacheKey];
      
      // Fetch on-demand if not cached (with lower resolution for speed)
      if (!frameData) {
        try {
          frameData = await fetchBinaryPrecipData(period, currentFrame, ANIMATION_SUBSAMPLE);
          localCache[cacheKey] = frameData;
        } catch (error) {
          console.error(`Error fetching frame ${currentFrame}:`, error);
        }
      }
      
      // Prefetch upcoming frames in background
      prefetchFrames(currentFrame);
      
      if (frameData && isPlayingRef.current) {
        setPrecipData(frameData);
        if (viewMode === 'png') {
          const png = await generatePNG(frameData);
          setPngImage(png);
        }
      }
      
      currentFrame++;
      if (currentFrame > animationTo) {
        currentFrame = animationFrom; // Loop
      }
      setTimeIndex(currentFrame);
      
      if (isPlayingRef.current) {
        animationRef.current = setTimeout(animate, 1000 / animationFps);
      }
    };
    
    animate();
  };

  const stopAnimation = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (animationRef.current) {
      clearTimeout(animationRef.current);
      animationRef.current = null;
    }
  };

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, []);

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
                    {formatPeriodShort(p)}
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
                    {formatTime(time)}
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

          {/* Animation Controls */}
          <div className="animation-controls" style={{ 
            marginTop: '20px', 
            padding: '15px', 
            backgroundColor: '#f5f5f5', 
            borderRadius: '10px',
            border: '1px solid #ddd'
          }}>
            <h4 style={{ marginBottom: '15px', color: '#333' }}>Animation Controls</h4>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', alignItems: 'center' }}>
              {/* From Time */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>From:</label>
                <select
                  value={animationFrom}
                  onChange={(e) => setAnimationFrom(parseInt(e.target.value))}
                  disabled={isPlaying}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ccc', minWidth: '150px' }}
                >
                  {availableTimes.map((time, idx) => (
                    <option key={idx} value={idx}>{formatTime(time)}</option>
                  ))}
                </select>
              </div>

              {/* To Time */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>To:</label>
                <select
                  value={animationTo}
                  onChange={(e) => setAnimationTo(parseInt(e.target.value))}
                  disabled={isPlaying}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ccc', minWidth: '150px' }}
                >
                  {availableTimes.map((time, idx) => (
                    <option key={idx} value={idx}>{formatTime(time)}</option>
                  ))}
                </select>
              </div>

              {/* FPS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>FPS:</label>
                <select
                  value={animationFps}
                  onChange={(e) => setAnimationFps(parseInt(e.target.value))}
                  disabled={isPlaying}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ccc', minWidth: '80px' }}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </div>

              {/* Play/Stop Buttons */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <button
                  onClick={playAnimation}
                  disabled={isPlaying || availableTimes.length === 0}
                  style={{
                    padding: '10px 25px',
                    backgroundColor: isPlaying ? '#ccc' : '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: isPlaying ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  ▶ Play
                </button>
                <button
                  onClick={stopAnimation}
                  disabled={!isPlaying}
                  style={{
                    padding: '10px 25px',
                    backgroundColor: !isPlaying ? '#ccc' : '#dc3545',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: !isPlaying ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                >
                  ⏹ Stop
                </button>
              </div>
            </div>

            {/* Caching progress */}
            {isCachingData && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  fontSize: '12px', 
                  color: '#666',
                  marginBottom: '5px'
                }}>
                  <span>Caching data for smooth playback...</span>
                  <span>{cacheProgress.loaded} / {cacheProgress.total}</span>
                </div>
                <div style={{ 
                  height: '6px', 
                  backgroundColor: '#ddd', 
                  borderRadius: '3px', 
                  overflow: 'hidden' 
                }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${(cacheProgress.loaded / cacheProgress.total) * 100}%`,
                    backgroundColor: '#ffc107',
                    transition: 'width 0.1s ease'
                  }}></div>
                </div>
              </div>
            )}

            {/* Playback progress indicator */}
            {isPlaying && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  fontSize: '12px', 
                  color: '#666',
                  marginBottom: '5px'
                }}>
                  <span>Frame: {timeIndex - animationFrom + 1} / {animationTo - animationFrom + 1}</span>
                  <span>{formatTime(availableTimes[timeIndex])}</span>
                </div>
                <div style={{ 
                  height: '6px', 
                  backgroundColor: '#ddd', 
                  borderRadius: '3px', 
                  overflow: 'hidden' 
                }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${((timeIndex - animationFrom) / (animationTo - animationFrom)) * 100}%`,
                    backgroundColor: '#0000CD',
                    transition: 'width 0.1s ease'
                  }}></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}