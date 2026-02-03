'use client';

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

// Color legend component
function ColorLegend({ stats }) {
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
  const [clickMode, setClickMode] = useState('point'); // 'point' or 'region'
  const provinceLayerRef = useRef(null);
  const selectedProvinceRef = useRef(null);
  const indonesiaGeoJsonRef = useRef(null);

  // Convert dataRange to API mode
  const getApiMode = () => {
    if (dataRange === 'daily') return 'day';
    if (dataRange === '10day') return '10day';
    if (dataRange === 'monthly') return 'monthly';
    return 'day';
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
        `http://localhost:5000/api/timeseries?lat=${lat}&lon=${lng}&period=${period}&mode=${mode}`
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

  // Auto-refresh time series when period or dataRange changes
  useEffect(() => {
    if (!sideWindow.visible || !sideWindow.data || sideWindow.loading) return;
    
    const refreshData = async () => {
      setSideWindow(prev => ({ ...prev, loading: true }));
      const mode = getApiMode();
      
      if (sideWindow.data.isRegion && sideWindow.data.geometry) {
        // Refresh region data
        try {
          const response = await fetch('http://localhost:5000/api/timeseries/region', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              geometry: sideWindow.data.geometry,
              province_name: sideWindow.data.provinceName,
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
            `http://localhost:5000/api/timeseries?lat=${sideWindow.data.lat}&lon=${sideWindow.data.lng}&period=${period}&mode=${mode}`
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
  }, [period, dataRange]);

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

    const map = L.map(mapRef.current, {
      maxBounds: overlayBounds,       // Restrict panning to overlay area
      maxBoundsViscosity: 1.0,        // Prevent any dragging outside bounds
      minZoom: 5,                     // Prevent zooming out too far
    }).setView([-2.5, 116], 5);       // Center: (-11+6)/2=-2.5, (91+141)/2=116

    // Create a custom pane for coastlines that sits ABOVE the overlay
    map.createPane('coastlinePane');
    map.getPane('coastlinePane').style.zIndex = 450;  // Above overlayPane (400) but below markerPane (600)
    map.getPane('coastlinePane').style.pointerEvents = 'none';  // Allow clicks through

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

    // Load Indonesia boundaries only (provinces + coastline)
    // This gives us VECTOR lines with fixed stroke width regardless of zoom
    const loadIndonesiaBorders = async () => {
      try {
        // Load Indonesia provinces GeoJSON (includes coastlines and province boundaries)
        const response = await fetch('https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia.geojson');
        const geojson = await response.json();
        
        // Store GeoJSON for later use
        indonesiaGeoJsonRef.current = geojson;
        
        // Add Indonesia provinces with fixed styling (border only layer - always visible)
        L.geoJSON(geojson, {
          pane: 'coastlinePane',
          style: {
            color: '#000000',      // Black color for borders
            weight: 1.5,           // Fixed 1.5px width - consistent at all zoom levels
            opacity: 1,            // Full opacity for clear visibility
            fill: false            // No fill, just borders
          }
        }).addTo(map);
        
        console.log('✅ Indonesia borders loaded');
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
          
          indonesiaGeoJsonRef.current = indonesiaOnly;
          
          L.geoJSON(indonesiaOnly, {
            pane: 'coastlinePane',
            style: {
              color: '#000000',
              weight: 1.5,
              opacity: 1,
              fill: false
            }
          }).addTo(map);
          
          console.log('✅ Indonesia borders loaded (fallback)');
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
    
    // bounds is an object: { minLat, maxLat, minLon, maxLon }
    const dataBounds = L.latLngBounds(
      [bounds.minLat, bounds.minLon],  // Southwest
      [bounds.maxLat, bounds.maxLon]   // Northeast
    );
    
    // Update map maxBounds to match actual data
    map.setMaxBounds(dataBounds);
    
    // Fit the map view to show the entire precipitation layer
    map.fitBounds(dataBounds, { padding: [20, 20] });
    
    console.log('📍 Map centered on precipitation bounds:', bounds);
  }, [precipData]);

  // Create/update clickable province layer when mode changes
  useEffect(() => {
    if (!mapInstanceRef.current || !indonesiaGeoJsonRef.current) return;
    
    const L = require('leaflet');
    const map = mapInstanceRef.current;
    
    // Remove existing province layer if any
    if (provinceLayerRef.current) {
      map.removeLayer(provinceLayerRef.current);
      provinceLayerRef.current = null;
    }
    
    // Remove selected province highlight
    if (selectedProvinceRef.current) {
      map.removeLayer(selectedProvinceRef.current);
      selectedProvinceRef.current = null;
    }
    
    // Only create clickable layer in region mode
    if (clickMode === 'region') {
      const geojson = indonesiaGeoJsonRef.current;
      
      provinceLayerRef.current = L.geoJSON(geojson, {
        style: {
          color: '#3388ff',
          weight: 2,
          opacity: 0.6,
          fillColor: '#3388ff',
          fillOpacity: 0.1
        },
        onEachFeature: (feature, layer) => {
          // Get province name from properties
          const provinceName = feature.properties.state || 
                               feature.properties.name || 
                               feature.properties.NAME_1 ||
                               feature.properties.PROVINSI ||
                               'Unknown Province';
          
          // Bind tooltip with province name (shown on hover)
          layer.bindTooltip(provinceName, {
            permanent: false,
            direction: 'top',
            className: 'province-tooltip',
            offset: [0, -10]
          });
          
          // Hover effects
          layer.on('mouseover', function() {
            this.setStyle({
              fillOpacity: 0.3,
              weight: 3
            });
            this.openTooltip();
          });
          
          layer.on('mouseout', function() {
            this.setStyle({
              fillOpacity: 0.1,
              weight: 2
            });
            this.closeTooltip();
          });
          
          // Click handler for province
          layer.on('click', async function(e) {
            L.DomEvent.stopPropagation(e);
            
            // Remove old marker if exists
            if (markerRef.current) {
              map.removeLayer(markerRef.current);
              markerRef.current = null;
            }
            
            // Remove old selected province highlight
            if (selectedProvinceRef.current) {
              map.removeLayer(selectedProvinceRef.current);
            }
            
            // Highlight selected province
            selectedProvinceRef.current = L.geoJSON(feature, {
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
              const response = await fetch('http://localhost:5000/api/timeseries/region', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  geometry: feature.geometry,
                  province_name: provinceName,
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
                    provinceName: provinceName,
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
      
      console.log('✅ Clickable province layer created');
    }
    
    return () => {
      if (provinceLayerRef.current) {
        map.removeLayer(provinceLayerRef.current);
        provinceLayerRef.current = null;
      }
    };
  }, [clickMode, period, dataRange]);

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

      // Remove old marker if exists
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
      }
      
      // Remove selected province highlight if any
      if (selectedProvinceRef.current) {
        map.removeLayer(selectedProvinceRef.current);
        selectedProvinceRef.current = null;
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
          `http://localhost:5000/api/timeseries?lat=${lat}&lon=${lng}&period=${period}&mode=${mode}`
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
          width: '400px',
          height: '100vh',
          background: 'white',
          boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
          zIndex: 2000,
          padding: '20px',
          overflowY: 'auto',
          fontFamily: 'Arial, sans-serif'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#333' }}>Error</h2>
            <button 
              onClick={() => setSideWindow({ visible: false, data: null, loading: false })}
              style={{ background: '#f44336', color: 'white', border: 'none', borderRadius: '3px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px' }}
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
        position: 'fixed',
        top: '0',
        right: '0',
        width: '400px',
        height: '100vh',
        background: 'white',
        boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
        zIndex: 2000,
        padding: '20px',
        overflowY: 'auto',
        fontFamily: 'Arial, sans-serif'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#333' }}>
            {sideWindow.data?.isRegion ? 'Regional Data' : 'Location Details'}
          </h2>
          <button 
            onClick={() => setSideWindow({ visible: false, data: null, loading: false })}
            style={{
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '3px',
              padding: '5px 10px',
              cursor: 'pointer',
              fontSize: '12px'
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
                {sideWindow.data.isRegion ? '🗺️ Province Information' : 'Basic Information'}
              </h3>
              <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
                {sideWindow.data.isRegion ? (
                  <>
                    <strong>Province:</strong><br/>
                    {sideWindow.data.provinceName}<br/><br/>
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
                    🔍 Click to enlarge
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
                              const value = context.parsed.y;
                              if (value > 10) return '#4CAF50';
                              if (value > 5) return '#FF9800';
                              return sideWindow.data.isRegion ? '#ff7800' : '#2196F3';
                            },
                            pointBorderColor: function(context) {
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
                            callbacks: {
                              label: function(context) {
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

  // Mode Toggle Component
  const ModeToggle = () => (
    <div style={{
      position: 'absolute',
      top: '10px',
      left: '60px',
      zIndex: 1000,
      background: 'white',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
      padding: '8px',
      display: 'flex',
      gap: '4px'
    }}>
      <button
        onClick={() => setClickMode('point')}
        style={{
          padding: '8px 16px',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: clickMode === 'point' ? 'bold' : 'normal',
          background: clickMode === 'point' ? '#2196F3' : '#e0e0e0',
          color: clickMode === 'point' ? 'white' : '#333',
          fontSize: '13px',
          transition: 'all 0.2s'
        }}
      >
        📍 Point
      </button>
      <button
        onClick={() => setClickMode('region')}
        style={{
          padding: '8px 16px',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontWeight: clickMode === 'region' ? 'bold' : 'normal',
          background: clickMode === 'region' ? '#ff7800' : '#e0e0e0',
          color: clickMode === 'region' ? 'white' : '#333',
          fontSize: '13px',
          transition: 'all 0.2s'
        }}
      >
        🗺️ Province
      </button>
    </div>
  );

  return (
    <div style={{ position: 'relative' }}>
      <div 
        ref={mapRef} 
        style={{ height: '600px', width: '100%', marginTop: '20px' }}
      />
      {mapReady && precipData && (
        <>
          <PrecipitationLayerWebGL 
            map={mapInstanceRef.current} 
            data={precipData}
            opacity={0.8}
          />
          <ColorLegend stats={precipData.stats} />
          <ModeToggle />
        </>
      )}
      <SideWindow />
      
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
            padding: '20px'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '10px',
              width: '90vw',
              maxWidth: '1200px',
              height: '80vh',
              maxHeight: '700px',
              padding: '25px',
              position: 'relative',
              boxShadow: '0 10px 50px rgba(0,0,0,0.3)'
            }}
          >
            {/* Close button */}
            <button
              onClick={() => setShowChartPopup(false)}
              style={{
                position: 'absolute',
                top: '15px',
                right: '15px',
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
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '20px', color: '#2c3e50' }}>
                {sideWindow.data.isRegion 
                  ? `📊 Regional Time Series - ${sideWindow.data.provinceName}`
                  : `📊 Time Series - ${sideWindow.data.locationName || 'Selected Location'}`
                }
              </h2>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
                Period: {period} | Range: {dataRange === 'daily' ? 'Daily' : dataRange === '10day' ? '10-Day' : 'Monthly'}
                {sideWindow.data.isRegion && ` | ${sideWindow.data.numGridPoints} grid points averaged`}
              </div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '4px', display: 'flex', gap: '20px' }}>
                <span>Min: {sideWindow.data.timeSeriesData.statistics.min} mm</span>
                <span>Max: {sideWindow.data.timeSeriesData.statistics.max} mm</span>
                <span>Mean: {sideWindow.data.timeSeriesData.statistics.mean} mm</span>
                <span>
                  {dataRange === 'daily' ? 'Days' : dataRange === '10day' ? 'Periods' : 'Months'}: {sideWindow.data.timeSeriesData.statistics.total_items}
                </span>
              </div>
            </div>
            
            {/* Large Chart */}
            <div style={{ height: 'calc(100% - 100px)' }}>
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
                      callbacks: {
                        title: function(items) {
                          const idx = items[0].dataIndex;
                          const item = sideWindow.data.timeSeriesData.time_series[idx];
                          if (item.end_date && item.end_date !== item.date) {
                            return `${item.date} to ${item.end_date}`;
                          }
                          return item.date;
                        },
                        label: function(context) {
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