import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';

const defaultIcon = new L.Icon.Default();

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, map.getZoom(), { animate: true });
  }, [center]);
  return null;
}

export default function MapPlane({ userPos, aircraft }) {
  const center = userPos ? [userPos.lat, userPos.lon] : [51.623842, -0.269584];

  return (
    <MapContainer center={center} zoom={11} style={{ height: '100%', borderRadius: 8 }}>
      <TileLayer
        attribution='© OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recenter center={center} />

      {userPos && (
        <>
          <Marker position={[userPos.lat, userPos.lon]} icon={defaultIcon}>
            <Popup>Your location</Popup>
          </Marker>
          <Circle center={[userPos.lat, userPos.lon]} radius={500} />
        </>
      )}

      {aircraft && aircraft.lat && aircraft.lon && (
        <Marker position={[aircraft.lat, aircraft.lon]} icon={defaultIcon}>
          <Popup>
            {aircraft.flight || aircraft.reg || aircraft.hex}<br />
            {aircraft.type} • {aircraft.alt_baro ? Math.round(aircraft.alt_baro) + ' ft' : ''}
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}