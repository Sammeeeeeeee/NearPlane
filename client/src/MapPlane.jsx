import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => { if (center) map.setView(center, map.getZoom(), { animate: true }); }, [center]);
  return null;
}

function createPlaneIcon(angle = 0) {
  // rotate via style on the wrapper element; Leaflet will render the HTML as-is
  const svg = `
    <div style="transform: rotate(${angle}deg); display:flex; align-items:center; justify-content:center;">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">
        <path d="M21 16v-2l-8-5V3.5a.5.5 0 0 0-.5-.5H11a.5.5 0 0 0-.5.5V9L2 14v2l9-1.5V20l-2 1v1l3-.5 3 .5v-1l-2-1v-5.5L21 16z" fill="#ffdd57" stroke="#000" stroke-width="0.3"/>
      </svg>
    </div>
  `;
  return L.divIcon({ html: svg, className: '', iconSize: [48,48], iconAnchor: [24,24] });
}

export default function MapPlane({ userPos, aircraft }) {
  const center = userPos ? [userPos.lat, userPos.lon] : [51.623842, -0.269584];

  return (
    <MapContainer center={center} zoom={11} style={{ height: '100%', borderRadius: 8 }}>
      <TileLayer attribution='© OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Recenter center={center} />

      {userPos && (
        <>
          <Marker position={[userPos.lat, userPos.lon]}>
            <Popup>Your location</Popup>
          </Marker>
          <Circle center={[userPos.lat, userPos.lon]} radius={500} />
        </>
      )}

      {aircraft && aircraft.lat && aircraft.lon && (
        <Marker position={[aircraft.lat, aircraft.lon]} icon={createPlaneIcon(aircraft.track || 0)}>
          <Popup>
            {aircraft.flight || aircraft.reg || aircraft.hex}<br />
            {aircraft.type} • {aircraft.alt_baro ? Math.round(aircraft.alt_baro) + ' ft' : ''}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
