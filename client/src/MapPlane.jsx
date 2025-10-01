import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, map.getZoom(), { animate: true }); }, [center]);
  return null;
}

function MapInvalidate({ center }) {
  const map = useMap();
  useEffect(() => {
    const doInvalidate = () => setTimeout(() => { try { map.invalidateSize(); } catch(e){} }, 300);
    doInvalidate();
    window.addEventListener('resize', doInvalidate);
    return () => window.removeEventListener('resize', doInvalidate);
  }, [map]);

  useEffect(() => {
    const t = setTimeout(() => { try { map.invalidateSize(); } catch(e){} }, 350);
    return () => clearTimeout(t);
  }, [center, map]);

  return null;
}

// Helper function to format aircraft info for popup
function formatAircraftInfo(aircraft, userPos) {
  const parts = [];
  
  // Callsign/Registration
  const identifier = aircraft.flight || aircraft.callsign || aircraft.reg || aircraft.hex || 'Unknown';
  parts.push('<div style="font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #0b1220;">' + identifier + '</div>');
  
  // Aircraft type
  if (aircraft.aircraft_name || aircraft.type) {
    parts.push('<div style="margin-bottom: 6px;"><strong>Type:</strong> ' + (aircraft.aircraft_name || aircraft.type) + '</div>');
  }
  
  // Registration
  if (aircraft.reg) {
    parts.push('<div style="margin-bottom: 6px;"><strong>Registration:</strong> ' + aircraft.reg + '</div>');
  }
  
  // Airline
  if (aircraft.airline) {
    parts.push('<div style="margin-bottom: 6px;"><strong>Airline:</strong> ' + aircraft.airline + '</div>');
  }
  
  // Route
  if (aircraft.from || aircraft.from_obj) {
    const fromText = aircraft.from_obj 
      ? (aircraft.from_obj.city || '') + ' (' + (aircraft.from_obj.iata || aircraft.from_obj.name || '') + ')'
      : aircraft.from;
    const toText = aircraft.to_obj 
      ? (aircraft.to_obj.city || '') + ' (' + (aircraft.to_obj.iata || aircraft.to_obj.name || '') + ')'
      : aircraft.to;
    parts.push('<div style="margin-bottom: 6px;"><strong>Route:</strong> ' + (fromText || '—') + ' → ' + (toText || '—') + '</div>');
  }
  
  // Speed
  if (aircraft.gs !== undefined && aircraft.gs !== null) {
    const mph = Math.round(aircraft.gs * 1.15078);
    parts.push('<div style="margin-bottom: 6px;"><strong>Speed:</strong> ' + mph + ' mph</div>');
  }
  
  // Altitude
  if (aircraft.alt_baro !== undefined && aircraft.alt_baro !== null) {
    parts.push('<div style="margin-bottom: 6px;"><strong>Altitude:</strong> ' + Math.round(aircraft.alt_baro) + ' ft</div>');
  }
  
  // Track/Heading
  if (aircraft.track !== undefined && aircraft.track !== null) {
    parts.push('<div style="margin-bottom: 6px;"><strong>Heading:</strong> ' + Math.round(aircraft.track) + '°</div>');
  }
  
  // Distance from user
  if (userPos && aircraft.lat && aircraft.lon) {
    const R = 6371;
    const toRad = v => v * Math.PI / 180;
    const dLat = toRad(aircraft.lat - userPos.lat);
    const dLon = toRad(aircraft.lon - userPos.lon);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(userPos.lat))*Math.cos(toRad(aircraft.lat))*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const dist = R * c;
    parts.push('<div style="margin-bottom: 6px;"><strong>Distance:</strong> ' + dist.toFixed(2) + ' km</div>');
  }
  
  // Emergency status
  if (aircraft.emergency && aircraft.emergency !== 'none') {
    parts.push('<div style="margin-top: 8px; padding: 6px; background: #ff3b30; color: white; border-radius: 4px; font-weight: 700;">⚠️ EMERGENCY: ' + aircraft.emergency + '</div>');
  }
  
  return '<div style="font-size: 13px; line-height: 1.5; color: #5b6771; min-width: 200px;">' + parts.join('') + '</div>';
}

// Default plane icon (used as fallback)
function createPlaneDivIcon(angle = 0, size = 44, color = '#a357ff', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
        <path d="M21 16v-2l-8-5V3.5a.5.5 0 0 0-.5-.5H11a.5.5 0 0 0-.5.5V9L2 14v2l9-1.5V20l-2 1v1l3-.5 3 .5v-1l-2-1v-5.5L21 16z" fill="${color}" stroke="#000" stroke-width="0.2"/>
      </svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// Aircraft Category A - Airplanes
// A0: No ADS-B emitter category information
function createIconA0(angle = 0, size = 44, color = '#808080', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" fill="${color}" stroke="#000" stroke-width="0.5"/>
      <text x="12" y="16" text-anchor="middle" font-size="10" fill="#fff">?</text>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A1: Light aircraft (< 15500 lbs) - replaced with supplied SVG
function createIconA1(angle = 0, size = 44, color = '#87CEEB', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" height="${size}" width="${size}" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 182.74 182.74" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M170.006,58.37h-55.649l0.013-29.764c0-8.608-4.652-13.881-13.813-15.778C99.107,5.612,96.164,0,91.541,0 c-4.653,0-7.605,5.686-9.045,12.971c-8.71,2.014-13.126,7.242-13.126,15.635V58.37H12.734c-4.061,0-7.364,3.469-7.364,7.733v13.883 c0,3.872,2.931,7.64,6.679,8.58l18.663,4.637c2.909,0.73,7.602,1.167,10.458,1.167h30.395c0.849,8.911,1.623,18.373,1.623,23.288 c0,4.185,1.318,9.516,1.374,9.74l6.189,20.412l-19.643,5.618c-2.657,0.735-4.738,3.463-4.738,6.21v5.63 c0,2.909,2.376,5.103,5.527,5.103H84.32c1.649,8.539,3.884,12.37,7.221,12.37c3.337,0,5.572-3.831,7.221-12.37h22.686 c2.911,0,5.923-1.909,5.923-5.103v-5.63c0-2.722-2.211-5.553-4.924-6.311l-20.206-5.682l6.516-22.229 c0.299-0.755,1.432-3.905,1.432-8.232c0-4.811,0.835-14.062,1.756-22.814h29.087c2.801,0,7.403-0.4,10.405-1.139l19.245-4.622 c3.751-0.924,6.689-4.711,6.689-8.623V66.103C177.37,61.839,174.066,58.37,170.006,58.37z"></path> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A2: Small aircraft (15500 to 75000 lbs) - replaced with supplied SVG
function createIconA2(angle = 0, size = 44, color = '#4169E1', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 30 30" version="1.1" id="svg822" inkscape:version="0.92.4 (f8dce91, 2019-08-02)" sodipodi:docname="airplane.svg" fill="${color}" transform="rotate(270)"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <defs id="defs816"></defs> <sodipodi:namedview id="base" pagecolor="#ffffff" bordercolor="#666666" borderopacity="1.0" inkscape:pageopacity="0.0" inkscape:pageshadow="2" inkscape:zoom="17.833333" inkscape:cx="15" inkscape:cy="15" inkscape:document-units="px" inkscape:current-layer="layer1" showgrid="true" units="px" inkscape:window-width="1366" inkscape:window-height="713" inkscape:window-x="0" inkscape:window-y="0" inkscape:window-maximized="1" inkscape:lockguides="true" inkscape:snap-global="true"> <inkscape:grid type="xygrid" id="grid816"></inkscape:grid> </sodipodi:namedview> <metadata id="metadata819"> <rdf:RDF> <cc:Work rdf:about=""> <dc:format>image/svg+xml</dc:format> <dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"></dc:type> <dc:title> </dc:title> </cc:Work> </rdf:RDF> </metadata> <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1" transform="translate(0,-289.0625)"> <path style="opacity:1;fill:${color};fill-opacity:1;stroke:none;stroke-width:0.5;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1" d="m 9.152311,294.0625 3.964824,7.99842 c -1.515168,0.007 -3.662727,0.51835 -5.4609114,1.02444 L 5.2226469,300.10269 C 4.9696321,299.79256 4.8821528,299.63186 4.5839798,299.63184 H 3.5390647 3.0000015 l 2.15233,4.34398 L 3,308.31979 l 0.5390634,-1e-5 h 1.0449149 c 0.2981875,0 0.3856426,-0.16269 0.6386645,-0.4728 l 2.2988191,-2.81719 c 1.8170981,0.51651 4.0300351,1.0515 5.5819981,1.06187 l -3.95115,7.97084 0.999996,-10e-6 1.943348,10e-6 c 0.553998,-10e-6 0.717401,-0.29856 1.187496,-0.87471 l 5.796842,-7.10599 c 4.118952,-0.062 7.373003,-0.92843 7.373008,-2.00551 -2e-6,-1.07501 -3.241889,-1.9405 -7.349574,-2.00551 l -5.820278,-7.13357 c -0.470082,-0.57616 -0.633494,-0.87471 -1.187492,-0.87471 h -1.943348 z" id="rect818" inkscape:connector-curvature="0"></path> </g> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A3: Large aircraft (75000 to 300000 lbs) - replaced with supplied SVG
function createIconA3(angle = 0, size = 44, color = '#FF8C00', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" height="${size}" width="${size}" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-61.2 -61.2 734.40 734.40" xml:space="preserve" stroke="#000000" stroke-width="0.00612001" transform="rotate(-45)"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round" stroke="#CCCCCC" stroke-width="18.36003"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M600.038,471.82l-48.626-80.895l27.111-27.111c5.978-5.978,5.978-15.669,0-21.644l-39.679-39.679 c-2.871-2.871-6.762-4.481-10.82-4.481s-7.952,1.613-10.82,4.481l-11.834,11.834l-43.08-71.666l97.421-87.277 c0.208-0.187,0.413-0.38,0.612-0.575c25.822-25.828,44.298-85.446,13.288-116.454c-10.542-10.542-25.602-16.116-43.548-16.116 c-26.015,0-55.311,11.818-72.9,29.407c-0.199,0.199-0.392,0.401-0.575,0.609l-87.283,97.421l-68.354-41.09l11.172-11.172 c2.871-2.871,4.484-6.762,4.484-10.824c0-4.059-1.61-7.952-4.484-10.824L272.44,36.088c-5.972-5.975-15.669-5.975-21.641,0 l-26.45,26.453l-84.21-50.619c-12.933-7.772-27.741-11.88-42.826-11.88c-15.831,0-31.261,4.49-44.616,12.988L36.686,23.216 c-3.915,2.492-6.492,6.627-6.997,11.243c-0.508,4.613,1.105,9.21,4.392,12.495l225.356,225.359L145.254,399.765l-71.195-1.368 l-1.371-0.012c-19.094,0-37.047,7.435-50.552,20.94L4.484,436.977c-3.872,3.869-5.378,9.507-3.961,14.79 c1.42,5.286,5.549,9.409,10.836,10.82l82.759,22.082l5.767,5.764l-20.971,20.971c-5.978,5.978-5.978,15.669,0,21.644 c2.987,2.987,6.906,4.481,10.82,4.481c3.915,0,7.836-1.494,10.82-4.481l20.974-20.974l5.767,5.767l22.085,82.759 c1.411,5.286,5.537,9.419,10.817,10.836c1.313,0.352,2.645,0.523,3.97,0.523c4.007,0,7.916-1.576,10.82-4.481l17.656-17.652 c13.667-13.67,21.295-32.596,20.925-51.923l-1.368-71.191l127.455-114.186l225.356,225.359c2.883,2.883,6.786,4.481,10.82,4.481 c0.554,0,1.111-0.031,1.671-0.092c4.616-0.508,8.748-3.082,11.243-7l10.187-16.012C615.952,532.509,616.377,499.001,600.038,471.82 z M528.023,334.959l18.035,18.035l-10.897,10.897l-13.542-22.529L528.023,334.959z M261.619,68.552l18.038,18.038l-5.742,5.742 l-22.529-13.542L261.619,68.552z"></path> </g> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A4: High vortex large (B-757)
function createIconA4(angle = 0, size = 44, color = '#FF4500', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <path d="M12 2l-2 6L2 12v2.5l8-1.5v5l-2.5 2v2l4.5-1 4.5 1v-2l-2.5-2v-5l8 1.5V12l-8-4L12 2z" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <path d="M4 14.5a1 1 0 0 1 0 2M20 14.5a1 1 0 0 1 0 2" fill="none" stroke="#000" stroke-width="0.5" stroke-dasharray="0.5,0.5"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A5: Heavy aircraft (> 300000 lbs) - replaced with supplied SVG
function createIconA5(angle = 0, size = 44, color = '#8B0000', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" viewBox="0 -3.43 122.88 122.88" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="enable-background:new 0 0 122.88 116.02" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <style type="text/css">.st0{fill-rule:evenodd;clip-rule:evenodd;}</style> <g> <path class="st0" d="M38.14,115.91c0-10.58,5.81-15.56,13.46-21.3l0-27.68L1.37,89.25c0-19.32-6.57-17.9,9.05-27.72l0.15-0.09 V49.37h11.22v5.08l8.24-5.13V35.8h11.22v6.54l10.36-6.45V7.3c0-4.02,4.37-7.3,9.7-7.3l0,0c5.34,0,9.7,3.29,9.7,7.3v28.58 l10.47,6.52V35.8l11.22,0v13.59l8.24,5.13v-5.15l11.21,0v12.14c15.56,9.67,9.61,7.78,9.61,27.74L71.01,66.91v27.58 c8.14,5.43,13.46,9.6,13.46,21.43l-12.81,0.11c-2.93-2.3-4.96-4.05-6.52-5.26c-1.18,0.39-2.48,0.6-3.83,0.6h0 c-1.53,0-2.99-0.27-4.28-0.76c-1.68,1.22-3.9,3.04-7.21,5.42L38.14,115.91L38.14,115.91L38.14,115.91z"></path> </g> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A6: High performance (> 5g acceleration and 400 kts) - replaced with supplied SVG
function createIconA6(angle = 0, size = 44, color = '#FF1493', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" height="${size}" width="${size}" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 179.593 179.593" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M149.105,110.429l-35.941-25.375c-2.529-15.716-5.967-31.306-7.883-39.571c-2.689-11.604-5.544-22.574-8.036-30.888 C93.066,0.649,91.817,0,89.796,0c-2.009,0-3.453,0.705-7.657,14.587c-2.482,8.195-5.332,19.169-8.023,30.9 c-3.261,14.215-5.897,27.758-7.753,39.612L30.49,110.428c-1.561,1.1-2.693,3.286-2.693,5.196v22.149c0,2.325,1.686,4.079,3.92,4.079 c0.345,0,0.694-0.043,1.04-0.128l30.04-7.368v6.37c-0.243,0.207-0.464,0.435-0.647,0.684l-11.755,15.892 c-0.723,0.977-1.089,2.441-0.911,3.646l2.296,15.524c0.265,1.779,1.821,3.121,3.619,3.121h7.447c1.692,0,3.267-1.241,3.661-2.875 l2.243-9.125h0.188l2.242,9.234c0.39,1.628,1.896,2.766,3.665,2.766h8c1.692,0,3.267-1.241,3.661-2.875l2.243-9.125h0.188 l2.242,9.234c0.39,1.628,1.896,2.766,3.665,2.766h9c1.692,0,3.267-1.241,3.661-2.875l2.243-9.125h0.188l2.242,9.234L147,179.593h7.447 c1.801,0,3.356-1.344,3.618-3.124l2.298-15.523c0.177-1.201-0.189-2.664-0.912-3.645 l-11.755-15.891c-0.209-0.282-0.462-0.539-0.745-0.767v-6.533l31.039,7.613c0.347,0.085,0.696,0.128,1.041,0.128 c2.234,0,3.92-1.753,3.92-4.079v-22.149C151.796,113.714,150.664,111.528,149.105,110.429z M90.061,89.476 c-2.106,0-9.507-12.108-9.507-27.045c0-14.937,6.807-27.045,9.507-27.045c2.363,0,9.507,12.108,9.507,27.045 C99.568,77.368,91.994,89.476,90.061,89.476z"></path> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// A7: Rotorcraft - replaced with supplied SVG
function createIconA7(angle = 0, size = 44, color = '#32CD32', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 478.874 478.873" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <g> <path d="M463.096,252.605l-133.38-52.861V78.503V47.101c0-4.338-3.519-7.851-7.851-7.851s-7.851,3.513-7.851,7.851v31.402h-11.569 C293.433,32.987,266.884,0,235.512,0c-31.37,0-57.919,32.987-66.938,78.503h-19.416V47.101c0-4.338-3.519-7.851-7.851-7.851 s-7.85,3.513-7.85,7.851v31.402v43.46l-109-43.2c-6.987-2.771-14.597-0.112-16.99,5.933c-2.395,6.045,1.327,13.187,8.312,15.961 l117.678,46.639v80.363v23.551c0,4.341,3.518,7.851,7.85,7.851s7.851-3.51,7.851-7.851V227.66h48.1 c7.64,25.239,14.703,58.196,14.703,94.207v78.502h7.851v39.528c0,8.079,7.027,14.644,15.701,14.644 c8.674,0,15.699-6.564,15.699-14.644v-39.528h7.851v-78.502c0-35.618,6.984-68.655,14.606-94.207h40.347v23.551 c0,4.341,3.519,7.851,7.851,7.851s7.851-3.51,7.851-7.851V227.66v-2.583l124.703,49.425c6.981,2.773,14.596,0.121,16.987-5.935 C473.799,262.512,470.081,255.383,463.096,252.605z M314.015,94.204v99.322l-24.132-9.567 c9.91-19.424,15.877-44.248,15.877-71.307c0-6.297-0.409-12.435-1.03-18.448H314.015z M149.158,94.204h17.132 c-0.621,6.014-1.023,12.151-1.023,18.448c0,7.694,0.486,15.207,1.406,22.468l-17.515-6.939V94.204z M149.158,211.958v-58.436 l23.536,9.327c1.775,5.688,3.829,11.093,6.155,16.186l-0.433-0.148c0,0,6.476,12.457,13.74,33.071H149.158z M278.714,211.958 c0.749-2.18,1.479-4.208,2.22-6.215l15.682,6.215H278.714z"></path> <path d="M266.913,408.219c-4.328,0-7.851,3.518-7.851,7.85v54.954c0,4.332,3.522,7.851,7.851,7.851c4.332,0,7.85-3.519,7.85-7.851 v-54.954C274.762,411.736,271.245,408.219,266.913,408.219z"></path> </g> </g> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}


// Category B - Special Aircraft
// B0: No ADS-B emitter category information
function createIconB0(angle = 0, size = 44, color = '#808080', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" fill="${color}" stroke="#000" stroke-width="0.5"/>
      <text x="12" y="15" text-anchor="middle" font-size="10" fill="#fff">?</text>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B1: Glider / sailplane
function createIconB1(angle = 0, size = 44, color = '#F0E68C', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <path d="M12 4l-0.5 8-9 2v1l9-0.5v3l-1.5 1v1l2.5-0.3 2.5 0.3v-1l-1.5-1v-3l9 0.5v-1l-9-2L12 4z" fill="${color}" stroke="#000" stroke-width="0.3"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B2: Lighter-than-air (airship or balloon) - replaced with supplied SVG
function createIconB2(angle = 0, size = 44, color = '#FFB6C1', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg viewBox="-3 0 20 20" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" fill="${color}"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <title>hot_air_balloon [#597]</title> <desc>Created with Sketch.</desc> <defs> </defs> <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"> <g id="Dribbble-Light-Preview" transform="translate(-103.000000, -5559.000000)" fill="${color}"> <g id="icons" transform="translate(56.000000, 160.000000)"> <path d="M52,5419 L56,5419 L56,5417 L52,5417 L52,5419 Z M61,5404.84 C61,5410.583 56,5410 55.853,5415 L51.853,5415 C51.706,5410 47,5410.579 47,5404.836 C47,5400.548 50.539,5399 53.853,5399 C57.167,5399 61,5400.551 61,5404.84 L61,5404.84 Z" id="hot_air_balloon-[#597]"> </path> </g> </g> </g> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B3: Parachutist / skydiver
function createIconB3(angle = 0, size = 44, color = '#00CED1', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <path d="M12 3a6 6 0 0 0 0 12a6 6 0 0 0 0-12" fill="none" stroke="${color}" stroke-width="2"/>
      <circle cx="12" cy="18" r="1.5" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <line x1="12" y1="15" x2="12" y2="16.5" stroke="${color}" stroke-width="0.8"/>
      <line x1="6" y1="9" x2="12" y2="15" stroke="${color}" stroke-width="0.5"/>
      <line x1="18" y1="9" x2="12" y2="15" stroke="${color}" stroke-width="0.5"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B4: Ultralight / hang-glider / paraglider
function createIconB4(angle = 0, size = 44, color = '#ADFF2F', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <path d="M12 6L3 10v1l9 1 9-1v-1L12 6z" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <circle cx="12" cy="16" r="1" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <line x1="12" y1="12" x2="12" y2="15" stroke="#000" stroke-width="0.3"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B5: Reserved
function createIconB5(angle = 0, size = 44, color = '#696969', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect x="7" y="7" width="10" height="10" fill="${color}" stroke="#000" stroke-width="0.5" stroke-dasharray="2,1"/>
      <text x="12" y="15" text-anchor="middle" font-size="8" fill="#fff">R</text>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B6: Unmanned aerial vehicle
function createIconB6(angle = 0, size = 44, color = '#9370DB', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect x="10" y="10" width="4" height="4" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <circle cx="7" cy="7" r="2" fill="none" stroke="${color}" stroke-width="1.5"/>
      <circle cx="17" cy="7" r="2" fill="none" stroke="${color}" stroke-width="1.5"/>
      <circle cx="7" cy="17" r="2" fill="none" stroke="${color}" stroke-width="1.5"/>
      <circle cx="17" cy="17" r="2" fill="none" stroke="${color}" stroke-width="1.5"/>
      <line x1="10" y1="10" x2="8" y2="8" stroke="${color}" stroke-width="0.5"/>
      <line x1="14" y1="10" x2="16" y2="8" stroke="${color}" stroke-width="0.5"/>
      <line x1="10" y1="14" x2="8" y2="16" stroke="${color}" stroke-width="0.5"/>
      <line x1="14" y1="14" x2="16" y2="16" stroke="${color}" stroke-width="0.5"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// B7: Space / trans-atmospheric vehicle - replaced with supplied SVG
function createIconB7(angle = 0, size = 44, color = '#000080', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" viewBox="-5.5 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="m0 24h3.15c-.176-.634-.552-1.906-1.13-4.9l-2.019 4.9z"></path><path d="m10.62 19.1c-.578 2.994-.954 4.266-1.13 4.9h3.15l-2.018-4.9z"></path><path d="m6.317 12.662c-1.268 0-2.297-1.028-2.297-2.297 0-1.268 1.028-2.297 2.297-2.297 1.268 0 2.297 1.028 2.298 2.297 0 1.269-1.029 2.297-2.298 2.297zm4.525-2.976c-.248-7.249-4.525-9.686-4.525-9.686s-4.278 2.436-4.525 9.686c-.23 6.72 2.268 14.314 2.268 14.314h4.514s2.498-7.594 2.268-14.314z"></path></g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}


// Category C - Ground/Obstacles
// C0: No ADS-B emitter category information
function createIconC0(angle = 0, size = 44, color = '#808080', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <polygon points="12,4 4,20 20,20" fill="${color}" stroke="#000" stroke-width="0.5"/>
      <text x="12" y="17" text-anchor="middle" font-size="10" fill="#fff">?</text>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C1: Surface vehicle – emergency vehicle - replaced with supplied SVG
function createIconC1(angle = 0, size = 44, color = '#FF0000', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg version="1.1" id="Uploaded to svgrepo.com" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32" xml:space="preserve" fill="${color}"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <style type="text/css"> .puchipuchi_een{fill:#111918;} </style> <path class="puchipuchi_een" d="M30.211,23.98L17.798,3.034c-0.81-1.366-2.787-1.366-3.596,0L1.789,23.98 C0.999,25.314,1.96,27,3.51,27h24.98C30.04,27,31.001,25.314,30.211,23.98z M16,24c-1.105,0-2-0.895-2-2c0-1.105,0.895-2,2-2 s2,0.895,2,2C18,23.105,17.105,24,16,24z M18,13.377c0,1.075-0.173,2.143-0.513,3.162l-0.171,0.512C17.127,17.618,16.597,18,16,18 s-1.127-0.382-1.316-0.949l-0.171-0.512C14.173,15.52,14,14.452,14,13.377v-2.99C14,9.621,14.621,9,15.387,9h1.225 C17.379,9,18,9.621,18,10.387V13.377z"></path> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C2: Surface vehicle – service vehicle - replaced with supplied SVG
function createIconC2(angle = 0, size = 44, color = '#FFA500', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg fill="${color}" height="${size}" width="${size}" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 47.032 47.032" xml:space="preserve"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M29.395,0H17.636c-3.117,0-5.643,3.467-5.643,6.584v34.804c0,3.116,2.526,5.644,5.643,5.644h11.759 c3.116,0,5.644-2.527,5.644-5.644V6.584C35.037,3.467,32.511,0,29.395,0z M34.05,14.188v11.665l-2.729,0.351v-4.806L34.05,14.188z M32.618,10.773c-1.016,3.9-2.219,8.51-2.219,8.51H16.631l-2.222-8.51C14.41,10.773,23.293,7.755,32.618,10.773z M15.741,21.713 v4.492l-2.73-0.349V14.502L15.741,21.713z M13.011,37.938V27.579l2.73,0.343v8.196L13.011,37.938z M14.568,40.882l2.218-3.336 h13.771l2.219,3.336H14.568z M31.321,35.805v-7.872l2.729-0.355v10.048L31.321,35.805z"></path> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> <g> </g> </g> </g></svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C3: Point obstacle (includes tethered balloons)
function createIconC3(angle = 0, size = 44, color = '#DC143C', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect x="10" y="6" width="4" height="14" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <circle cx="12" cy="6" r="3" fill="#FF0000" stroke="#000" stroke-width="0.3"/>
      <circle cx="12" cy="6" r="1" fill="#FFF"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C4: Cluster obstacle
function createIconC4(angle = 0, size = 44, color = '#8B0000', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect x="6" y="10" width="3" height="10" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <rect x="10.5" y="8" width="3" height="12" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <rect x="15" y="11" width="3" height="9" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <circle cx="7.5" cy="10" r="1.5" fill="#FF0000" stroke="#000" stroke-width="0.2"/>
      <circle cx="12" cy="8" r="1.5" fill="#FF0000" stroke="#000" stroke-width="0.2"/>
      <circle cx="16.5" cy="11" r="1.5" fill="#FF0000" stroke="#000" stroke-width="0.2"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C5: Line obstacle
function createIconC5(angle = 0, size = 44, color = '#8B4513', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <rect x="4" y="10" width="2" height="10" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <rect x="18" y="10" width="2" height="10" fill="${color}" stroke="#000" stroke-width="0.3"/>
      <line x1="6" y1="12" x2="18" y2="12" stroke="${color}" stroke-width="2"/>
      <circle cx="5" cy="10" r="1.5" fill="#FF0000" stroke="#000" stroke-width="0.2"/>
      <circle cx="19" cy="10" r="1.5" fill="#FF0000" stroke="#000" stroke-width="0.2"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C6: Reserved
function createIconC6(angle = 0, size = 44, color = '#696969', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <polygon points="12,5 7,19 17,19" fill="${color}" stroke="#000" stroke-width="0.5" stroke-dasharray="2,1"/>
      <text x="12" y="16" text-anchor="middle" font-size="8" fill="#fff">R</text>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// C7: Reserved
function createIconC7(angle = 0, size = 44, color = '#696969', opacity = 1) {
  const svg = `<div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <polygon points="12,5 7,19 17,19" fill="${color}" stroke="#000" stroke-width="0.5" stroke-dasharray="2,1"/>
      <text x="12" y="16" text-anchor="middle" font-size="8" fill="#fff">R</text>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

// Helper function to get the appropriate icon based on category
function getAircraftIcon(category, angle = 0, isNearest = false) {
  const size = isNearest ? 48 : 28;
  const opacity = isNearest ? 1 : 0.7;
  
  // Muted colors for non-nearest aircraft
  const mutedColors = {
    'A0': '#808080',
    'A1': '#a0c4d6',
    'A2': '#7a94d1',
    'A3': '#d6a866',
    'A4': '#d68866',
    'A5': '#a66666',
    'A6': '#d699b9',
    'A7': '#6eb96e',
    'B0': '#808080',
    'B1': '#d6d0a0',
    'B2': '#d6b9c9',
    'B3': '#66b9bc',
    'B4': '#b9d666',
    'B5': '#696969',
    'B6': '#a699d6',
    'B7': '#4d4d80',
    'C0': '#808080',
    'C1': '#d66666',
    'C2': '#d6a666',
    'C3': '#b66679',
    'C4': '#804040',
    'C5': '#80604d',
    'C6': '#696969',
    'C7': '#696969'
  };
  
  // Default bright colors for nearest aircraft
  const brightColors = {
    'A0': '#a357ff',
    'A1': '#a357ff',
    'A2': '#a357ff',
    'A3': '#a357ff',
    'A4': '#a357ff',
    'A5': '#a357ff',
    'A6': '#a357ff',
    'A7': '#a357ff',
    'B0': '#a357ff',
    'B1': '#a357ff',
    'B2': '#a357ff',
    'B3': '#a357ff',
    'B4': '#a357ff',
    'B5': '#a357ff',
    'B6': '#a357ff',
    'B7': '#a357ff',
    'C0': '#a357ff',
    'C1': '#a357ff',
    'C2': '#a357ff',
    'C3': '#a357ff',
    'C4': '#a357ff',
    'C5': '#a357ff',
    'C6': '#a357ff',
    'C7': '#a357ff'
  };
  
  const colorMap = isNearest ? brightColors : mutedColors;
  const color = colorMap[category] || (isNearest ? '#a357ff' : '#9aa');
  
  switch(category) {
    case 'A0': return createIconA0(angle, size, color, opacity);
    case 'A1': return createIconA1(angle, size, color, opacity);
    case 'A2': return createIconA2(angle, size, color, opacity);
    case 'A3': return createIconA3(angle, size, color, opacity);
    case 'A4': return createIconA4(angle, size, color, opacity);
    case 'A5': return createIconA5(angle, size, color, opacity);
    case 'A6': return createIconA6(angle, size, color, opacity);
    case 'A7': return createIconA7(angle, size, color, opacity);
    case 'B0': return createIconB0(angle, size, color, opacity);
    case 'B1': return createIconB1(angle, size, color, opacity);
    case 'B2': return createIconB2(angle, size, color, opacity);
    case 'B3': return createIconB3(angle, size, color, opacity);
    case 'B4': return createIconB4(angle, size, color, opacity);
    case 'B5': return createIconB5(angle, size, color, opacity);
    case 'B6': return createIconB6(angle, size, color, opacity);
    case 'B7': return createIconB7(angle, size, color, opacity);
    case 'C0': return createIconC0(angle, size, color, opacity);
    case 'C1': return createIconC1(angle, size, color, opacity);
    case 'C2': return createIconC2(angle, size, color, opacity);
    case 'C3': return createIconC3(angle, size, color, opacity);
    case 'C4': return createIconC4(angle, size, color, opacity);
    case 'C5': return createIconC5(angle, size, color, opacity);
    case 'C6': return createIconC6(angle, size, color, opacity);
    case 'C7': return createIconC7(angle, size, color, opacity);
    default:
      // Fallback to default plane icon
      return createPlaneDivIcon(angle, size, color, opacity);
  }
}

export default function MapPlane({ userPos, aircraft, others = [] }) {
  const center = userPos ? [userPos.lat, userPos.lon] : [51.623842, -0.269584];

  return (
    <MapContainer center={center} zoom={11} style={{ height: '100%', borderRadius: 8 }}>
      <TileLayer attribution='© OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Recenter center={center} />
      <MapInvalidate center={center} />

      {userPos && (
        <>
          <CircleMarker center={[userPos.lat, userPos.lon]} radius={7} pathOptions={{ color: '#1e90ff', fillColor: '#1e90ff', fillOpacity: 0.9, weight: 0 }} />
          <Circle center={[userPos.lat, userPos.lon]} radius={500} pathOptions={{ color: '#1e90ff', opacity: 0.12, weight: 1 }} />
        </>
      )}

      {Array.isArray(others) && others.map((o, i) => (
        o && o.lat && o.lon ? (
          <Marker
            key={o.hex || `${o.lat}-${o.lon}-${i}`}
            position={[o.lat, o.lon]}
            icon={getAircraftIcon(o.category, o.track || 0, false)}
            zIndexOffset={0}
          >
            <Popup>
              <div dangerouslySetInnerHTML={{ __html: formatAircraftInfo(o, userPos) }} />
            </Popup>
          </Marker>
        ) : null
      ))}

      {aircraft && aircraft.lat && aircraft.lon && (
        <Marker
          position={[aircraft.lat, aircraft.lon]}
          icon={getAircraftIcon(aircraft.category, aircraft.track || 0, true)}
          zIndexOffset={1000}
        >
          <Popup>
            <div dangerouslySetInnerHTML={{ __html: formatAircraftInfo(aircraft, userPos) }} />
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}