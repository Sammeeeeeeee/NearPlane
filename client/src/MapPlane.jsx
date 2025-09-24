import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, map.getZoom(), { animate: true }); }, [center]);
  return null;
}

function MapInvalidate() {
  const map = useMap();
  useEffect(() => {
    const doInvalidate = () => setTimeout(() => { try { map.invalidateSize(); } catch(e){} }, 120);
    doInvalidate();
    window.addEventListener('resize', doInvalidate);
    return () => window.removeEventListener('resize', doInvalidate);
  }, [map]);
  return null;
}

function createPlaneDivIcon(angle = 0, size = 44, color = '#ffdd57', opacity = 1) {
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center; opacity:${opacity};">
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
        <path d="M21 16v-2l-8-5V3.5a.5.5 0 0 0-.5-.5H11a.5.5 0 0 0-.5.5V9L2 14v2l9-1.5V20l-2 1v1l3-.5 3 .5v-1l-2-1v-5.5L21 16z" fill="${color}" stroke="#000" stroke-width="0.2"/>
      </svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [size, size], iconAnchor: [size/2, size/2] });
}

export default function MapPlane({ userPos, aircraft, others = [] }) {
  const center = userPos ? [userPos.lat, userPos.lon] : [51.623842, -0.269584];

  return (
    <MapContainer center={center} zoom={11} style={{ height: '100%', borderRadius: 8 }}>
      <TileLayer attribution='© OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Recenter center={center} />
      <MapInvalidate />

      {userPos && (
        <>
          {/* Blue circle marker for user location (small dot) */}
          <CircleMarker center={[userPos.lat, userPos.lon]} radius={7} pathOptions={{ color: '#1e90ff', fillColor: '#1e90ff', fillOpacity: 0.9, weight: 0 }} />
          {/* faint ring around user */}
          <Circle center={[userPos.lat, userPos.lon]} radius={500} pathOptions={{ color: '#1e90ff', opacity: 0.12, weight: 1 }} />
        </>
      )}

      {/* others: small, visible, non-interactive */}
      {Array.isArray(others) && others.map((o, i) => (
        o && o.lat && o.lon ? (
          <Marker
            key={o.hex || `${o.lat}-${o.lon}-${i}`}
            position={[o.lat, o.lon]}
            icon={createPlaneDivIcon(o.track || 0, 28, '#9aa', 0.9)}
            interactive={false}
            zIndexOffset={0}
          />
        ) : null
      ))}

      {/* nearest: larger, full-opacity */}
      {aircraft && aircraft.lat && aircraft.lon && (
        <Marker
          position={[aircraft.lat, aircraft.lon]}
          icon={createPlaneDivIcon(aircraft.track || 0, 48, '#ffdd57', 1)}
          interactive={false}
          zIndexOffset={1000}
        />
      )}
    </MapContainer>
  );
}
