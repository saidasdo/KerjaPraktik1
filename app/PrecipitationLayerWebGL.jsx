'use client';

import { useEffect, useRef } from 'react';

// WebGL Shaders
const VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  
  varying vec2 v_texCoord;
  uniform sampler2D u_data;
  uniform vec2 u_dataSize;
  uniform float u_opacity;
  uniform float u_maxPrecip; 
  
  // Solid color bands based on precipitation ranges (mm)
  vec3 colormap(float t) {
    // Clamp t to 0-1
    t = clamp(t, 0.0, 1.0);
    
    // Map normalized value back to precipitation amount (0-500+ mm scale)
    // Assuming max value of 500mm for the upper bound
    float precip = t * u_maxPrecip;
    
    // Solid color bands
    if (t < 0.04) {          // 0-4% of max
      return vec3(0.204, 0.039, 0.0);     // #340A00
    } else if (t < 0.10) {   // 4-10% of max
      return vec3(0.557, 0.157, 0.0);     // #8E2800
    } else if (t < 0.20) {   // 10-20% of max
      return vec3(0.863, 0.384, 0.0);     // #DC6200
    } else if (t < 0.30) {   // 20-30% of max
      return vec3(0.937, 0.655, 0.0);     // #EFA700
    } else if (t < 0.40) {   // 30-40% of max
      return vec3(0.922, 0.882, 0.0);     // #EBE100
    } else if (t < 0.55) {   // 40-55% of max
      return vec3(0.878, 0.992, 0.408);   // #E0FD68
    } else if (t < 0.70) {   // 55-70% of max
      return vec3(0.541, 0.835, 0.545);   // #8AD58B
    } else if (t < 0.85) {   // 70-85% of max
      return vec3(0.212, 0.569, 0.208);   // #369135
    } else {                 // 85-100%+ (darkest green gets larger range)
      return vec3(0.0, 0.275, 0.047);     // #00460C
    }
  }
  
  void main() {
    // Simple texture lookup with linear filtering
    vec4 texel = texture2D(u_data, v_texCoord);
    
    float value = texel.r;  // Value is in R channel (0-1 range, was 0-255 stored)
    float alpha = texel.a;  // Alpha indicates validity
    
    // Discard invalid pixels
    if (alpha < 0.5) {
      discard;
    }
    
    // Apply colormap directly - value is already normalized 0-1
    vec3 color = colormap(value);
    
    gl_FragColor = vec4(color, u_opacity);
  }
`;

// Create shader
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

// Create program
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

// Render precipitation data using WebGL
export function renderPrecipitationWebGL(canvas, data, minVal = 0, maxVal = 100, opacity = 0.8) {
  const { lat, lon, values } = data;
  
  const gl = canvas.getContext('webgl', { 
    alpha: true, 
    premultipliedAlpha: false,
    antialias: true 
  });
  
  if (!gl) {
    console.error('WebGL not supported');
    return null;
  }
  
  // Create shaders and program
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = createProgram(gl, vertexShader, fragmentShader);
  
  if (!program) return null;
  
  gl.useProgram(program);
  
  // Set up vertex positions (full screen quad)
  const positions = new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1
  ]);
  
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  
  const positionLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);
  
  // Set up texture coordinates
  const texCoords = new Float32Array([
    0, 1,  1, 1,  0, 0,
    0, 0,  1, 1,  1, 0
  ]);
  
  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
  
  const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');
  gl.enableVertexAttribArray(texCoordLoc);
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 0, 0);
  
  // Create data texture
  const width = lon.length;
  const height = lat.length;
  const latAscending = lat[0] < lat[lat.length - 1];
  
  // First pass: analyze data distribution
  let minFound = Infinity;
  let maxFound = -Infinity;
  let validCount = 0;
  const allValidValues = [];
  
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const srcY = latAscending ? (height - 1 - i) : i;
      const value = values[srcY]?.[j] ?? -999;
      
      if (value !== -999 && value >= 0) {
        validCount++;
        allValidValues.push(value);
        if (value < minFound) minFound = value;
        if (value > maxFound) maxFound = value;
      }
    }
  }
  
  // Sort to find percentiles for better color distribution
  allValidValues.sort((a, b) => a - b);
  const p10 = allValidValues[Math.floor(allValidValues.length * 0.1)] || 0;
  const p50 = allValidValues[Math.floor(allValidValues.length * 0.5)] || 0;
  const p90 = allValidValues[Math.floor(allValidValues.length * 0.9)] || 0;
  const p99 = allValidValues[Math.floor(allValidValues.length * 0.99)] || maxFound;
  
  console.log('WebGL data analysis:', { 
    width, height, validCount, 
    dataMin: minFound, dataMax: maxFound, 
    percentiles: { p10, p50, p90, p99 },
    scaleMin: minVal, scaleMax: maxVal 
  });
  
  // Use p99 as effective max to avoid outliers dominating the scale
  const effectiveMax = Math.max(p99, 1);
  
  // Pack data into RGBA texture
  // Use square root (gamma 0.5) scaling for better distribution of precipitation data
  const textureData = new Uint8Array(width * height * 4);
  let sampleValues = [];
  let colorDistribution = { low: 0, mid: 0, high: 0 }; // Track color distribution
  
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const srcY = latAscending ? (height - 1 - i) : i;
      const value = values[srcY]?.[j] ?? -999;
      const texIdx = (i * width + j) * 4;
      
      if (value !== -999 && value >= 0) {
        // Normalize to 0-1 using effective max (p99)
        const normalized01 = Math.min(1, value / effectiveMax);
        
        ///versi 1///
        //const gammaCorrected = Math.sqrt(normalized01);
  

        ///versi2///
        const base = Math.log1p(normalized01 * 10) / Math.log1p(10);
        const threshold = 0.2; 
        const multiplier = 1.8; 
        let gammaCorrected;
        if (base < threshold) {
          gammaCorrected = base; 
        } else {
          gammaCorrected = threshold + (base - threshold) * multiplier;
        }

        const normalizedValue = Math.round(Math.min(1, gammaCorrected) * 255);
        
        textureData[texIdx] = normalizedValue;     // R: normalized value (0-255)
        textureData[texIdx + 1] = 0;               // G: unused
        textureData[texIdx + 2] = 0;               // B: unused
        textureData[texIdx + 3] = 255;             // A: valid
        
        // Track distribution
        if (normalizedValue < 85) colorDistribution.low++;
        else if (normalizedValue < 170) colorDistribution.mid++;
        else colorDistribution.high++;
        
        // Collect sample values for debugging
        if (sampleValues.length < 10 && value > 0) {
          sampleValues.push({ value: value.toFixed(2), normalized: normalizedValue });
        }
      } else {
        textureData[texIdx] = 0;
        textureData[texIdx + 1] = 0;
        textureData[texIdx + 2] = 0;
        textureData[texIdx + 3] = 0;               // A: invalid (transparent)
      }
    }
  }
  
  console.log('WebGL color distribution:', colorDistribution);
  console.log('WebGL sample values (first 10 non-zero):', sampleValues);
  
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
  
  // Use linear filtering for smooth interpolation
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  
  // Set uniforms
  gl.uniform1i(gl.getUniformLocation(program, 'u_data'), 0);
  gl.uniform2f(gl.getUniformLocation(program, 'u_dataSize'), width, height);
  gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), opacity);
  gl.uniform1f(gl.getUniformLocation(program, 'u_maxPrecip'), effectiveMax);
  
  // Clear and draw
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  
  // Cleanup
  gl.deleteBuffer(positionBuffer);
  gl.deleteBuffer(texCoordBuffer);
  gl.deleteTexture(texture);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  gl.deleteProgram(program);
  
  return canvas;
}

export default function PrecipitationLayerWebGL({ map, data, opacity = 0.7 }) {
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map || !data || !data.lat || !data.lon || !data.values || !data.bounds) {
      return;
    }

    const L = require('leaflet');

    // Remove old layer if exists
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    const { lat, lon, values, stats, bounds: dataBounds } = data;
    
    // Create canvas for WebGL rendering
    const canvas = document.createElement('canvas');
    // Higher resolution for quality
    canvas.width = lon.length * 4;
    canvas.height = lat.length * 4;
    
    const startTime = performance.now();
    
    // Render using WebGL
    renderPrecipitationWebGL(canvas, data, stats?.min ?? 0, stats?.max ?? 100, opacity);
    
    console.log(`WebGL render time: ${(performance.now() - startTime).toFixed(2)}ms`);
    
    // Calculate pixel-centered bounds
    const dataLatMin = Math.min(lat[0], lat[lat.length - 1]);
    const dataLatMax = Math.max(lat[0], lat[lat.length - 1]);
    const dataLonMin = Math.min(lon[0], lon[lon.length - 1]);
    const dataLonMax = Math.max(lon[0], lon[lon.length - 1]);
    
    const latStep = (dataLatMax - dataLatMin) / (lat.length - 1);
    const lonStep = (dataLonMax - dataLonMin) / (lon.length - 1);
    
    const overlayBounds = {
      minLat: dataLatMin - latStep / 2,
      maxLat: dataLatMax + latStep / 2,
      minLon: dataLonMin - lonStep / 2,
      maxLon: dataLonMax + lonStep / 2
    };

    // Create Leaflet image overlay
    const bounds = L.latLngBounds(
      [overlayBounds.minLat, overlayBounds.minLon],
      [overlayBounds.maxLat, overlayBounds.maxLon]
    );

    const imageUrl = canvas.toDataURL('image/png');
    const imageOverlay = L.imageOverlay(imageUrl, bounds, {
      opacity: 1, // Opacity is already applied in WebGL
      interactive: false
    });

    imageOverlay.addTo(map);
    layerRef.current = imageOverlay;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, data, opacity]);

  return null;
}
