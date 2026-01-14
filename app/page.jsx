'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [hovmollers, setHovmollers] = useState({
    variable: '',
    level: '',
    algorithm: '',
    latitude: ''
  });

  const [maps, setMaps] = useState({
    variable: '',
    level: '',
    algorithm: '',
    waveTCs: '',
    region: '',
    days: ''
  });

  const [sstMaps, setSstMaps] = useState({
    variable: '',
    region: '',
    days: ''
  });

  const [currentImage, setCurrentImage] = useState('');

  const variables = ['Temperature', 'Pressure', 'Humidity', 'Wind Speed'];
  const levels = ['Surface', '850mb', '700mb', '500mb', '200mb'];
  const algorithms = ['Algorithm A', 'Algorithm B', 'Algorithm C'];
  const latitudes = ['0°', '10°N', '20°N', '30°N'];
  const waveTCs = ['Wave 1', 'Wave 2', 'TC 1', 'TC 2'];
  const regions = ['Atlantic', 'Pacific', 'Indian Ocean', 'Caribbean'];
  const days = ['Today', '1 Day', '3 Days', '5 Days', '7 Days'];

  const generateImageUrl = () => {
    // Example: Build URL based on selected options
    // You would replace this with your actual image URL logic
    const params = new URLSearchParams();
    
    if (hovmollers.variable) params.append('hov_var', hovmollers.variable);
    if (hovmollers.level) params.append('hov_level', hovmollers.level);
    if (hovmollers.algorithm) params.append('hov_algo', hovmollers.algorithm);
    if (hovmollers.latitude) params.append('hov_lat', hovmollers.latitude);
    
    if (maps.variable) params.append('map_var', maps.variable);
    if (maps.level) params.append('map_level', maps.level);
    if (maps.algorithm) params.append('map_algo', maps.algorithm);
    if (maps.waveTCs) params.append('map_wave', maps.waveTCs);
    if (maps.region) params.append('map_region', maps.region);
    if (maps.days) params.append('map_days', maps.days);
    
    if (sstMaps.variable) params.append('sst_var', sstMaps.variable);
    if (sstMaps.region) params.append('sst_region', sstMaps.region);
    if (sstMaps.days) params.append('sst_days', sstMaps.days);

    // Replace this with your actual image server URL
    return params.toString() ? `https://example.com/api/image?${params.toString()}` : '';
  };

  useEffect(() => {
    const newImageUrl = generateImageUrl();
    setCurrentImage(newImageUrl);
  }, [hovmollers, maps, sstMaps]);

  const handleHovmollersChange = (field, value) => {
    setHovmollers(prev => ({ ...prev, [field]: value }));
  };

  const handleMapsChange = (field, value) => {
    setMaps(prev => ({ ...prev, [field]: value }));
  };

  const handleSstMapsChange = (field, value) => {
    setSstMaps(prev => ({ ...prev, [field]: value }));
  };

  const handleHovmollersSubmit = (e) => {
    e.preventDefault();
    console.log('Hovmöllers submitted:', hovmollers);
  };

  const handleMapsSubmit = (e) => {
    e.preventDefault();
    console.log('Maps submitted:', maps);
  };

  const handleSstMapsSubmit = (e) => {
    e.preventDefault();
    console.log('SST Maps submitted:', sstMaps);
  };

  return (
    <div className="app">
      <h1>Tes 1</h1>

      <div className="content-wrapper">
        <div className="controls-section">
          {/* Hovmöllers Section */}
          <section className="control-group">
            <h2>+ Figures</h2>
            <h3>Hovmöllers:</h3>
            <form onSubmit={handleHovmollersSubmit}>
              <div className="dropdown-row">
                <select 
                  value={hovmollers.variable}
                  onChange={(e) => handleHovmollersChange('variable', e.target.value)}
                >
                  <option value="">Select variable</option>
                  {variables.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select 
                  value={hovmollers.level}
                  onChange={(e) => handleHovmollersChange('level', e.target.value)}
                >
                  <option value="">Select Level</option>
                  {levels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>

                <select 
                  value={hovmollers.algorithm}
                  onChange={(e) => handleHovmollersChange('algorithm', e.target.value)}
                >
                  <option value="">Select algorithm</option>
                  {algorithms.map(a => <option key={a} value={a}>{a}</option>)}
                </select>

                <select 
                  value={hovmollers.latitude}
                  onChange={(e) => handleHovmollersChange('latitude', e.target.value)}
                >
                  <option value="">Select Latitude</option>
                  {latitudes.map(lat => <option key={lat} value={lat}>{lat}</option>)}
                </select>

                <button type="submit">Submit</button>
              </div>
            </form>
          </section>

          {/* Maps Section */}
          <section className="control-group">
            <h3>Maps:</h3>
            <form onSubmit={handleMapsSubmit}>
              <div className="dropdown-row">
                <select 
                  value={maps.variable}
                  onChange={(e) => handleMapsChange('variable', e.target.value)}
                >
                  <option value="">Select variable</option>
                  {variables.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select 
                  value={maps.level}
                  onChange={(e) => handleMapsChange('level', e.target.value)}
                >
                  <option value="">Select Level</option>
                  {levels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>

                <select 
                  value={maps.algorithm}
                  onChange={(e) => handleMapsChange('algorithm', e.target.value)}
                >
                  <option value="">Select algorithm</option>
                  {algorithms.map(a => <option key={a} value={a}>{a}</option>)}
                </select>

                <select 
                  value={maps.waveTCs}
                  onChange={(e) => handleMapsChange('waveTCs', e.target.value)}
                >
                  <option value="">Select Wave/TCs</option>
                  {waveTCs.map(w => <option key={w} value={w}>{w}</option>)}
                </select>

                <select 
                  value={maps.region}
                  onChange={(e) => handleMapsChange('region', e.target.value)}
                >
                  <option value="">Select Region</option>
                  {regions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>

                <select 
                  value={maps.days}
                  onChange={(e) => handleMapsChange('days', e.target.value)}
                >
                  <option value="">Select Days</option>
                  {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>

                <button type="submit">Submit</button>
              </div>
            </form>
          </section>

          {/* SST Maps Section */}
          <section className="control-group">
            <h3>SST Maps:</h3>
            <form onSubmit={handleSstMapsSubmit}>
              <div className="dropdown-row">
                <select 
                  value={sstMaps.variable}
                  onChange={(e) => handleSstMapsChange('variable', e.target.value)}
                >
                  <option value="">Select variable</option>
                  {variables.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select 
                  value={sstMaps.region}
                  onChange={(e) => handleSstMapsChange('region', e.target.value)}
                >
                  <option value="">Select Region</option>
                  {regions.map(r => <option key={r} value={r}>{r}</option>)}
                </select>

                <select 
                  value={sstMaps.days}
                  onChange={(e) => handleSstMapsChange('days', e.target.value)}
                >
                  <option value="">Select Days</option>
                  {days.map(d => <option key={d} value={d}>{d}</option>)}
                </select>

                <button type="submit">Submit</button>
              </div>
            </form>
          </section>
        </div>

        {/* Image Display Section */}
        <div className="image-section">
          <h2>Generated Image</h2>
          {currentImage ? (
            <div className="image-container">
              <img 
                src={currentImage} 
                alt="Generated visualization"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.nextSibling.style.display = 'block';
                }}
              />
              <div className="placeholder" style={{ display: 'none' }}>
                <p>Image not available</p>
                <p className="url-display">URL: {currentImage}</p>
              </div>
            </div>
          ) : (
            <div className="placeholder">
              <p>Select options to generate an image</p>
            </div>
          )}
          
          <div className="state-display">
            <h3>Current Selection:</h3>
            <div className="state-info">
              <strong>Hovmöllers:</strong>
              <pre>{JSON.stringify(hovmollers, null, 2)}</pre>
            </div>
            <div className="state-info">
              <strong>Maps:</strong>
              <pre>{JSON.stringify(maps, null, 2)}</pre>
            </div>
            <div className="state-info">
              <strong>SST Maps:</strong>
              <pre>{JSON.stringify(sstMaps, null, 2)}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
