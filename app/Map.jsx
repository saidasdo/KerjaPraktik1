'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import PrecipitationLayerWebGL from './PrecipitationLayerWebGL';

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
  const markerRef = useRef(null);

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

      if (precip !== null) {
        // Create popup content with location
        const popupContent = `
          <div style="font-size: 13px;">
            <strong>Location:</strong><br/>
            ${locationName}<br/>
            <br/>
            <strong>Coordinates:</strong><br/>
            Lat: ${lat.toFixed(4)}°<br/>
            Lon: ${lng.toFixed(4)}°<br/>
            <br/>
            <strong>Precipitation:</strong><br/>
            ${precip.toFixed(2)} mm/day<br/>
            <br/>
          </div>
        `;

        // Create marker with popup
        const marker = L.marker([lat, lng])
          .addTo(map)
          .bindPopup(popupContent)
          .openPopup();

        markerRef.current = marker;

        // Update state for info box
        setClickInfo({
          lat: lat.toFixed(4),
          lon: lng.toFixed(4),
          precip: precip.toFixed(2)
        });
      } else {
        // Show "no data" popup with location
        const marker = L.marker([lat, lng])
          .addTo(map)
          .bindPopup(`
            <div style="font-size: 13px;">
              <strong>Location:</strong><br/>
              ${locationName}<br/>
              <br/>
              <strong>Coordinates:</strong><br/>
              Lat: ${lat.toFixed(4)}°<br/>
              Lon: ${lng.toFixed(4)}°<br/>
              <br/>
              <em>No precipitation data</em>
            </div>
          `)
          .openPopup();

        markerRef.current = marker;
        setClickInfo(null);
      }
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
    </div>
  );
}