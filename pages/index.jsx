import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { renderPrecipitationWebGL } from '../components/PrecipitationLayerWebGL';

const Map = dynamic(() => import('../components/Map'), { ssr: false });

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

// Format period for dropdown with short month (Initial only)
const formatPeriodShort = (periodStr) => {
  if (!periodStr || periodStr.length !== 6) return periodStr;
  const year = parseInt(periodStr.substring(0, 4));
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
  } catch (e) {
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
  } catch (e) {
    return timeStr;
  }
};

// Format time range for 10-day periods
const formatTimeRange = (startTimeStr, endTimeStr) => {
  if (!startTimeStr) return '';
  try {
    const startDate = new Date(startTimeStr);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startDay = startDate.getDate();
    const startMonth = monthNames[startDate.getMonth()];
    const startYear = startDate.getFullYear();
    
    if (endTimeStr) {
      const endDate = new Date(endTimeStr);
      const endDay = endDate.getDate();
      const endMonth = monthNames[endDate.getMonth()];
      const endYear = endDate.getFullYear();
      
      if (startMonth === endMonth && startYear === endYear) {
        return `${startDay}-${endDay} ${startMonth} ${startYear}`;
      }
      return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${startYear}`;
    }
    return `${startDay} ${startMonth} ${startYear}`;
  } catch (e) {
    return startTimeStr;
  }
};

// Format month for monthly view
const formatMonth = (timeStr) => {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  } catch (e) {
    return timeStr;
  }
};

// Filter times based on data range selection
const filterTimesByDataRange = (times, dataRange) => {
  if (!times || times.length === 0) return [];
  
  if (dataRange === 'daily') {
    return times.map((time, idx) => ({
      label: formatTime(time),
      value: idx,
      startIdx: idx,
      endIdx: idx,
      times: [time]
    }));
  }
  
  if (dataRange === '10day') {
    // Group into 10-day periods (1-10, 11-20, 21-end of month)
    const groups = [];
    let currentGroup = null;
    
    times.forEach((time, idx) => {
      const date = new Date(time);
      const day = date.getDate();
      const month = date.getMonth();
      const year = date.getFullYear();
      
      // Determine which 10-day period (dekad)
      let dekad;
      if (day <= 10) dekad = 1;
      else if (day <= 20) dekad = 2;
      else dekad = 3;
      
      const groupKey = `${year}-${month}-${dekad}`;
      
      if (!currentGroup || currentGroup.key !== groupKey) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          key: groupKey,
          startIdx: idx,
          endIdx: idx,
          times: [time],
          dekad,
          month,
          year
        };
      } else {
        currentGroup.endIdx = idx;
        currentGroup.times.push(time);
      }
    });
    
    if (currentGroup) {
      groups.push(currentGroup);
    }
    
    return groups.map((g, i) => {
      const startTime = g.times[0];
      const endTime = g.times[g.times.length - 1];
      return {
        label: formatTimeRange(startTime, endTime),
        value: i,
        startIdx: g.startIdx,
        endIdx: g.endIdx,
        times: g.times
      };
    });
  }
  
  if (dataRange === 'monthly') {
    // Group by month
    const groups = [];
    let currentGroup = null;
    
    times.forEach((time, idx) => {
      const date = new Date(time);
      const month = date.getMonth();
      const year = date.getFullYear();
      const groupKey = `${year}-${month}`;
      
      if (!currentGroup || currentGroup.key !== groupKey) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          key: groupKey,
          startIdx: idx,
          endIdx: idx,
          times: [time],
          month,
          year
        };
      } else {
        currentGroup.endIdx = idx;
        currentGroup.times.push(time);
      }
    });
    
    if (currentGroup) {
      groups.push(currentGroup);
    }
    
    return groups.map((g, i) => ({
      label: formatMonth(g.times[0]),
      value: i,
      startIdx: g.startIdx,
      endIdx: g.endIdx,
      times: g.times
    }));
  }
  
  return [];
};

// Parse binary precipitation data (much faster than JSON)
const parseBinaryPrecipData = (buffer) => {
  const view = new DataView(buffer);
  let offset = 0;
  
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
  
  const lat = new Float32Array(buffer, offset, latCount);
  offset += latCount * 4;
  
  const lon = new Float32Array(buffer, offset, lonCount);
  offset += lonCount * 4;
  
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
// Using subsample=1 for full quality
const fetchBinaryPrecipData = async (periodParam, timeParam, subsample = 1) => {
  const response = await fetch(
    `http://172.19.1.191:5000/api/precipitation/binary?period=${periodParam}&time=${timeParam}&subsample=${subsample}`
  );
  const buffer = await response.arrayBuffer();
  return parseBinaryPrecipData(buffer);
};

// Fetch aggregated binary data (for 10-day and monthly views)
const fetchAggregatedPrecipData = async (periodParam, startTime, endTime, subsample = 1) => {
  const response = await fetch(
    `http://172.19.1.191:5000/api/precipitation/aggregated/binary?period=${periodParam}&start_time=${startTime}&end_time=${endTime}&subsample=${subsample}`
  );
  const buffer = await response.arrayBuffer();
  return parseBinaryPrecipData(buffer);
};

export default function Home() {
  const [precipData, setPrecipData] = useState(null);
  const [period, setPeriod] = useState('');
  const [timeIndex, setTimeIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [availablePeriods, setAvailablePeriods] = useState([]);
  const [viewMode, setViewMode] = useState('leaflet'); // 'leaflet' or 'png'
  const [pngImage, setPngImage] = useState(null);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [tileLoadProgress, setTileLoadProgress] = useState({ loaded: 0, total: 0 });
  
  // Data range selection: 'daily', '10day', 'monthly'
  const [dataRange, setDataRange] = useState('daily');
  const [filteredTimeOptions, setFilteredTimeOptions] = useState([]);
  const [selectedTimeOption, setSelectedTimeOption] = useState(0);
  
  // Animation state
  const [animationFrom, setAnimationFrom] = useState(0);
  const [animationTo, setAnimationTo] = useState(0);
  const [animationFps, setAnimationFps] = useState(2);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationCurrentFrame, setAnimationCurrentFrame] = useState(0);
  const animationRef = useRef(null);
  const isPlayingRef = useRef(false);
  
  // Data cache for animation
  const [dataCache, setDataCache] = useState({});
  const [isCachingData, setIsCachingData] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ loaded: 0, total: 0 });
  
  // Backend prefetch state
  const [isPrefetching, setIsPrefetching] = useState(false);
  const [prefetchStatus, setPrefetchStatus] = useState(null);
  const prefetchAbortRef = useRef(null);
  
  // Function to start/restart prefetch for current period
  const startPrefetch = (targetPeriod) => {
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
    }
    
    const abortController = new AbortController();
    prefetchAbortRef.current = abortController;
    
    setIsPrefetching(true);
    setPrefetchStatus({ period: targetPeriod, status: 'loading', cached: 0, total: 0 });
    
    console.log(`Starting prefetch for ${targetPeriod}...`);
    
    fetch(`http://172.19.1.191:5000/api/prefetch?period=${targetPeriod}&subsample=1`, {
      signal: abortController.signal
    })
      .then(res => res.json())
      .then(data => {
        console.log(`Backend prefetch complete: ${data.newlyCached} new, ${data.alreadyCached} cached in ${data.elapsedSeconds}s`);
        setPrefetchStatus({ 
          period: targetPeriod, 
          status: 'done', 
          cached: data.newlyCached + data.alreadyCached, 
          total: data.totalTimes,
          elapsed: data.elapsedSeconds 
        });
        setIsPrefetching(false);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Prefetch error:', err);
          setPrefetchStatus({ period: targetPeriod, status: 'error' });
        } else {
          console.log(`Prefetch paused for ${targetPeriod}`);
        }
        setIsPrefetching(false);
      });
  };

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
    fetch('http://172.19.1.191:5000/api/periods')
      .then(res => res.json())
      .then(data => {
        const sorted = [...data.periods].sort((a, b) => b.localeCompare(a));
        setAvailablePeriods(sorted);
        if (sorted.length > 0 && !period) {
          setPeriod(sorted[0]);
        }
      })
      .catch(err => console.error('Error fetching periods:', err));
  }, []);

  // Fetch available times when period changes + trigger backend prefetch
  useEffect(() => {
    if (!period) return;
    
    if (prefetchAbortRef.current) {
      prefetchAbortRef.current.abort();
    }
    
    fetch(`http://172.19.1.191:5000/api/times?period=${period}`)
      .then(res => res.json())
      .then(data => {
        setAvailableTimes(data.times || []);
        setTimeIndex(0); // Reset time index when period changes
        setSelectedTimeOption(0); // Reset selected time option
        setAnimationFrom(0);
        setAnimationTo((data.times || []).length - 1);
      })
      .catch(err => console.error('Error fetching times:', err));
    
    startPrefetch(period);
  }, [period]);
  
  // Update filtered time options when availableTimes or dataRange changes
  useEffect(() => {
    const filtered = filterTimesByDataRange(availableTimes, dataRange);
    setFilteredTimeOptions(filtered);
    setSelectedTimeOption(0);
    
    if (filtered.length > 0) {
      setTimeIndex(filtered[0].startIdx);
      setAnimationFrom(0);
      setAnimationTo(filtered.length - 1);
    }
  }, [availableTimes, dataRange]);

  // Generate PNG from precipitation data (BMKG style)
  const generatePNG = async (data) => {
    if (!data || !data.lat || !data.lon || !data.values) return null;

    const { lat, lon, values, stats, bounds: dataBoundsOriginal } = data;
    
    // Use tighter bounds focused on Indonesia (crop extra ocean space)
    const bounds = {
      minLat: -12,   // Southern tip of Indonesia
      maxLat: 7,     // Northern Aceh
      minLon: 94,    // Western Sumatra
      maxLon: 142    // Eastern Papua
    };
    
    // Calculate proper aspect ratio based on geographic bounds
    const geoAspectRatio = (bounds.maxLon - bounds.minLon) / (bounds.maxLat - bounds.minLat);
    
    // Set canvas size - BMKG style layout (larger for more zoom)
    const dpi = 150;
    const baseWidth = 20 * dpi;  // 4000px base width for more detail
    const width = baseWidth;
    const height = Math.round(baseWidth / geoAspectRatio) + 350; // More space for title and colorbar
    const padding = { left: 100, right: 50, top: 140, bottom: 210 }; // Adjusted padding
    
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);

    const mapWidth = width - padding.left - padding.right;
    const mapHeight = height - padding.top - padding.bottom;
    
    const latRange = bounds.maxLat - bounds.minLat;
    const lonRange = bounds.maxLon - bounds.minLon;

    const geoToCanvas = (lt, ln) => {
      const x = padding.left + ((ln - bounds.minLon) / lonRange) * mapWidth;
      const y = padding.top + mapHeight - ((lt - bounds.minLat) / latRange) * mapHeight;
      return { x, y };
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, mapWidth, mapHeight);
    ctx.clip();

    const zoom = 6;
    const { minTileX, maxTileX, minTileY, maxTileY } = getTileCoordinates(bounds, zoom);
    
    for (let x = minTileX; x <= maxTileX; x++) {
      for (let y = minTileY; y <= maxTileY; y++) {
        const img = getCachedTile(x, y, zoom);
        if (!img) continue;
        
        const n = Math.pow(2, zoom);
        const tileLonMin = x / n * 360 - 180;
        const tileLonMax = (x + 1) / n * 360 - 180;
        const tileLatMax = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
        const tileLatMin = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
        
        const topLeft = geoToCanvas(tileLatMax, tileLonMin);
        const bottomRight = geoToCanvas(tileLatMin, tileLonMax);
        
        ctx.drawImage(img, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
      }
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1.5;

    for (let lt = Math.ceil(bounds.minLat / 5) * 5; lt <= bounds.maxLat; lt += 5) {
      const p1 = geoToCanvas(lt, bounds.minLon);
      const p2 = geoToCanvas(lt, bounds.maxLon);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

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
    const resolutionMultiplier = 20; // Higher = smoother cell boundaries
    dataCanvas.width = lon.length * resolutionMultiplier;
    dataCanvas.height = lat.length * resolutionMultiplier;
    
    const dataLatMin = Math.min(lat[0], lat[lat.length - 1]);
    const dataLatMax = Math.max(lat[0], lat[lat.length - 1]);
    const dataLonMin = Math.min(lon[0], lon[lon.length - 1]);
    const dataLonMax = Math.max(lon[0], lon[lon.length - 1]);
    
    const latStep = (dataLatMax - dataLatMin) / (lat.length - 1);
    const lonStep = (dataLonMax - dataLonMin) / (lon.length - 1);
    
    const dataBounds = {
      minLat: dataLatMin - latStep / 2,
      maxLat: dataLatMax + latStep / 2,
      minLon: dataLonMin - lonStep / 2,
      maxLon: dataLonMax + lonStep / 2
    };
    
    renderPrecipitationWebGL(dataCanvas, data, stats.min, stats.max, 1, dataRange);
    
    const mapTopLeft = geoToCanvas(dataBounds.maxLat, dataBounds.minLon);
    const mapBottomRight = geoToCanvas(dataBounds.minLat, dataBounds.maxLon);
    
    // Disable smoothing to keep sharp color boundaries (no blurry transitions)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(dataCanvas, 
      mapTopLeft.x, mapTopLeft.y, 
      mapBottomRight.x - mapTopLeft.x, 
      mapBottomRight.y - mapTopLeft.y
    );
    ctx.imageSmoothingEnabled = true; // Re-enable for other drawings

    try {
      const provResponse = await fetch('https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia-province-simple.json');
      const provGeoJson = await provResponse.json();
      
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 4; // Thicker province borders
      ctx.globalAlpha = 0.85;
      
      const drawPolygon = (coordinates) => {
        ctx.beginPath();
        coordinates.forEach((ring, ringIdx) => {
          ring.forEach((coord, idx) => {
            const [lng, latCoord] = coord;
            if (lng < bounds.minLon - 1 || lng > bounds.maxLon + 1 || 
                latCoord < bounds.minLat - 1 || latCoord > bounds.maxLat + 1) return;
            
            const { x, y } = geoToCanvas(latCoord, lng);
            if (idx === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          });
        });
        ctx.stroke();
      };
      
      provGeoJson.features.forEach(feature => {
        const geom = feature.geometry;
        if (geom.type === 'Polygon') {
          drawPolygon(geom.coordinates);
        } else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach(polygon => drawPolygon(polygon));
        }
      });
      
      ctx.globalAlpha = 1.0;
    } catch (error) {
      console.error('Error loading province borders for PNG:', error);
    }

    ctx.restore();

    ctx.fillStyle = '#000';
    ctx.font = 'bold 28px Arial';

    for (let lt = Math.ceil(bounds.minLat / 5) * 5; lt <= bounds.maxLat; lt += 5) {
      const p1 = geoToCanvas(lt, bounds.minLon);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const latLabel = lt === 0 ? '0°' : lt > 0 ? `${lt}°N` : `${Math.abs(lt)}°S`;
      ctx.fillText(latLabel, padding.left - 10, p1.y);
    }

    for (let ln = Math.ceil(bounds.minLon / 10) * 10; ln <= bounds.maxLon; ln += 10) {
      const p1 = geoToCanvas(bounds.minLat, ln);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const lonLabel = ln >= 0 ? `${ln}°E` : `${Math.abs(ln)}°W`;
      ctx.fillText(lonLabel, p1.x, padding.top + mapHeight + 10);
    }

    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeRect(padding.left, padding.top, mapWidth, mapHeight);

    // BMKG style: Horizontal colorbar at bottom
    const colorbarY = padding.top + mapHeight + 80; // Below longitude labels
    const colorbarHeight = 35;
    const colorbarWidth = mapWidth * 0.8;
    const colorbarX = padding.left + (mapWidth - colorbarWidth) / 2;
    
    // Define color stops with tick values (BMKG style)
    const colorStops = [
      { color: '#340A00' },   // 0-20
      { color: '#8E2800' },   // 20-50
      { color: '#DC6200' },   // 50-100
      { color: '#EFA700' },   // 100-150
      { color: '#EBE100' },   // 150-200
      { color: '#E0FD68' },   // 200-300
      { color: '#8AD58B' },   // 300-400
      { color: '#369135' },   // 400-500
      { color: '#00460C' }    // >500
    ];
    
    const ticks = [20, 50, 100, 150, 200, 300, 400, 500];
    
    const blockWidth = colorbarWidth / colorStops.length;
    colorStops.forEach((stop, idx) => {
      ctx.fillStyle = stop.color;
      ctx.fillRect(colorbarX + idx * blockWidth, colorbarY, blockWidth, colorbarHeight);
    });
    
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.strokeRect(colorbarX, colorbarY, colorbarWidth, colorbarHeight);
    
    ctx.fillStyle = '#000';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Tick positions based on color boundaries
    const tickPositions = [1, 2, 3, 4, 5, 6, 7, 8]; // After each color block
    tickPositions.forEach((pos, idx) => {
      const x = colorbarX + pos * blockWidth;
      ctx.beginPath();
      ctx.moveTo(x, colorbarY + colorbarHeight);
      ctx.lineTo(x, colorbarY + colorbarHeight + 5);
      ctx.stroke();
      ctx.fillText(ticks[idx].toString(), x, colorbarY + colorbarHeight + 8);
    });

    // BMKG style: Titles at top-left
    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    // Get period info for titles (with safety checks)
    const periodYear = period && period.length >= 4 ? period.substring(0, 4) : new Date().getFullYear().toString();
    const periodMonth = period && period.length >= 6 ? period.substring(4, 6) : '01';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIdx = parseInt(periodMonth) - 1;
    const initialMonth = monthNames[monthIdx] || 'Jan';
    
    // Forecast = the time the user currently selected
    // Try to get from the selected time option label
    let forecastLabel = `${initialMonth} ${periodYear}`;
    const currentOption = filteredTimeOptions[selectedTimeOption];
    if (currentOption && currentOption.label) {
      forecastLabel = currentOption.label;
    } else if (dataRange === 'daily' && availableTimes[selectedTimeOption]) {
      const d = new Date(availableTimes[selectedTimeOption]);
      forecastLabel = `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    } else if (dataRange === 'monthly') {
      forecastLabel = `${initialMonth} ${periodYear}`;
    }
    
    ctx.font = 'bold 36px Arial';
    ctx.fillText('Monthly Precipitation (mm)', padding.left, 20);
    
    ctx.font = '30px Arial';
    ctx.fillText(`Forecast: ${forecastLabel}`, padding.left, 62);
    
    // Initial line (italic)
    ctx.font = 'italic 30px Arial';
    ctx.fillText(`Initial: ${initialMonth} ${periodYear}`, padding.left, 98);
    
    ctx.font = '28px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('20km InaRCMv0.5', width - padding.right, 25);

    return canvas.toDataURL('image/png');
  };

  // Fetch precipitation data (using binary for speed)
  const fetchPrecipData = async () => {
    setLoading(true);
    try {
      const startTime = performance.now();
      let data;
      
      const currentOption = filteredTimeOptions[selectedTimeOption];
      
      if (dataRange === 'daily' || !currentOption) {
        data = await fetchBinaryPrecipData(period, timeIndex, 1);
      } else {
        data = await fetchAggregatedPrecipData(
          period, 
          currentOption.startIdx, 
          currentOption.endIdx, 
          1
        );
      }
      
      const elapsed = performance.now() - startTime;
      console.log(`Binary fetch (${dataRange}) took ${elapsed.toFixed(0)}ms`);
      
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

  // Auto-load data when period, timeIndex, or dataRange changes
  const lastFetchRef = useRef('');
  
  useEffect(() => {
    if (period && availableTimes.length > 0 && !isPlaying && filteredTimeOptions.length > 0) {
      const currentOption = filteredTimeOptions[selectedTimeOption];
      const fetchKey = `${period}_${dataRange}_${selectedTimeOption}_${currentOption?.startIdx}_${currentOption?.endIdx}`;
      
      if (lastFetchRef.current === fetchKey) return;
      lastFetchRef.current = fetchKey;
      
      const timer = setTimeout(() => {
        fetchPrecipData();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [period, timeIndex, dataRange, selectedTimeOption, filteredTimeOptions]);
  
  // Regenerate PNG when viewMode changes (without re-fetching)
  useEffect(() => {
    if (viewMode === 'png' && precipData) {
      generatePNG(precipData).then(setPngImage);
    }
  }, [viewMode, precipData]);

  // Pre-cache data for animation range (using binary for speed)
  const cacheAnimationData = async () => {
    const totalFrames = animationTo - animationFrom + 1;
    setCacheProgress({ loaded: 0, total: totalFrames });
    setIsCachingData(true);
    
    const newCache = {};
    const startTime = performance.now();
    
    for (let i = animationFrom; i <= animationTo; i++) {
      const cacheKey = `${period}_${i}`;
      
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

  // Animation playback logic
  const playAnimation = async () => {
    if (isPlaying) return;
    
    setIsPlaying(true);
    isPlayingRef.current = true;
    setAnimationCurrentFrame(animationFrom);
    
    let currentFrame = animationFrom;
    const localCache = { ...dataCache };
    const PREFETCH_COUNT = 2;
    
    const fetchFrameData = async (frameIdx) => {
      const option = filteredTimeOptions[frameIdx];
      if (!option) return null;
      
      const cacheKey = `${period}_${dataRange}_${frameIdx}_anim`;
      if (localCache[cacheKey]) return localCache[cacheKey];
      
      try {
        let data;
        if (dataRange === 'daily') {
          data = await fetchBinaryPrecipData(period, option.startIdx, 1);
        } else {
          data = await fetchAggregatedPrecipData(period, option.startIdx, option.endIdx, 1);
        }
        localCache[cacheKey] = data;
        return data;
      } catch (error) {
        console.error(`Error fetching frame ${frameIdx}:`, error);
        return null;
      }
    };
    
    const prefetchFrames = (fromFrame) => {
      for (let i = 1; i <= PREFETCH_COUNT; i++) {
        let nextFrame = fromFrame + i;
        if (nextFrame > animationTo) nextFrame = animationFrom + (nextFrame - animationTo - 1);
        const cacheKey = `${period}_${dataRange}_${nextFrame}_anim`;
        if (!localCache[cacheKey]) {
          fetchFrameData(nextFrame);
        }
      }
    };
    
    const animate = async () => {
      if (!isPlayingRef.current) return;
      
      const frameData = await fetchFrameData(currentFrame);
      prefetchFrames(currentFrame);
      
      if (frameData && isPlayingRef.current) {
        setPrecipData(frameData);
        setSelectedTimeOption(currentFrame);
        if (filteredTimeOptions[currentFrame]) {
          setTimeIndex(filteredTimeOptions[currentFrame].startIdx);
        }
        if (viewMode === 'png') {
          const png = await generatePNG(frameData);
          setPngImage(png);
        }
      }
      
      setAnimationCurrentFrame(currentFrame);
      
      currentFrame++;
      if (currentFrame > animationTo) {
        currentFrame = animationFrom;
      }
      
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
            {/* View Mode Switch */}
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
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '14px',
                    transition: 'all 0.3s ease',
                    backgroundColor: viewMode === 'leaflet' ? 'white' : 'transparent',
                    color: viewMode === 'leaflet' ? '#000080' : 'white',
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
                    color: viewMode === 'png' ? '#000080' : 'white',
                    boxShadow: viewMode === 'png' ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  Static
                </button>
              </div>
            </div>

            {/* Period */}
            <div className="dropdown-row" style={{ marginBottom: '15px' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Initial:</label>
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
            
            {/* Data Range */}
            <div className="dropdown-row" style={{ marginBottom: '15px' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Data Range:</label>
              <div style={{ 
                display: 'flex', 
                flex: 1,
                backgroundColor: '#e0e0e0', 
                borderRadius: '8px', 
                padding: '3px',
                gap: '0'
              }}>
                <button
                  onClick={() => setDataRange('daily')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                    transition: 'all 0.2s ease',
                    backgroundColor: dataRange === 'daily' ? '#0000CD' : 'transparent',
                    color: dataRange === 'daily' ? 'white' : '#333',
                    boxShadow: dataRange === 'daily' ? '0 2px 4px rgba(0,0,0,0.2)' : 'none'
                  }}
                >
                  Per Day
                </button>
                <button
                  onClick={() => setDataRange('10day')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                    transition: 'all 0.2s ease',
                    backgroundColor: dataRange === '10day' ? '#0000CD' : 'transparent',
                    color: dataRange === '10day' ? 'white' : '#333',
                    boxShadow: dataRange === '10day' ? '0 2px 4px rgba(0,0,0,0.2)' : 'none'
                  }}
                >
                  Per 10 Days
                </button>
                <button
                  onClick={() => setDataRange('monthly')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '500',
                    fontSize: '13px',
                    transition: 'all 0.2s ease',
                    backgroundColor: dataRange === 'monthly' ? '#0000CD' : 'transparent',
                    color: dataRange === 'monthly' ? 'white' : '#333',
                    boxShadow: dataRange === 'monthly' ? '0 2px 4px rgba(0,0,0,0.2)' : 'none'
                  }}
                >
                  Per Month
                </button>
              </div>
            </div>
            
            {/* Time */}
            <div className="dropdown-row" style={{ marginBottom: '15px' }}>
              <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Time:</label>
              {dataRange === 'daily' ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="date"
                    value={(() => {
                      const currentTime = availableTimes[selectedTimeOption] || availableTimes[0];
                      if (!currentTime) return '';
                      return currentTime.split('T')[0];
                    })()}
                    onChange={(e) => {
                      const selectedDate = e.target.value;
                      const idx = availableTimes.findIndex(time => time.startsWith(selectedDate));
                      if (idx >= 0) {
                        setSelectedTimeOption(idx);
                        setTimeIndex(idx);
                      }
                    }}
                    min={availableTimes[0]?.split('T')[0]}
                    max={availableTimes[availableTimes.length - 1]?.split('T')[0]}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '14px',
                      cursor: 'pointer'
                    }}
                  />
                </div>
              ) : (
                <select 
                  value={selectedTimeOption}
                  onChange={(e) => {
                    const optionIdx = parseInt(e.target.value);
                    setSelectedTimeOption(optionIdx);
                    if (filteredTimeOptions[optionIdx]) {
                      setTimeIndex(filteredTimeOptions[optionIdx].startIdx);
                    }
                  }}
                  style={{ flex: 1 }}
                >
                  {filteredTimeOptions.map((option, idx) => (
                    <option key={idx} value={idx}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              {loading && <span style={{ marginLeft: '10px', color: '#666' }}>Loading...</span>}
            </div>
            
          </section>
        </div>

        {/* Visualization */}
        <div className="image-section">
          <div className="map-display">
            <h3>Precipitation Visualization:</h3>
            {viewMode === 'leaflet' ? (
              <Map precipData={precipData} period={period} dataRange={dataRange} />
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>From:</label>
                <select
                  value={animationFrom}
                  onChange={(e) => setAnimationFrom(parseInt(e.target.value))}
                  disabled={isPlaying}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ccc', minWidth: '150px' }}
                >
                  {filteredTimeOptions.map((option, idx) => (
                    <option key={idx} value={idx}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#666' }}>To:</label>
                <select
                  value={animationTo}
                  onChange={(e) => setAnimationTo(parseInt(e.target.value))}
                  disabled={isPlaying}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ccc', minWidth: '150px' }}
                >
                  {filteredTimeOptions.map((option, idx) => (
                    <option key={idx} value={idx}>{option.label}</option>
                  ))}
                </select>
              </div>

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

              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <button
                  onClick={playAnimation}
                  disabled={isPlaying || filteredTimeOptions.length === 0}
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
                  Play
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
                  Stop
                </button>
              </div>
            </div>

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

            {isPlaying && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  fontSize: '12px', 
                  color: '#666',
                  marginBottom: '5px'
                }}>
                  <span>Frame: {animationCurrentFrame - animationFrom + 1} / {animationTo - animationFrom + 1}</span>
                  <span>{filteredTimeOptions[animationCurrentFrame]?.label || ''}</span>
                </div>
                <div style={{ 
                  height: '6px', 
                  backgroundColor: '#ddd', 
                  borderRadius: '3px', 
                  overflow: 'hidden' 
                }}>
                  <div style={{ 
                    height: '100%', 
                    width: `${((animationCurrentFrame - animationFrom) / Math.max(animationTo - animationFrom, 1)) * 100}%`,
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
