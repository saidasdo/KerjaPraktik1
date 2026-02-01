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

export default function Map({ precipData }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [clickInfo, setClickInfo] = useState(null);
  const [sideWindow, setSideWindow] = useState({ visible: false, data: null, loading: false });
  const [selectedPeriod, setSelectedPeriod] = useState('202508');
  const markerRef = useRef(null);

  // Available periods for time series
  const availablePeriods = [
    { value: '202508', label: 'August 2025' },
    { value: '202412', label: 'December 2024' },
    { value: '202501', label: 'January 2025' },
    { value: '202601', label: 'January 2026' }
  ];

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
  const refreshTimeSeriesData = async (period) => {
    if (!sideWindow.data) return;
    
    setSideWindow(prev => ({ ...prev, loading: true }));
    
    const { lat, lng } = sideWindow.data;
    try {
      const timeSeriesResponse = await fetch(
        `http://localhost:5000/api/timeseries?lat=${lat}&lon=${lng}&period=${period}`
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

    const map = L.map(mapRef.current).setView([-2.5, 118], 5);


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

  // Add click handler when map and data are ready
  useEffect(() => {
    if (!mapInstanceRef.current || !precipData) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    const handleClick = async (e) => {
      const { lat, lng } = e.latlng;
      const precip = getPrecipitationAt(lat, lng);

      // Remove old marker if exists
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
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
      try {
        const timeSeriesResponse = await fetch(
          `http://localhost:5000/api/timeseries?lat=${lat}&lon=${lng}&period=${selectedPeriod}`
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
  }, [precipData]);

  // Side Window Component
  const SideWindow = () => {
    if (!sideWindow.visible) return null;

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
          <h2 style={{ margin: 0, fontSize: '18px', color: '#333' }}>Location Details</h2>
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
            <div>Loading location data...</div>
          </div>
        ) : sideWindow.data ? (
          <div>
            {/* Basic Information */}
            <div style={{ marginBottom: '25px', padding: '15px', background: '#f8f9fa', borderRadius: '5px' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#2c3e50' }}>Basic Information</h3>
              <div style={{ fontSize: '14px', lineHeight: '1.6' }}>
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
              </div>
            </div>

            {/* Time Series Data */}
            {sideWindow.data.timeSeriesData ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#2c3e50' }}>Time Series Data</h3>
                  <select 
                    value={selectedPeriod}
                    onChange={(e) => {
                      setSelectedPeriod(e.target.value);
                      refreshTimeSeriesData(e.target.value);
                    }}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                      border: '1px solid #ccc',
                      borderRadius: '3px',
                      background: 'white'
                    }}
                  >
                    {availablePeriods.map(period => (
                      <option key={period.value} value={period.value}>
                        {period.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* Statistics */}
                <div style={{ marginBottom: '20px', padding: '10px', background: '#e8f4fd', borderRadius: '5px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>Statistics</h4>
                  <div style={{ fontSize: '13px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>Min: {sideWindow.data.timeSeriesData.statistics.min} mm</div>
                    <div>Max: {sideWindow.data.timeSeriesData.statistics.max} mm</div>
                    <div>Mean: {sideWindow.data.timeSeriesData.statistics.mean} mm</div>
                    <div>Days: {sideWindow.data.timeSeriesData.statistics.total_days}</div>
                  </div>
                </div>

                {/* Time Series Chart */}
                <div style={{ height: '400px', border: '1px solid #ddd', borderRadius: '5px', padding: '10px', background: '#fafafa' }}>
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
                            label: 'Daily Precipitation (mm)',
                            data: sideWindow.data.timeSeriesData.time_series.map(item => item.precipitation),
                            borderColor: '#2196F3',
                            backgroundColor: 'rgba(33, 150, 243, 0.1)',
                            borderWidth: 2,
                            fill: true,
                            tension: 0.4,
                            pointBackgroundColor: function(context) {
                              const value = context.parsed.y;
                              if (value > 10) return '#4CAF50';
                              if (value > 5) return '#FF9800';
                              return '#2196F3';
                            },
                            pointBorderColor: function(context) {
                              const value = context.parsed.y;
                              if (value > 10) return '#4CAF50';
                              if (value > 5) return '#FF9800';
                              return '#2196F3';
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', color: '#2c3e50' }}>Time Series Data</h3>
                  <select 
                    value={selectedPeriod}
                    onChange={(e) => {
                      setSelectedPeriod(e.target.value);
                      refreshTimeSeriesData(e.target.value);
                    }}
                    style={{
                      padding: '4px 8px',
                      fontSize: '12px',
                      border: '1px solid #ccc',
                      borderRadius: '3px',
                      background: 'white'
                    }}
                  >
                    {availablePeriods.map(period => (
                      <option key={period.value} value={period.value}>
                        {period.label}
                      </option>
                    ))}
                  </select>
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
        </>
      )}
      <SideWindow />
    </div>
  );
}