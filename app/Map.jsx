'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import PrecipitationLayer from './PrecipitationLayer';

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
        maxZoom: 6
      }
    ).addTo(map);


    // OpenStreetMap with labels - shown when zoomed out (country/regional view)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      minZoom: 7,
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

  return (
    <div style={{ position: 'relative' }}>
      <div 
        ref={mapRef} 
        style={{ height: '600px', width: '100%', marginTop: '20px' }}
      />
      {mapReady && precipData && (
        <>
          <PrecipitationLayer 
            map={mapInstanceRef.current} 
            data={precipData}
            opacity={0.7}
          />
          <ColorLegend stats={precipData.stats} />
        </>
      )}
    </div>
  );
}