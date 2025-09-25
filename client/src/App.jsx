// client/src/App.jsx
import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import MapPlane from './MapPlane';

/* Utility: haversine distance in km */
function haversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371;
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/* Render airport block: wraps to the next line if long, shows flag emoji, city and bracketed airport code/name */
function renderAirportShort(obj) {
  if (!obj) return '—';

  const cc = (obj.countryiso || obj.country || '').toUpperCase();
  const emoji = (cc && cc.length === 2)
    ? String.fromCodePoint(...cc.split('').map(c => 127397 + c.charCodeAt(0)))
    : '';

  const city = obj.city || obj.location || '';
  const iata = obj.iata || obj.iata_code || obj.iata_code || '';
  const name = obj.name || obj.name || '';

  return (
    <span className="route-wrapping" style={{maxWidth:'100%'}}>
      {emoji ? <span className="flag" aria-hidden>{emoji}</span> : null}
      <span style={{display:'inline-flex', flexDirection:'row', flexWrap:'wrap', gap:'0.4rem', alignItems:'baseline'}}>
        <span className="route-main">{city || '—'}</span>
        <span className="bracket">({iata ? `${iata} - ${name}` : name})</span>
      </span>
    </span>
  );
}

export default function App() {
  const [userPos, setUserPos] = useState(null);
  const [nearest, setNearest] = useState(null);
  const [others, setOthers] = useState([]);
  const [othersTotal, setOthersTotal] = useState(0);
  const [showOthersList, setShowOthersList] = useState(false);
  const [status, setStatus] = useState('connecting');

  const socketRef = useRef(null);
  const lastPosRef = useRef(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    // connect to same-origin socket.io
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
      // if we already have position, ensure subscription
      if (!subscribedRef.current && lastPosRef.current) {
        socket.emit('subscribe', { ...lastPosRef.current });
        subscribedRef.current = true;
      }
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
      subscribedRef.current = false;
    });

    socket.on('error', (e) => {
      console.error('socket error', e);
    });

    socket.on('update', ({ nearest: n, others: o, othersTotal: total }) => {
      if (!n) {
        setNearest(null);
        setOthers(Array.isArray(o) ? o : []);
        setOthersTotal(total || (Array.isArray(o) ? o.length : 0));
        return;
      }

      // convert ground speed (knots) to mph and round
      if (n.gs !== undefined && n.gs !== null) {
        n.gs_mph = Math.round(Number(n.gs) * 1.15078);
      }

      setNearest(n);
      setOthers(Array.isArray(o) ? o : []);
      setOthersTotal(total || (Array.isArray(o) ? o.length : 0));
    });

    return () => {
      try { socket.disconnect(); } catch (e) {}
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    // subscribe with browser geolocation (server-side overrides env if set)
    function doSubscribe(pos) {
      lastPosRef.current = pos;
      setUserPos(pos);
      if (socketRef.current && socketRef.current.connected && !subscribedRef.current) {
        socketRef.current.emit('subscribe', { ...pos });
        subscribedRef.current = true;
      }
    }

    if (!navigator.geolocation) {
      // fallback
      doSubscribe({ lat: 51.623842, lon: -0.269584 });
      return;
    }

    navigator.geolocation.getCurrentPosition((p) => {
      doSubscribe({ lat: p.coords.latitude, lon: p.coords.longitude });
    }, (err) => {
      console.warn('geolocation failed, falling back', err);
      doSubscribe({ lat: 51.623842, lon: -0.269584 });
    }, { enableHighAccuracy: true, maximumAge: 5000 });
  }, []);

  const shown = nearest; // left info always shows nearest (never selectable from others)

  return (
    <div className="app">
      <header className="topbar">
        <h1>NearPlane</h1>
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
              <div style={{display:'flex', gap:12, alignItems:'center'}}>
                <div style={{
                  width:120, height:80, borderRadius:8, overflow:'hidden',
                  background:'#06111b', display:'flex', alignItems:'center', justifyContent:'center'
                }}>
                  {shown.thumb ? (
                    <img src={shown.thumb} alt="aircraft" style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}} />
                  ) : (
                    <div style={{color:'#6aa', fontSize:13, padding:6, textAlign:'center'}}>No image</div>
                  )}
                </div>

                <div style={{flex:1, minWidth:0}}>
                  <h2 style={{margin:'0 0 6px 0', overflowWrap:'anywhere', fontSize:18}}>
                    {(shown.flight || shown.callsign || shown.reg || shown.hex) || '—'}
                  </h2>
                  <div style={{color:'#9aa', fontSize:13, display:'grid', gap:6}}>
                    {/* Minimal change: prefer aircraft_name (MANUFACTURER, Model (TYPE)) if available */}
                    <div><strong>Type:</strong> {shown.aircraft_name || shown.type || 'unknown'}</div>
                    <div><strong>Registration:</strong> {shown.reg || '—'}</div>
                    <div><strong>Airline / Operator:</strong> {shown.airline || '—'}</div>
                  </div>
                </div>
              </div>

              <div style={{height:10}} />

              <div style={{display:'flex', flexDirection:'column', gap:6}}>
                <div>
                  <strong>From:</strong>{' '}
                  {shown.from_obj ? renderAirportShort(shown.from_obj) : (shown.from ? <span className="route-wrapping">{shown.from}</span> : '—')}
                </div>
                <div>
                  <strong>To:</strong>{' '}
                  {shown.to_obj ? renderAirportShort(shown.to_obj) : (shown.to ? <span className="route-wrapping">{shown.to}</span> : '—')}
                </div>
              </div>

              <div style={{height:8}} />
              <div style={{color:'#cfe', display:'grid', gap:6}}>
                <div><strong>Ground speed:</strong> {shown.gs_mph ? `${shown.gs_mph} mph` : (shown.gs ? `${Math.round(shown.gs * 1.15078)} mph` : '—')}</div>
                <div><strong>Altitude:</strong> {shown.alt_baro ? `${Math.round(shown.alt_baro)} ft` : '—'}</div>
                <div><strong>Track / Heading:</strong> {shown.track ? `${Math.round(shown.track)}°` : '—'}</div>
                {userPos && shown.lat && shown.lon && (
                  <div><strong>Distance:</strong> {haversineKm(userPos.lat, userPos.lon, shown.lat, shown.lon).toFixed(2)} km</div>
                )}
              </div>
            </>
          )}

          <hr />

          <p>
            <strong style={{cursor:'pointer'}} onClick={() => setShowOthersList(s => !s)}>
              Other planes nearby: {othersTotal}
            </strong>
          </p>

          {showOthersList && (
            <div style={{maxHeight:260, overflow:'auto', marginTop:8, fontSize:13}}>
              {others.length === 0 && <div style={{color:'#9aa'}}>No other planes returned.</div>}
              {others.map((o, i) => (
                <div key={o.hex || `${o.lat}-${o.lon}-${i}`} style={{padding:'8px 6px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <div style={{fontWeight:700, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                    <div style={{display:'flex', gap:10, alignItems:'center', minWidth:0}}>
                      <div style={{fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {(o.flight || o.callsign || '—')}{ o.number ? ` / ${o.number}` : '' }
                      </div>
                      <div style={{color:'#cfe', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {o.airline || '—'}
                      </div>
                    </div>
                    <div style={{color:'#9aa', fontSize:12, minWidth:60, textAlign:'right'}}>
                      {o.dst ? `${Number(o.dst).toFixed(1)} km` : (o.lat && userPos ? `${haversineKm(userPos.lat, userPos.lon, o.lat, o.lon).toFixed(1)} km` : '—')}
                    </div>
                  </div>

                  <div style={{color:'#cfe', marginTop:6}}>
                    <div style={{fontSize:13, opacity:0.95}}>
                      {/* show mapped aircraft_name if available, otherwise show type */}
                      { o.aircraft_name ? `${o.aircraft_name}` : (o.type ? `${o.type}` : '') }{ o.type ? (o.type && o.reg ? ' • ' : '') : '' }{ o.reg ? `${o.reg}` : '' }
                    </div>
                    <div style={{marginTop:6}}>
                      { o.from_obj ? renderAirportShort(o.from_obj) : (o.from || '—') }
                      <span style={{opacity:0.85}}> — </span>
                      { o.to_obj ? renderAirportShort(o.to_obj) : (o.to || '—') }
                    </div>
                  </div>
                </div>
              ))}

              {othersTotal > others.length && (
                <div style={{padding:10, color:'#9aa', textAlign:'center'}}>… showing {others.length} of {othersTotal}</div>
              )}
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
