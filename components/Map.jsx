import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import PrecipitationLayerWebGL from './PrecipitationLayerWebGL';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// Color legend component - responsive for mobile
function ColorLegend({ stats }) {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const colorStops = [
    { range: '>500', color: '#00460C' },
    { range: '400-500', color: '#369135' },
    { range: '300-400', color: '#8AD58B' },
    { range: '200-300', color: '#E0FD68' },
    { range: '150-200', color: '#EBE100' },
    { range: '100-150', color: '#EFA700' },
    { range: '50-100', color: '#DC6200' },
    { range: '20-50', color: '#8E2800' },
    { range: '0-20', color: '#340A00' }
  ];
  
  // Mobile: horizontal legend below map
  if (isMobile) {
    return (
      <div style={{
        position: 'relative',
        width: '100%',
        background: 'white',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        marginTop: '10px',
        fontSize: '10px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '11px', textAlign: 'center' }}>
          Precipitation (mm)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px' }}>
          {colorStops.map((stop, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', padding: '2px 4px' }}>
              <div style={{
                width: '16px',
                height: '14px',
                backgroundColor: stop.color,
                marginRight: '4px',
                border: '1px solid #999'
              }} />
              <span>{stop.range}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  // Desktop: vertical legend on map
  return (
    <div style={{
      position: 'absolute',
      bottom: '30px',
      right: '10px',
      background: 'white',
      padding: '10px',
      borderRadius: '5px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      zIndex: 1000,
      fontSize: '11px'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px' }}>
        Precipitation (mm)
      </div>
      {colorStops.map((stop, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: '3px' }}>
          <div style={{
            width: '20px',
            height: '16px',
            backgroundColor: stop.color,
            marginRight: '8px',
            border: '1px solid #999'
          }} />
          <span>{stop.range}</span>
        </div>
      ))}
    </div>
  );
}

export default function Map({ precipData, period = '202601', dataRange = 'daily' }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [clickInfo, setClickInfo] = useState(null);
  const [sideWindow, setSideWindow] = useState({ visible: false, data: null, loading: false });
  const [showChartPopup, setShowChartPopup] = useState(false);
  const markerRef = useRef(null);
  const [clickMode, setClickMode] = useState('point'); // 'point', 'region', or 'box'
  const zomLayerRef = useRef(null);
  const selectedZomRef = useRef(null);
  const zomGeoJsonRef = useRef(null);
  const oceanLayerRef = useRef(null);  // Blue ocean layer for ZOM mode
  const coloredZomLayerRef = useRef(null);  // Colored ZOM polygons layer
  const [isMobile, setIsMobile] = useState(false);
  
  // Box select mode state
  const boxStartRef = useRef(null);      // Start corner of box
  const boxRectRef = useRef(null);       // Leaflet rectangle for the box
  const boxMaskRef = useRef(null);       // Array of mask rectangles
  const isDrawingBoxRef = useRef(false); // Whether user is currently drawing
  
  // Coordinate search state
  const [coordSearch, setCoordSearch] = useState({ lat: '', lon: '' });
  const [coordError, setCoordError] = useState('');
  
  // Check for mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  // Convert dataRange to API mode
  const getApiMode = () => {
    if (dataRange === 'daily') return 'day';
    if (dataRange === '10day') return '10day';
    if (dataRange === 'monthly') return 'monthly';
    return 'day';
  };

  // Get color for precipitation value (matches the color legend)
  const getPrecipitationColor = (value) => {
    if (value === null || value === undefined) return '#cccccc';  // Gray for no data
    if (value > 500) return '#00460C';
    if (value > 400) return '#369135';
    if (value > 300) return '#8AD58B';
    if (value > 200) return '#E0FD68';
    if (value > 150) return '#EBE100';
    if (value > 100) return '#EFA700';
    if (value > 50) return '#DC6200';
    if (value > 20) return '#8E2800';
    return '#340A00';
  };

  // Calculate average precipitation for a polygon using grid points inside it
  const calculatePolygonAverage = (geometry) => {
    if (!precipData || !precipData.lat || !precipData.lon || !precipData.values) {
      return null;
    }

    const { lat: lats, lon: lons, values } = precipData;
    
    // Get polygon bounds for quick filtering
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    
    const extractCoords = (coords) => {
      if (typeof coords[0] === 'number') {
        // coords is [lon, lat]
        if (coords[1] < minLat) minLat = coords[1];
        if (coords[1] > maxLat) maxLat = coords[1];
        if (coords[0] < minLon) minLon = coords[0];
        if (coords[0] > maxLon) maxLon = coords[0];
      } else {
        coords.forEach(extractCoords);
      }
    };
    
    if (geometry.type === 'Polygon') {
      extractCoords(geometry.coordinates);
    } else if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach(poly => extractCoords(poly));
    }
    
    // Simple point-in-polygon test using ray casting
    const pointInPolygon = (lat, lon, polygon) => {
      // polygon is array of [lon, lat] pairs
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        
        if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    };
    
    const isPointInGeometry = (lat, lon) => {
      if (geometry.type === 'Polygon') {
        return pointInPolygon(lat, lon, geometry.coordinates[0]);
      } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(poly => pointInPolygon(lat, lon, poly[0]));
      }
      return false;
    };
    
    // Collect valid values inside polygon
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < lats.length; i++) {
      const lat = lats[i];
      // Quick bounds check
      if (lat < minLat || lat > maxLat) continue;
      
      for (let j = 0; j < lons.length; j++) {
        const lon = lons[j];
        // Quick bounds check
        if (lon < minLon || lon > maxLon) continue;
        
        const value = values[i]?.[j];
        if (value === undefined || value === null || value === -999 || value < 0) continue;
        
        if (isPointInGeometry(lat, lon)) {
          sum += value;
          count++;
        }
      }
    }
    
    return count > 0 ? sum / count : null;
  };

  // Function to get precipitation value at lat/lon
  const getPrecipitationAt = (lat, lon) => {
    if (!precipData || !precipData.lat || !precipData.lon || !precipData.values) {
      return null;
    }

    const { lat: lats, lon: lons, values } = precipData;

    // Find nearest grid point
    let nearestLatIdx = 0;
    let nearestLonIdx = 0;
    let minLatDist = Math.abs(lats[0] - lat);
    let minLonDist = Math.abs(lons[0] - lon);

    for (let i = 0; i < lats.length; i++) {
      const dist = Math.abs(lats[i] - lat);
      if (dist < minLatDist) {
        minLatDist = dist;
        nearestLatIdx = i;
      }
    }

    for (let j = 0; j < lons.length; j++) {
      const dist = Math.abs(lons[j] - lon);
      if (dist < minLonDist) {
        minLonDist = dist;
        nearestLonIdx = j;
      }
    }

    const value = values[nearestLatIdx]?.[nearestLonIdx];
    
    // Return null if no valid data
    if (value === undefined || value === null || value === -999 || value < 0) {
      return null;
    }

    return value;
  };

  // Function to refresh time series data for the current location
  const refreshTimeSeriesData = async () => {
    if (!sideWindow.data) return;
    
    setSideWindow(prev => ({ ...prev, loading: true }));
    
    const { lat, lng } = sideWindow.data;
    const mode = getApiMode();
    try {
      const timeSeriesResponse = await fetch(
        `http://172.19.1.191:5000/api/timeseries?lat=${lat}&lon=${lng}&period=${period}&mode=${mode}`
      );
      if (timeSeriesResponse.ok) {
        const timeSeriesData = await timeSeriesResponse.json();
        setSideWindow(prev => ({
          ...prev,
          loading: false,
          data: { ...prev.data, timeSeriesData }
        }));
      } else {
        setSideWindow(prev => ({
          ...prev,
          loading: false,
          data: { ...prev.data, timeSeriesData: null }
        }));
      }
    } catch (error) {
      console.error('Error fetching time series:', error);
      setSideWindow(prev => ({
        ...prev,
        loading: false,
        data: { ...prev.data, timeSeriesData: null }
      }));
    }
  };

  // Handle coordinate search - navigate to lat/lon and show time series
  const handleCoordSearch = async () => {
    const lat = parseFloat(coordSearch.lat);
    const lon = parseFloat(coordSearch.lon);
    
    if (isNaN(lat) || isNaN(lon)) {
      setCoordError('Please enter valid numbers');
      return;
    }
    
    if (lat < -90 || lat > 90) {
      setCoordError('Latitude must be between -90 and 90');
      return;
    }
    
    if (lon < -180 || lon > 180) {
      setCoordError('Longitude must be between -180 and 180');
      return;
    }
    
    setCoordError('');
    
    const L = require('leaflet');
    const map = mapInstanceRef.current;
    
    if (!map) return;
    
    // Remove old marker if exists
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
    }
    
    // Remove selected ZOM highlight if any
    if (selectedZomRef.current) {
      map.removeLayer(selectedZomRef.current);
      selectedZomRef.current = null;
    }
    
    // Set loading state
    setSideWindow({ visible: true, data: null, loading: true });
    
    // Pan map to location
    map.setView([lat, lon], 8);
    
    // Get precipitation at location
    const precip = getPrecipitationAt(lat, lon);
    
    // Fetch location name
    let locationName = 'Custom Location';
    let locationDetails = { city: '', province: '', country: '' };
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
        { headers: { 'User-Agent': 'PrecipitationMap/1.0' } }
      );
      const data = await response.json();
      
      if (data && data.address) {
        const addr = data.address;
        locationDetails.city = addr.city || addr.town || addr.village || addr.municipality || '';
        locationDetails.province = addr.state || addr.province || '';
        locationDetails.country = addr.country || '';
        
        const parts = [locationDetails.city, locationDetails.province, locationDetails.country].filter(Boolean);
        locationName = parts.join(', ') || 'Custom Location';
      }
    } catch (error) {
      console.error('Error fetching location:', error);
    }
    
    // Fetch time series
    let timeSeriesData = null;
    const mode = getApiMode();
    try {
      const timeSeriesResponse = await fetch(
        `http://172.19.1.191:5000/api/timeseries?lat=${lat}&lon=${lon}&period=${period}&mode=${mode}`
      );
      if (timeSeriesResponse.ok) {
        timeSeriesData = await timeSeriesResponse.json();
      }
    } catch (error) {
      console.error('Error fetching time series:', error);
    }
    
    // Add marker
    const marker = L.marker([lat, lon]).addTo(map);
    markerRef.current = marker;
    
    // Update side window
    setSideWindow({
      visible: true,
      loading: false,
      data: {
        isRegion: false,
        lat: lat.toFixed(4),
        lng: lon.toFixed(4),
        locationName,
        locationDetails,
        currentPrecip: precip ? precip.toFixed(2) : null,
        timeSeriesData,
        isCustomCoord: true
      }
    });
    
    setClickInfo({
      lat: lat.toFixed(4),
      lon: lon.toFixed(4),
      precip: precip ? precip.toFixed(2) : null
    });
  };

  // Download time series as CSV
  const downloadCSV = async () => {
    if (!sideWindow.data) return;
    
    const mode = getApiMode();
    
    try {
      if (sideWindow.data.isRegion) {
        // Region CSV download
        const response = await fetch('http://172.19.1.191:5000/api/timeseries/region/csv', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geometry: sideWindow.data.geometry,
            zom_name: sideWindow.data.zomName,
            period: period,
            mode: mode
          })
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const contentDisposition = response.headers.get('Content-Disposition');
          a.download = contentDisposition?.split('filename=')[1] || 
                       `precipitation_${period}_${mode}_${sideWindow.data.zomName}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
        }
      } else {
        // Point CSV download
        const lat = sideWindow.data.lat;
        const lon = sideWindow.data.lng;
        
        const response = await fetch(
          `http://172.19.1.191:5000/api/timeseries/csv?lat=${lat}&lon=${lon}&period=${period}&mode=${mode}`
        );
        
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `precipitation_${period}_${mode}_lat${lat}_lon${lon}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      console.error('Error downloading CSV:', error);
      alert('Failed to download CSV');
    }
  };

  // Auto-refresh time series when period or dataRange changes
  useEffect(() => {
    if (!sideWindow.visible || !sideWindow.data || sideWindow.loading) return;
    
    const refreshData = async () => {
      setSideWindow(prev => ({ ...prev, loading: true }));
      const mode = getApiMode();
      
      // Update current precipitation for point mode
      if (!sideWindow.data.isRegion && sideWindow.data.lat && sideWindow.data.lng) {
        const lat = parseFloat(sideWindow.data.lat);
        const lng = parseFloat(sideWindow.data.lng);
        const newPrecip = getPrecipitationAt(lat, lng);
        setSideWindow(prev => ({
          ...prev,
          data: {
            ...prev.data,
            currentPrecip: newPrecip ? newPrecip.toFixed(2) : null
          }
        }));
      }
      
      if (sideWindow.data.isRegion && sideWindow.data.geometry) {
        // Refresh region data
        try {
          const response = await fetch('http://172.19.1.191:5000/api/timeseries/region', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              geometry: sideWindow.data.geometry,
              zom_name: sideWindow.data.zomName,
              period: period,
              mode: mode
            })
          });
          
          if (response.ok) {
            const regionData = await response.json();
            setSideWindow(prev => ({
              ...prev,
              loading: false,
              data: {
                ...prev.data,
                timeSeriesData: regionData,
                numGridPoints: regionData.num_grid_points,
                processingTime: regionData.processing_time_seconds
              }
            }));
          } else {
            setSideWindow(prev => ({ ...prev, loading: false }));
          }
        } catch (error) {
          console.error('Error refreshing region data:', error);
          setSideWindow(prev => ({ ...prev, loading: false }));
        }
      } else if (sideWindow.data.lat && sideWindow.data.lng) {
        // Refresh point data
        try {
          const timeSeriesResponse = await fetch(
            `http://172.19.1.191:5000/api/timeseries?lat=${sideWindow.data.lat}&lon=${sideWindow.data.lng}&period=${period}&mode=${mode}`
          );
          if (timeSeriesResponse.ok) {
            const timeSeriesData = await timeSeriesResponse.json();
            setSideWindow(prev => ({
              ...prev,
              loading: false,
              data: { ...prev.data, timeSeriesData }
            }));
          } else {
            setSideWindow(prev => ({ ...prev, loading: false }));
          }
        } catch (error) {
          console.error('Error refreshing time series:', error);
          setSideWindow(prev => ({ ...prev, loading: false }));
        }
      } else {
        setSideWindow(prev => ({ ...prev, loading: false }));
      }
    };
    
    refreshData();
  }, [period, dataRange, precipData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mapInstanceRef.current) return;

    const L = require('leaflet');

    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    // Define bounds for the overlay (Indonesia region)
    const overlayBounds = L.latLngBounds(
      L.latLng(-11, 91),   // Southwest corner
      L.latLng(6, 141)     // Northeast corner
    );

    // Tighter bounds to match the red box area (more zoomed in, cropping edges)
    const restrictedBounds = L.latLngBounds(
      [-10, 96],   // Southwest corner (crop 1 degree from bottom and left)
      [5, 140]     // Northeast corner (crop 1 degree from top and right)
    );

    const map = L.map(mapRef.current, {
      maxBounds: restrictedBounds,    // Restrict panning to tighter area
      maxBoundsViscosity: 1.0,        // Prevent any dragging outside bounds
      minZoom: 5.3,                   // Prevent zooming out too far (was 5)
      maxZoom: 10,                    // Allow zooming in
    }).setView([-2.5, 118], 5.3);     // Center on Indonesia, slightly more zoomed in

    // Create custom panes for proper layering
    // Order (bottom to top): tiles -> worldBorder -> precipitation -> indonesiaBorder -> markers
    
    // Pane for world borders (ABOVE precipitation overlay)
    map.createPane('worldBorderPane');
    map.getPane('worldBorderPane').style.zIndex = 450;  // Above overlayPane (400)
    map.getPane('worldBorderPane').style.pointerEvents = 'none';
    
    // Pane for Indonesia/ZOM borders (above world borders)
    map.createPane('indonesiaBorderPane');
    map.getPane('indonesiaBorderPane').style.zIndex = 460;  // Above world borders
    map.getPane('indonesiaBorderPane').style.pointerEvents = 'none';
    
    // Legacy pane for click handlers
    map.createPane('coastlinePane');
    map.getPane('coastlinePane').style.zIndex = 450;
    map.getPane('coastlinePane').style.pointerEvents = 'none';
    
    // Pane for ocean layer in ZOM mode (same level as overlay to replace it)
    map.createPane('oceanPane');
    map.getPane('oceanPane').style.zIndex = 401;  // Just above default overlayPane (400)
    map.getPane('oceanPane').style.pointerEvents = 'none';
    
    // Pane for colored ZOM polygons (above ocean, replaces precipitation)
    map.createPane('coloredZomPane');
    map.getPane('coloredZomPane').style.zIndex = 402;  // Above ocean
    map.getPane('coloredZomPane').style.pointerEvents = 'none';

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; OpenStreetMap & CartoDB',
        noWrap: true,
        minZoom: 0,  // Show only at zoom 7 and higher (province level)
        maxZoom: 5
      }
    ).addTo(map);


    // OpenStreetMap with labels - shown when zoomed out (country/regional view)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      minZoom: 6,
      maxZoom: 18  // Hide when zooming in beyond zoom 6
    }).addTo(map);

    // Load country boundaries (global + Indonesia ZOM)
    // This gives us VECTOR lines with fixed stroke width regardless of zoom
    const loadIndonesiaBorders = async () => {
      try {
        // First, load GLOBAL country borders (thin lines, above overlay)
        try {
          const worldResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
          const worldGeojson = await worldResponse.json();
          
          // Filter out Indonesia from world borders (we'll draw it separately with thicker lines)
          const worldWithoutIndonesia = {
            type: 'FeatureCollection',
            features: worldGeojson.features.filter(f => 
              f.properties.ADMIN !== 'Indonesia' && 
              f.properties.ISO_A3 !== 'IDN' &&
              f.properties.name !== 'Indonesia'
            )
          };
          
          // Add world country borders (except Indonesia) with very thin lines
          L.geoJSON(worldWithoutIndonesia, {
            pane: 'worldBorderPane',
            style: {
              color: '#000000',      // Black color for borders
              weight: 0.2,           // Very thin for global borders
              opacity: 0.4,          // More transparent
              fill: false            // No fill, just borders
            }
          }).addTo(map);
          
          console.log('World country borders loaded (excluding Indonesia)');
        } catch (worldError) {
          console.error('Failed to load world borders:', worldError);
        }
        
        // Then load ZOM (Zona Musim) GeoJSON for Indonesia (thicker, on top)
        const response = await fetch('/zom.geojson');
        const geojson = await response.json();
        
        // Store GeoJSON for later use
        zomGeoJsonRef.current = geojson;
        
        // Add ZOM boundaries with thicker styling (in higher z-index pane)
        L.geoJSON(geojson, {
          pane: 'indonesiaBorderPane',
          style: {
            color: '#000000',      // Black color for borders
            weight: 0.8,           // Thicker for Indonesia ZOM
            opacity: 0.7,          // Less transparent than global
            fill: false            // No fill, just borders
          }
        }).addTo(map);
        
        console.log('ZOM boundaries loaded (699 zones)');
      } catch (error) {
        console.error('Failed to load Indonesia borders:', error);
        // Fallback: try loading just Indonesia from world countries
        try {
          const fallbackResponse = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
          const worldGeojson = await fallbackResponse.json();
          
          // Filter to only Indonesia
          const indonesiaOnly = {
            type: 'FeatureCollection',
            features: worldGeojson.features.filter(f => 
              f.properties.ADMIN === 'Indonesia' || 
              f.properties.ISO_A3 === 'IDN' ||
              f.properties.name === 'Indonesia'
            )
          };
          
          zomGeoJsonRef.current = indonesiaOnly;
          
          L.geoJSON(indonesiaOnly, {
            pane: 'coastlinePane',
            style: {
              color: '#000000',
              weight: 1.5,
              opacity: 1,
              fill: false
            }
          }).addTo(map);
          
          console.log('Indonesia borders loaded (fallback)');
        } catch (fallbackError) {
          console.error('All border loading failed:', fallbackError);
        }
      }
    };
    
    loadIndonesiaBorders();

    // CartoDB light without labels - shown when zoomed in (province level)

    mapInstanceRef.current = map;
    setMapReady(true);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Center map on precipitation data bounds when data loads
  useEffect(() => {
    if (!mapInstanceRef.current || !precipData || !precipData.bounds) return;
    
    const L = require('leaflet');
    const map = mapInstanceRef.current;
    const bounds = precipData.bounds;
    
    // Create tighter bounds (crop edges by 1 degree)
    const restrictedBounds = L.latLngBounds(
      [Math.max(bounds.minLat, -10), Math.max(bounds.minLon, 96)],  // Southwest
      [Math.min(bounds.maxLat, 5), Math.min(bounds.maxLon, 140)]    // Northeast
    );
    
    // Update map maxBounds to match restricted area
    map.setMaxBounds(restrictedBounds);
    
    // Fit the map view to show the precipitation layer, but respect minZoom
    map.fitBounds(restrictedBounds, { 
      padding: [20, 20],
      maxZoom: 5.3  // Don't zoom out beyond this level
    });
    
    console.log('Map centered on restricted bounds:', {
      original: bounds,
      restricted: restrictedBounds.toBBoxString()
    });
  }, [precipData]);

  // Create/update clickable ZOM layer when mode changes
  useEffect(() => {
    if (!mapInstanceRef.current || !zomGeoJsonRef.current) return;
    
    const L = require('leaflet');
    const map = mapInstanceRef.current;
    
    // Remove existing ZOM layer if any
    if (zomLayerRef.current) {
      map.removeLayer(zomLayerRef.current);
      zomLayerRef.current = null;
    }
    
    // Remove selected ZOM highlight
    if (selectedZomRef.current) {
      map.removeLayer(selectedZomRef.current);
      selectedZomRef.current = null;
    }
    
    // Remove ocean layer
    if (oceanLayerRef.current) {
      map.removeLayer(oceanLayerRef.current);
      oceanLayerRef.current = null;
    }
    
    // Remove colored ZOM layer
    if (coloredZomLayerRef.current) {
      map.removeLayer(coloredZomLayerRef.current);
      coloredZomLayerRef.current = null;
    }
    
    // Only create clickable layer in region mode
    if (clickMode === 'region') {
      const geojson = zomGeoJsonRef.current;
      
      // Create blue layer covering entire visible area (ocean + all non-ZOM land)
      const oceanBounds = [
        [-90, -180],   // Southwest (whole world)
        [-90, 180],    // Southeast  
        [90, 180],     // Northeast
        [90, -180]     // Northwest
      ];
      oceanLayerRef.current = L.polygon(oceanBounds, {
        pane: 'oceanPane',
        fillColor: '#87CEEB',  // Light blue
        fillOpacity: 0.9,
        color: '#87CEEB',
        weight: 0,
        interactive: false
      }).addTo(map);
      
      // Create colored ZOM layer based on precipitation averages
      coloredZomLayerRef.current = L.geoJSON(geojson, {
        pane: 'coloredZomPane',
        style: (feature) => {
          const avgPrecip = calculatePolygonAverage(feature.geometry);
          const fillColor = getPrecipitationColor(avgPrecip);
          return {
            fillColor: fillColor,
            fillOpacity: 0.9,
            color: '#333333',
            weight: 0.5,
            opacity: 0.9
          };
        },
        interactive: false  // Don't intercept clicks
      }).addTo(map);
      
      console.log('ZOM colored layer created with precipitation averages');
      
      zomLayerRef.current = L.geoJSON(geojson, {
        style: {
          color: '#3388ff',
          weight: 1.5,
          opacity: 0.6,
          fillColor: '#3388ff',
          fillOpacity: 0.1
        },
        onEachFeature: (feature, layer) => {
          // Get ZOM info from properties
          const props = feature.properties;
          const zomId = props.NOZOM_PROV || props.NOZONA_LAM || `ZOM ${props.NOZOM_NAS}`;
          const province = props.PROV || '';
          const island = props.PULAU || '';
          const climateType = props.TIPE_UMUM || '';
          const seasonType = props.TIPE_MUSIM || '';
          
          // Create display name
          const zomName = `${zomId} (${province})`;
          const tooltipContent = `<b>${zomId}</b><br/>${province}, ${island}<br/>${climateType} - ${seasonType}`;
          
          // Bind tooltip with ZOM info (shown on hover)
          layer.bindTooltip(tooltipContent, {
            permanent: false,
            direction: 'top',
            className: 'zom-tooltip',
            offset: [0, -10]
          });
          
          // Hover effects
          layer.on('mouseover', function() {
            this.setStyle({
              fillOpacity: 0.3,
              weight: 2.5
            });
            this.openTooltip();
          });
          
          layer.on('mouseout', function() {
            this.setStyle({
              fillOpacity: 0.1,
              weight: 1.5
            });
            this.closeTooltip();
          });
          
          // Click handler for ZOM
          layer.on('click', async function(e) {
            L.DomEvent.stopPropagation(e);
            
            // Remove old marker if exists
            if (markerRef.current) {
              map.removeLayer(markerRef.current);
              markerRef.current = null;
            }
            
            // Remove old selected ZOM highlight
            if (selectedZomRef.current) {
              map.removeLayer(selectedZomRef.current);
            }
            
            // Highlight selected ZOM
            selectedZomRef.current = L.geoJSON(feature, {
              style: {
                color: '#ff7800',
                weight: 3,
                opacity: 1,
                fillColor: '#ff7800',
                fillOpacity: 0.3
              }
            }).addTo(map);
            
            // Set loading state
            setSideWindow({ visible: true, data: null, loading: true });
            
            // Fetch regional time series
            const mode = getApiMode();
            try {
              const response = await fetch('http://172.19.1.191:5000/api/timeseries/region', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  geometry: feature.geometry,
                  zom_name: zomName,
                  zom_id: zomId,
                  province: province,
                  island: island,
                  climate_type: climateType,
                  season_type: seasonType,
                  period: period,
                  mode: mode
                })
              });
              
              if (response.ok) {
                const regionData = await response.json();
                
                setSideWindow({
                  visible: true,
                  loading: false,
                  data: {
                    isRegion: true,
                    zomName: zomName,
                    zomId: zomId,
                    province: province,
                    island: island,
                    climateType: climateType,
                    seasonType: seasonType,
                    geometry: feature.geometry,  // Store geometry for refresh
                    numGridPoints: regionData.num_grid_points,
                    timeSeriesData: regionData,
                    processingTime: regionData.processing_time_seconds
                  }
                });
              } else {
                const error = await response.json();
                setSideWindow({
                  visible: true,
                  loading: false,
                  data: { error: error.error || 'Failed to fetch regional data' }
                });
              }
            } catch (error) {
              console.error('Error fetching regional data:', error);
              setSideWindow({
                visible: true,
                loading: false,
                data: { error: 'Network error fetching regional data' }
              });
            }
          });
        }
      }).addTo(map);
      
      console.log('Clickable ZOM layer created (699 zones)');
    }
    
    return () => {
      if (zomLayerRef.current) {
        map.removeLayer(zomLayerRef.current);
        zomLayerRef.current = null;
      }
      if (oceanLayerRef.current) {
        map.removeLayer(oceanLayerRef.current);
        oceanLayerRef.current = null;
      }
      if (coloredZomLayerRef.current) {
        map.removeLayer(coloredZomLayerRef.current);
        coloredZomLayerRef.current = null;
      }
    };
  }, [clickMode, period, dataRange, precipData]);

  // Add click handler for POINT mode when map and data are ready
  useEffect(() => {
    if (!mapInstanceRef.current || !precipData) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    const handleClick = async (e) => {
      // Only handle clicks in point mode
      if (clickMode !== 'point') return;
      
      const { lat, lng } = e.latlng;
      const precip = getPrecipitationAt(lat, lng);

      // Auto-fill the coordinate search bar with the clicked coords
      setCoordSearch({ lat: lat.toFixed(4), lon: lng.toFixed(4) });

      // Remove old marker if exists
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
      }
      
      // Remove selected ZOM highlight if any
      if (selectedZomRef.current) {
        map.removeLayer(selectedZomRef.current);
        selectedZomRef.current = null;
      }

      // Set loading state for side window
      setSideWindow({ visible: true, data: null, loading: true });

      // Fetch location name using reverse geocoding
      let locationName = 'Loading...';
      let locationDetails = { city: '', province: '', country: '' };
      
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
          {
            headers: {
              'User-Agent': 'PrecipitationMap/1.0'
            }
          }
        );
        const data = await response.json();
        
        if (data && data.address) {
          const addr = data.address;
          locationDetails.city = addr.city || addr.town || addr.village || addr.municipality || '';
          locationDetails.province = addr.state || addr.province || '';
          locationDetails.country = addr.country || '';
          
          // Build location name
          const parts = [locationDetails.city, locationDetails.province, locationDetails.country].filter(Boolean);
          locationName = parts.join(', ') || 'Unknown location';
        } else {
          locationName = 'Unknown location';
        }
      } catch (error) {
        console.error('Error fetching location:', error);
        locationName = 'Location unavailable';
      }

      // Fetch time series data
      let timeSeriesData = null;
      const mode = getApiMode();
      try {
        const timeSeriesResponse = await fetch(
          `http://172.19.1.191:5000/api/timeseries?lat=${lat}&lon=${lng}&period=${period}&mode=${mode}`
        );
        if (timeSeriesResponse.ok) {
          timeSeriesData = await timeSeriesResponse.json();
        }
      } catch (error) {
        console.error('Error fetching time series:', error);
      }

      // Add marker
      const marker = L.marker([lat, lng]).addTo(map);
      markerRef.current = marker;

      // Update side window with all data
      setSideWindow({
        visible: true,
        loading: false,
        data: {
          isRegion: false,
          lat: lat.toFixed(4),
          lng: lng.toFixed(4),
          locationName,
          locationDetails,
          currentPrecip: precip ? precip.toFixed(2) : null,
          timeSeriesData
        }
      });

      // Update state for backward compatibility
      setClickInfo({
        lat: lat.toFixed(4),
        lon: lng.toFixed(4),
        precip: precip ? precip.toFixed(2) : null
      });
    };

    map.on('click', handleClick);

    return () => {
      map.off('click', handleClick);
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    };
  }, [precipData, clickMode]);

  // Box Select mode handlers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    
    const L = require('leaflet');
    const map = mapInstanceRef.current;
    
    // Clean up box artifacts when leaving box mode
    const cleanupBox = () => {
      if (boxRectRef.current) {
        map.removeLayer(boxRectRef.current);
        boxRectRef.current = null;
      }
      if (boxMaskRef.current) {
        boxMaskRef.current.forEach(m => map.removeLayer(m));
        boxMaskRef.current = null;
      }
      boxStartRef.current = null;
      isDrawingBoxRef.current = false;
    };
    
    if (clickMode !== 'box') {
      cleanupBox();
      map.dragging.enable();
      map.getContainer().style.cursor = '';
      return;
    }
    
    // Disable map dragging in box mode so mousedown/drag draws a box
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';
    
    const onMouseDown = (e) => {
      // Remove previous box/mask
      cleanupBox();
      // Close side window from previous box
      setSideWindow({ visible: false, data: null, loading: false });
      
      boxStartRef.current = e.latlng;
      isDrawingBoxRef.current = true;
      
      // Create initial rectangle (will grow as mouse moves)
      boxRectRef.current = L.rectangle(
        [e.latlng, e.latlng],
        { color: '#2196F3', weight: 2, fillColor: '#2196F3', fillOpacity: 0.15, dashArray: '6 3' }
      ).addTo(map);
    };
    
    const onMouseMove = (e) => {
      if (!isDrawingBoxRef.current || !boxStartRef.current || !boxRectRef.current) return;
      boxRectRef.current.setBounds(L.latLngBounds(boxStartRef.current, e.latlng));
    };
    
    const onMouseUp = async (e) => {
      if (!isDrawingBoxRef.current || !boxStartRef.current) return;
      isDrawingBoxRef.current = false;
      
      const start = boxStartRef.current;
      const end = e.latlng;
      
      // Ignore tiny boxes (accidental clicks)
      if (Math.abs(start.lat - end.lat) < 0.1 && Math.abs(start.lng - end.lng) < 0.1) {
        cleanupBox();
        return;
      }
      
      const boxBounds = L.latLngBounds(start, end);
      
      // Update the rectangle to final position
      if (boxRectRef.current) {
        boxRectRef.current.setBounds(boxBounds);
        boxRectRef.current.setStyle({ fillOpacity: 0.05, dashArray: null });
      }
      
      // Create mask outside the box (4 rectangles)
      const mapBounds = L.latLngBounds(L.latLng(-90, -180), L.latLng(90, 180));
      const sw = boxBounds.getSouthWest();
      const ne = boxBounds.getNorthEast();
      
      const maskStyle = { color: 'transparent', weight: 0, fillColor: '#000000', fillOpacity: 0.85, interactive: false };
      
      boxMaskRef.current = [
        // Top mask
        L.rectangle([L.latLng(ne.lat, mapBounds.getWest()), L.latLng(mapBounds.getNorth(), mapBounds.getEast())], maskStyle).addTo(map),
        // Bottom mask
        L.rectangle([L.latLng(mapBounds.getSouth(), mapBounds.getWest()), L.latLng(sw.lat, mapBounds.getEast())], maskStyle).addTo(map),
        // Left mask
        L.rectangle([L.latLng(sw.lat, mapBounds.getWest()), L.latLng(ne.lat, sw.lng)], maskStyle).addTo(map),
        // Right mask
        L.rectangle([L.latLng(sw.lat, ne.lng), L.latLng(ne.lat, mapBounds.getEast())], maskStyle).addTo(map),
      ];
      
      // Fetch time series for the box region
      setSideWindow({ visible: true, data: null, loading: true });
      
      const mode = getApiMode();
      const geometry = {
        type: 'Polygon',
        coordinates: [[
          [sw.lng, sw.lat],
          [ne.lng, sw.lat],
          [ne.lng, ne.lat],
          [sw.lng, ne.lat],
          [sw.lng, sw.lat]
        ]]
      };
      
      try {
        const response = await fetch('http://172.19.1.191:5000/api/timeseries/region', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            geometry: geometry,
            zom_name: `Box [${sw.lat.toFixed(2)}, ${sw.lng.toFixed(2)}] to [${ne.lat.toFixed(2)}, ${ne.lng.toFixed(2)}]`,
            zom_id: 'Custom Box',
            province: '',
            island: '',
            climate_type: '',
            season_type: '',
            period: period,
            mode: mode
          })
        });
        
        if (response.ok) {
          const regionData = await response.json();
          setSideWindow({
            visible: true,
            loading: false,
            data: {
              isRegion: true,
              zomName: `Box Select`,
              zomId: `[${sw.lat.toFixed(2)}, ${sw.lng.toFixed(2)}] to [${ne.lat.toFixed(2)}, ${ne.lng.toFixed(2)}]`,
              province: '',
              island: '',
              climateType: '',
              seasonType: '',
              geometry: geometry,
              numGridPoints: regionData.num_grid_points,
              timeSeriesData: regionData,
              processingTime: regionData.processing_time_seconds
            }
          });
        } else {
          const error = await response.json();
          setSideWindow({ visible: true, loading: false, data: { error: error.error || 'Failed to fetch box data' } });
        }
      } catch (error) {
        console.error('Error fetching box region data:', error);
        setSideWindow({ visible: true, loading: false, data: { error: 'Network error fetching box data' } });
      }
    };
    
    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    
    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      cleanupBox();
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    };
  }, [clickMode, period, dataRange]);

  // Side Window Component
  const SideWindow = () => {
    if (!sideWindow.visible) return null;

    // Handle error state
    if (sideWindow.data?.error) {
      return (
        <div style={{
          position: 'fixed',
          top: '0',
          right: '0',
          width: '100%',
          maxWidth: '400px',
          height: '100vh',
          background: 'white',
          boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
          zIndex: 2000,
          padding: '15px',
          overflowY: 'auto',
          fontFamily: 'Arial, sans-serif'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#333' }}>Error</h2>
            <button 
              onClick={() => setSideWindow({ visible: false, data: null, loading: false })}
              style={{ background: '#f44336', color: 'white', border: 'none', borderRadius: '3px', padding: '8px 16px', cursor: 'pointer', fontSize: '14px' }}
            >Close</button>
          </div>
          <div style={{ color: '#f44336', padding: '20px', background: '#ffebee', borderRadius: '5px' }}>
            {sideWindow.data.error}
          </div>
        </div>
      );
    }

    return (
      <div style={{
        width: '400px',
        minWidth: '350px',
        maxWidth: '450px',
        height: '100%',
        background: 'white',
        borderLeft: '2px solid #ddd',
        padding: '15px',
        overflowY: 'auto',
        fontFamily: 'Arial, sans-serif',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#333' }}>
            {sideWindow.data?.isRegion ? 'Regional Data' : 'Location Details'}
          </h2>
          <button 
            onClick={() => setSideWindow({ visible: false, data: null, loading: false })}
            style={{
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Close
          </button>
        </div>

        {sideWindow.loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <div>Loading {sideWindow.data?.isRegion ? 'regional' : 'location'} data...</div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
              {clickMode === 'region' && 'First request may take a few seconds...'}
            </div>
          </div>
        ) : sideWindow.data ? (
          <div>
            {/* Basic Information - Different for Region vs Point */}
            <div style={{ marginBottom: '25px', padding: '15px', background: sideWindow.data.isRegion ? '#fff3e0' : '#f8f9fa', borderRadius: '5px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#2c3e50' }}>
                {sideWindow.data.isRegion ? 'Zona Musim (ZOM)' : 'Basic Information'}
              </h3>
              <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                {sideWindow.data.isRegion ? (
                  <>
                    <strong>ZOM ID:</strong><br/>
                    {sideWindow.data.zomId}<br/><br/>
                    <strong>Province:</strong><br/>
                    {sideWindow.data.province}<br/><br/>
                    <strong>Island:</strong><br/>
                    {sideWindow.data.island}<br/><br/>
                    <strong>Climate Type:</strong><br/>
                    {sideWindow.data.climateType}<br/><br/>
                    <strong>Season Type:</strong><br/>
                    {sideWindow.data.seasonType}<br/><br/>
                    <strong>Grid Points:</strong><br/>
                    {sideWindow.data.numGridPoints} data points averaged<br/><br/>
                    {sideWindow.data.processingTime && (
                      <>
                        <strong>Processing Time:</strong><br/>
                        {sideWindow.data.processingTime}s<br/>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <strong>Location:</strong><br/>
                    {sideWindow.data.locationName}<br/><br/>
                    <strong>Coordinates:</strong><br/>
                    Latitude: {sideWindow.data.lat}°<br/>
                    Longitude: {sideWindow.data.lng}°<br/><br/>
                    {sideWindow.data.currentPrecip && (
                      <>
                        <strong>Current Precipitation:</strong><br/>
                        {sideWindow.data.currentPrecip} mm/day<br/>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Time Series Data */}
            {(sideWindow.data.timeSeriesData) ? (
              <div>
                <div style={{ marginBottom: '15px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#2c3e50' }}>
                    {sideWindow.data.isRegion ? 'Regional Average Time Series' : 'Time Series Data'}
                  </h3>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    Period: {period} | Range: {dataRange === 'daily' ? 'Daily' : dataRange === '10day' ? '10-Day' : 'Monthly'}
                  </div>
                </div>
                
                {/* Statistics */}
                <div style={{ marginBottom: '20px', padding: '10px', background: sideWindow.data.isRegion ? '#e3f2fd' : '#e8f4fd', borderRadius: '5px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>
                    {sideWindow.data.isRegion ? 'Regional Statistics' : 'Statistics'}
                  </h4>
                  <div style={{ fontSize: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>Min: {sideWindow.data.timeSeriesData.statistics.min} mm</div>
                    <div>Max: {sideWindow.data.timeSeriesData.statistics.max} mm</div>
                    <div>Mean: {sideWindow.data.timeSeriesData.statistics.mean} mm</div>
                    <div>
                      {dataRange === 'daily' ? 'Days' : dataRange === '10day' ? 'Periods' : 'Months'}: {sideWindow.data.timeSeriesData.statistics.total_items || sideWindow.data.timeSeriesData.statistics.total_days}
                    </div>
                  </div>
                </div>

                {/* CSV Download Button */}
                <button
                  onClick={downloadCSV}
                  style={{
                    width: '100%',
                    padding: '10px 15px',
                    marginBottom: '15px',
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  <span>📥</span> Download CSV
                </button>

                {/* Time Series Chart */}
                <div 
                  onClick={() => setShowChartPopup(true)}
                  style={{ 
                    height: '400px', 
                    border: '1px solid #ddd', 
                    borderRadius: '5px', 
                    padding: '10px', 
                    background: '#fafafa',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                >
                  <div style={{ 
                    position: 'absolute', 
                    top: '5px', 
                    right: '10px', 
                    fontSize: '11px', 
                    color: '#888',
                    background: 'rgba(255,255,255,0.9)',
                    padding: '2px 6px',
                    borderRadius: '3px',
                    zIndex: 10
                  }}>
                    Click to enlarge
                  </div>
                  {sideWindow.data.timeSeriesData.time_series.length > 0 ? (
                    <Line
                      data={{
                        labels: sideWindow.data.timeSeriesData.time_series.map(item => {
                          // Format date for better display (show month-day)
                          const date = new Date(item.date);
                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }),
                        datasets: [
                          {
                            label: sideWindow.data.isRegion ? 'Regional Avg Precipitation (mm)' : 'Daily Precipitation (mm)',
                            data: sideWindow.data.timeSeriesData.time_series.map(item => item.precipitation),
                            borderColor: sideWindow.data.isRegion ? '#ff7800' : '#2196F3',
                            backgroundColor: sideWindow.data.isRegion ? 'rgba(255, 120, 0, 0.1)' : 'rgba(33, 150, 243, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: function(context) {
                              if (!context.parsed) return sideWindow.data.isRegion ? '#ff7800' : '#2196F3';
                              const value = context.parsed.y;
                              if (value > 10) return '#4CAF50';
                              if (value > 5) return '#FF9800';
                              return sideWindow.data.isRegion ? '#ff7800' : '#2196F3';
                            },
                            pointBorderColor: function(context) {
                              if (!context.parsed) return sideWindow.data.isRegion ? '#ff7800' : '#2196F3';
                              const value = context.parsed.y;
                              if (value > 10) return '#4CAF50';
                              if (value > 5) return '#FF9800';
                              return sideWindow.data.isRegion ? '#ff7800' : '#2196F3';
                            },
                            pointRadius: 4,
                            pointHoverRadius: 6
                          }
                        ]
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: {
                            position: 'top',
                            labels: {
                              font: {
                                size: 12
                              }
                            }
                          },
                          tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(0,0,0,0.8)',
                            titleColor: '#fff',
                            bodyColor: '#fff',
                            filter: function(tooltipItem) {
                              return tooltipItem && tooltipItem.parsed && tooltipItem.parsed.y != null;
                            },
                            callbacks: {
                              label: function(context) {
                                if (!context.parsed) return '';
                                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} mm`;
                              }
                            }
                          }
                        },
                        scales: {
                          x: {
                            display: true,
                            title: {
                              display: true,
                              text: 'Date',
                              font: {
                                size: 12,
                                weight: 'bold'
                              }
                            },
                            ticks: {
                              maxTicksLimit: 10,
                              font: {
                                size: 10
                              }
                            }
                          },
                          y: {
                            display: true,
                            title: {
                              display: true,
                              text: 'Precipitation (mm)',
                              font: {
                                size: 12,
                                weight: 'bold'
                              }
                            },
                            beginAtZero: true,
                            ticks: {
                              font: {
                                size: 10
                              }
                            },
                            grid: {
                              color: 'rgba(200, 200, 200, 0.3)'
                            }
                          }
                        },
                        interaction: {
                          mode: 'nearest',
                          axis: 'x',
                          intersect: false
                        }
                      }}
                    />
                  ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
                      No precipitation data available for this location and period
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: '15px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#2c3e50' }}>Time Series Data</h3>
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                    Period: {period} | Range: {dataRange === 'daily' ? 'Daily' : dataRange === '10day' ? '10-Day' : 'Monthly'}
                  </div>
                </div>
                <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                  No time series data available for this location
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
            Failed to load location data
          </div>
        )}
      </div>
    );
  };

  // Mode Toggle Component - circular image style like weather apps
  const ModeToggle = () => (
    <div style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      alignItems: 'center'
    }}>
      {[
        { mode: 'point', label: 'Point', color: '#2196F3', icon: '/icons/point.svg' },
        { mode: 'region', label: 'ZOM', color: '#ff7800', icon: '/icons/zom.svg' },
        { mode: 'box', label: 'Box', color: '#4CAF50', icon: '/icons/box.svg' }
      ].map(({ mode, label, color, icon }) => (
        <div
          key={mode}
          onClick={() => setClickMode(mode)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            background: clickMode === mode ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)',
            borderRadius: '25px',
            padding: '4px 12px 4px 4px',
            boxShadow: clickMode === mode ? '0 2px 8px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.15)',
            border: clickMode === mode ? `2px solid ${color}` : '2px solid transparent',
            transition: 'all 0.2s',
            minWidth: '100px'
          }}
        >
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: clickMode === mode ? color : '#e0e0e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0
          }}>
            <img
              src={icon}
              alt={label}
              style={{ width: '24px', height: '24px', objectFit: 'cover' }}
              onError={(e) => {
                // Fallback: hide broken image and show text
                e.target.style.display = 'none';
              }}
            />
          </div>
          <span style={{
            fontSize: '12px',
            fontWeight: clickMode === mode ? 'bold' : 'normal',
            color: clickMode === mode ? color : '#555'
          }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );

  // Coordinate Search Bar - rendered inline to avoid focus loss from re-creating component
  const coordSearchBar = (
    <div style={{
      position: 'absolute',
      bottom: '10px',
      left: '10px',
      zIndex: 1000,
      background: 'white',
      borderRadius: '10px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      padding: '10px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minWidth: '260px'
    }}>
      <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#333' }}>
        Search Coordinates
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Latitude"
          value={coordSearch.lat}
          onChange={(e) => {
            const val = e.target.value;
            // Allow numbers, minus sign, and decimal point
            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
              setCoordSearch(prev => ({ ...prev, lat: val }));
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleCoordSearch()}
          style={{
            width: '90px',
            padding: '8px 10px',
            border: '1px solid #ccc',
            borderRadius: '6px',
            fontSize: '14px',
            MozAppearance: 'textfield',
            WebkitAppearance: 'none'
          }}
        />
        <input
          type="text"
          placeholder="Longitude"
          value={coordSearch.lon}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '' || val === '-' || /^-?\d*\.?\d*$/.test(val)) {
              setCoordSearch(prev => ({ ...prev, lon: val }));
            }
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleCoordSearch()}
          style={{
            width: '90px',
            padding: '8px 10px',
            border: '1px solid #ccc',
            borderRadius: '6px',
            fontSize: '14px',
            MozAppearance: 'textfield',
            WebkitAppearance: 'none'
          }}
        />
        <button
          onClick={handleCoordSearch}
          style={{
            padding: '8px 14px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 'bold'
          }}
        >
          Go
        </button>
      </div>
      {coordError && (
        <div style={{ color: '#f44336', fontSize: '11px' }}>{coordError}</div>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', position: 'relative', height: isMobile ? '400px' : '620px' }}>
        {/* Map Container */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div 
            ref={mapRef} 
            style={{ height: '100%', width: '100%', minHeight: '300px' }}
          />
          {mapReady && precipData && (
            <>
              {/* Hide WebGL overlay in ZOM mode - replaced by colored ZOM polygons */}
              {clickMode !== 'region' && (
                <PrecipitationLayerWebGL 
                  map={mapInstanceRef.current} 
                  data={precipData}
                  opacity={0.8}
                />
              )}
              {/* Desktop: legend inside map */}
              {!isMobile && <ColorLegend stats={precipData.stats} />}
              <ModeToggle />
              {coordSearchBar}
            </>
          )}
        </div>
        
        {/* Side Panel - shown when clicked */}
        {sideWindow.visible && <SideWindow />}
      </div>
      
      {/* Mobile: legend below map */}
      {isMobile && mapReady && precipData && (
        <ColorLegend stats={precipData.stats} />
      )}
      
      {/* Time Series Popup Modal */}
      {showChartPopup && sideWindow.data?.timeSeriesData && (
        <div 
          onClick={() => setShowChartPopup(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.7)',
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '10px'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '10px',
              width: '95vw',
              maxWidth: '1200px',
              height: '90vh',
              maxHeight: '700px',
              padding: '15px',
              position: 'relative',
              boxShadow: '0 10px 50px rgba(0,0,0,0.3)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setShowChartPopup(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                fontSize: '20px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10
              }}
            >
              ×
            </button>
            
            {/* Header */}
            <div style={{ marginBottom: '15px', paddingRight: '40px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', color: '#2c3e50' }}>
                {sideWindow.data.isRegion 
                  ? `ZOM Time Series - ${sideWindow.data.zomId}`
                  : `Time Series - ${sideWindow.data.locationName || 'Selected Location'}`
                }
              </h2>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
                {sideWindow.data.isRegion && (
                  <>{sideWindow.data.province}, {sideWindow.data.island} | {sideWindow.data.climateType}<br/></>
                )}
                Period: {period} | Range: {dataRange === 'daily' ? 'Daily' : dataRange === '10day' ? '10-Day' : 'Monthly'}
                {sideWindow.data.isRegion && ` | ${sideWindow.data.numGridPoints} grid points averaged`}
              </div>
              <div style={{ fontSize: '11px', color: '#888', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <span>Min: {sideWindow.data.timeSeriesData.statistics.min} mm</span>
                <span>Max: {sideWindow.data.timeSeriesData.statistics.max} mm</span>
                <span>Mean: {sideWindow.data.timeSeriesData.statistics.mean} mm</span>
                <span>
                  {dataRange === 'daily' ? 'Days' : dataRange === '10day' ? 'Periods' : 'Months'}: {sideWindow.data.timeSeriesData.statistics.total_items}
                </span>
              </div>
            </div>
            
            {/* Large Chart */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <Line
                data={{
                  labels: sideWindow.data.timeSeriesData.time_series.map(item => {
                    const date = new Date(item.date);
                    if (dataRange === 'monthly') {
                      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                    } else if (dataRange === '10day') {
                      return item.label || date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    }
                    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  }),
                  datasets: [
                    {
                      label: sideWindow.data.isRegion ? 'Regional Avg Precipitation (mm/day)' : 'Precipitation (mm/day)',
                      data: sideWindow.data.timeSeriesData.time_series.map(item => item.precipitation),
                      borderColor: sideWindow.data.isRegion ? '#ff7800' : '#2196F3',
                      backgroundColor: sideWindow.data.isRegion ? 'rgba(255, 120, 0, 0.15)' : 'rgba(33, 150, 243, 0.15)',
                      borderWidth: 2.5,
                      fill: true,
                      tension: 0.3,
                      pointBackgroundColor: sideWindow.data.isRegion ? '#ff7800' : '#2196F3',
                      pointBorderColor: '#fff',
                      pointBorderWidth: 2,
                      pointRadius: 5,
                      pointHoverRadius: 8
                    }
                  ]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'top',
                      labels: {
                        font: { size: 14, weight: 'bold' },
                        padding: 20
                      }
                    },
                    tooltip: {
                      mode: 'index',
                      intersect: false,
                      backgroundColor: 'rgba(0,0,0,0.85)',
                      titleFont: { size: 14 },
                      bodyFont: { size: 13 },
                      padding: 12,
                      filter: function(tooltipItem) {
                        return tooltipItem && tooltipItem.parsed && tooltipItem.parsed.y != null;
                      },
                      callbacks: {
                        title: function(items) {
                          if (!items || items.length === 0) return '';
                          const idx = items[0].dataIndex;
                          const item = sideWindow.data.timeSeriesData.time_series[idx];
                          if (!item) return '';
                          if (item.end_date && item.end_date !== item.date) {
                            return `${item.date} to ${item.end_date}`;
                          }
                          return item.date;
                        },
                        label: function(context) {
                          if (!context.parsed) return '';
                          return `Precipitation: ${context.parsed.y.toFixed(2)} mm/day`;
                        },
                        afterLabel: function(context) {
                          const idx = context.dataIndex;
                          const item = sideWindow.data.timeSeriesData.time_series[idx];
                          if (item.days) {
                            return `(${item.days} days averaged)`;
                          }
                          return '';
                        }
                      }
                    }
                  },
                  scales: {
                    x: {
                      display: true,
                      title: {
                        display: true,
                        text: 'Date',
                        font: { size: 14, weight: 'bold' },
                        padding: 10
                      },
                      ticks: {
                        maxTicksLimit: 15,
                        font: { size: 12 },
                        maxRotation: 45,
                        minRotation: 0
                      },
                      grid: {
                        color: 'rgba(200, 200, 200, 0.2)'
                      }
                    },
                    y: {
                      display: true,
                      title: {
                        display: true,
                        text: 'Precipitation (mm/day)',
                        font: { size: 14, weight: 'bold' },
                        padding: 10
                      },
                      beginAtZero: true,
                      ticks: {
                        font: { size: 12 }
                      },
                      grid: {
                        color: 'rgba(200, 200, 200, 0.3)'
                      }
                    }
                  },
                  interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}