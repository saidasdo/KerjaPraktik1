'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import PrecipitationLayerWebGL from './PrecipitationLayerWebGL';

// Color legend component
function ColorLegend({ stats }) {
  const colors = [
    '#FFFFCC', '#C7E9B4', '#7FCDBB', '#41B6C4', 
    '#1D91C0', '#225EA8', '#0C2C84'
  ];
  
  const minVal = stats?.min ?? 0;
  const maxVal = stats?.max ?? 100;
  
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
      fontSize: '12px'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
        Precipitation (mm)
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ 
          width: '20px', 
          height: '120px',
          background: `linear-gradient(to bottom, ${colors.slice().reverse().join(', ')})`,
          marginRight: '8px',
          border: '1px solid #ccc'
        }} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '120px' }}>
          <span>{maxVal.toFixed(1)}</span>
          <span>{((maxVal + minVal) / 2).toFixed(1)}</span>
          <span>{minVal.toFixed(1)}</span>
        </div>
      </div>
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

    const handleClick = (e) => {
      const { lat, lng } = e.latlng;
      const precip = getPrecipitationAt(lat, lng);

      // Remove old marker if exists
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
      }

      if (precip !== null) {
        // Get data range for context
        const { values } = precipData;
        const allValues = values.flat().filter(v => v !== -999 && v >= 0);
        allValues.sort((a, b) => a - b);
        const p99 = allValues[Math.floor(allValues.length * 0.99)] || Math.max(...allValues);
        
        // Calculate color position (same as WebGL shader)
        const normalized01 = Math.min(1, precip / p99);
        const gammaCorrected = Math.sqrt(normalized01); // Square root for better distribution
        const colorPercent = (gammaCorrected * 100).toFixed(0);
        
        // Determine color range description
        let colorDesc = '';
        if (gammaCorrected < 0.167) colorDesc = 'Yellow (Low)';
        else if (gammaCorrected < 0.333) colorDesc = 'Lime-Green';
        else if (gammaCorrected < 0.5) colorDesc = 'Green';
        else if (gammaCorrected < 0.667) colorDesc = 'Cyan';
        else if (gammaCorrected < 0.833) colorDesc = 'Blue';
        else colorDesc = 'Dark Blue (High)';
        
        // Create popup content
        const popupContent = `
          <div style="font-size: 13px;">
            <strong>Location:</strong><br/>
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
        // Show "no data" popup
        const marker = L.marker([lat, lng])
          .addTo(map)
          .bindPopup(`
            <div style="font-size: 13px;">
              <strong>Location:</strong><br/>
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