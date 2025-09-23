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
  const [nearest, setNearest] = useState(null);
  const [others, setOthers] = useState([]);
  const [showOthersList, setShowOthersList] = useState(false);
  const socketRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    socketRef.current = io();
    socketRef.current.on('connect', () => setStatus('connected'));
    socketRef.current.on('disconnect', () => setStatus('disconnected'));
    socketRef.current.on('error', (e) => console.error('socket error', e));

    socketRef.current.on('update', ({ nearest: n, others: o }) => {
      if (!n) {
        setNearest(null);
        setOthers([]);
        return;
      }
      if (n.gs !== undefined && n.gs !== null) n.gs_mph = (n.gs * 1.15078).toFixed(0);
      setNearest(n);
      setOthers(o || []);
    });

    return () => socketRef.current && socketRef.current.disconnect();
  }, []);

  useEffect(() => {
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

  // ALWAYS show nearest on left card. Others list is read-only (no selection).
  const shown = nearest;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Nearest Plane — Live</h1>
        <small>Status: {status}</small>
      </header>

      {shown && shown.emergency && shown.emergency !== 'none' && (
        <div className="emergency-banner">EMERGENCY: {shown.emergency}</div>
      )}

      <main className="main-grid">
        <section className="info-card">
          {!shown && <p>No aircraft data yet.</p>}

          {shown && (
            <>
              <h2>{(shown.flight || shown.callsign || shown.reg || shown.hex) || '—'}</h2>
              <p><strong>Type:</strong> {shown.type || 'unknown'}</p>
              <p><strong>Registration:</strong> {shown.reg || '—'}</p>
              <p><strong>Airline / Operator:</strong> {shown.airline || '—'}</p>

              <p>
                <strong>From:</strong>{' '}
                {shown.from ? (
                  <span className="route-line">
                    {/* Expect server to include emoji at end of string like "Cork (Cork Airport — ORK) 🇮🇪" */}
                    {/* Normalize to: emoji first, then rest */}
                    {(() => {
                      const parts = String(shown.from).trim();
                      // find emoji at end if present (common case we attach emoji)
                      const emojiMatch = parts.match(/([\u{1F1E6}-\u{1F1FF}]{2})$/u);
                      const emoji = emojiMatch ? emojiMatch[0] : '';
                      const core = emoji ? parts.replace(emoji, '').trim() : parts;
                      // core looks like "Cork (Cork Airport — ORK)"
                      return (
                        <>
                          {emoji && <span className="flag">{emoji} </span>}
                          <span className="route-main">{core}</span>
                        </>
                      );
                    })()}
                  </span>
                ) : '—'}
              </p>

              <p>
                <strong>To:</strong>{' '}
                {shown.to ? (
                  <span className="route-line">
                    {(() => {
                      const parts = String(shown.to).trim();
                      const emojiMatch = parts.match(/([\u{1F1E6}-\u{1F1FF}]{2})$/u);
                      const emoji = emojiMatch ? emojiMatch[0] : '';
                      const core = emoji ? parts.replace(emoji, '').trim() : parts;
                      return (
                        <>
                          {emoji && <span className="flag">{emoji} </span>}
                          <span className="route-main">{core}</span>
                        </>
                      );
                    })()}
                  </span>
                ) : '—'}
              </p>

              <p><strong>Ground speed:</strong> {shown.gs_mph ? `${shown.gs_mph} mph` : (shown.gs ? `${(shown.gs*1.15078).toFixed(0)} mph` : '—')}</p>
              <p><strong>Altitude:</strong> {shown.alt_baro ? `${Math.round(shown.alt_baro)} ft` : '—'}</p>
              <p><strong>Track / Heading:</strong> {shown.track ? `${Math.round(shown.track)}°` : '—'}</p>
              {userPos && shown.lat && shown.lon && (
                <p><strong>Distance:</strong> {haversine(userPos.lat, userPos.lon, shown.lat, shown.lon).toFixed(2)} km</p>
              )}
            </>
          )}

          <hr style={{margin:'8px 0'}} />

          <p>
            <strong style={{cursor:'pointer'}} onClick={() => setShowOthersList(s => !s)}>
              Other planes nearby: {Array.isArray(others) ? others.length : 0}
            </strong>
          </p>

          {showOthersList && (
            <div style={{maxHeight:260, overflow:'auto', marginTop:8, fontSize:13}}>
              {others.length === 0 && <div style={{color:'#9aa'}}>No other planes returned.</div>}
              {others.map((o, i) => (
                <div key={o.hex || `${o.lat}-${o.lon}-${i}`} style={{padding:'8px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <div style={{fontWeight:700}}>
                    { (o.flight || o.callsign || '—') } { o.number ? `/ ${o.number}` : '' } - { o.airline || '—' }
                  </div>
                  <div style={{color:'#cfe', marginTop:6}}>
                    {/* Show exactly: FLAG CountryName  City  (Airport — IATA) */}
                    { (o.from_short || o.from || '—') } <span style={{opacity:0.85}}> — </span> { (o.to_short || o.to || '—') }
                  </div>
                </div>
              ))}
            </div>
          )}

        </section>

        <section className="map-card">
          <MapPlane userPos={userPos} aircraft={nearest} others={others} />
        </section>
      </main>
    </div>
  );
}
