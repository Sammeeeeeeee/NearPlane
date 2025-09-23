import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import MapPlane from './MapPlane';

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default function App() {
  const [userPos, setUserPos] = useState(null);
  const [ac, setAc] = useState(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    socketRef.current = io(); // same origin
    socketRef.current.on('connect', () => setStatus('connected'));
    socketRef.current.on('disconnect', () => setStatus('disconnected'));
    socketRef.current.on('error', (e) => console.error('socket error', e));

    socketRef.current.on('update', ({ nearest }) => {
      if (!nearest) return setAc(null);
      // convert ground speed (knots) to mph
      if (nearest.gs !== undefined && nearest.gs !== null) {
        nearest.gs_mph = (nearest.gs * 1.15078).toFixed(0);
      }
      setAc(nearest);
    });

    return () => socketRef.current && socketRef.current.disconnect();
  }, []);

  useEffect(() => {
    // subscribe with browser geolocation; server overrides if OVERRIDE_LAT/OVERRIDE_LON set
    const subscribeWith = (p) => {
      setUserPos(p);
      socketRef.current && socketRef.current.emit('subscribe', { ...p, pollMs: 5000 });
    };

    if (!navigator.geolocation) {
      const fallback = { lat: 51.623842, lon: -0.269584 };
      subscribeWith(fallback);
      return;
    }

    navigator.geolocation.getCurrentPosition(pos => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      subscribeWith(p);
    }, err => {
      console.warn('geolocation failed, using fallback', err);
      const fallback = { lat: 51.623842, lon: -0.269584 };
      subscribeWith(fallback);
    }, { enableHighAccuracy: true, maximumAge: 5000 });
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>Nearest Plane — Live</h1>
        <small>Status: {status}</small>
      </header>

      {ac && ac.emergency && ac.emergency !== 'none' && (
        <div className="emergency-banner">EMERGENCY: {ac.emergency}</div>
      )}

      <main className="main-grid">
        <section className="info-card">
          {!ac && <p>No aircraft data yet.</p>}
          {ac && (
            <>
              <h2>{ac.flight || ac.reg || ac.hex}</h2>
              <p><strong>Type:</strong> {ac.type || 'unknown'}</p>
              <p><strong>Registration:</strong> {ac.reg || '—'}</p>
              <p><strong>Airline / Operator:</strong> {ac.airline || '—'}</p>
              <p><strong>From:</strong> {ac.from || '—'}</p>
              <p><strong>To:</strong> {ac.to || '—'}</p>
              <p><strong>Ground speed:</strong> {ac.gs_mph ? `${ac.gs_mph} mph` : (ac.gs ? `${(ac.gs*1.15078).toFixed(0)} mph` : '—')}</p>
              <p><strong>Altitude:</strong> {ac.alt_baro ? `${Math.round(ac.alt_baro)} ft` : '—'}</p>
              <p><strong>Track / Heading:</strong> {ac.track ? `${Math.round(ac.track)}°` : '—'}</p>
              {userPos && ac.lat && ac.lon && (
                <p><strong>Distance:</strong> {haversine(userPos.lat, userPos.lon, ac.lat, ac.lon).toFixed(2)} km</p>
              )}
            </>
          )}
        </section>

        <section className="map-card">
          <MapPlane userPos={userPos} aircraft={ac} />
        </section>
      </main>
    </div>
  );
}
