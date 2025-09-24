import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import MapPlane from './MapPlane';

function haversine(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // km
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Render "🇮🇪 Cork (ORK - Cork Airport)" style with emoji aligned, bracket small/faded
function renderAirportShort(obj) {
  if (!obj) return '—';
  // build flag properly (two regional indicators)
  const emoji = obj.countryiso ? String.fromCodePoint(...obj.countryiso.toUpperCase().split('').map(c=>127397 + c.charCodeAt(0))) : '';
  const city = obj.city || '';
  const iata = obj.iata || '';
  const name = obj.name || '';
  return (
    <span className="route-singleline">
      {emoji ? <span className="flag">{emoji}</span> : null}
      <span className="route-main">{city}</span>
      <span className="bracket"> ({iata ? iata + ' - ' + name : name})</span>
    </span>
  );
}

export default function App() {
  const [userPos, setUserPos] = useState(null);
  const [nearest, setNearest] = useState(null);
  const [others, setOthers] = useState([]);
  const [othersTotal, setOthersTotal] = useState(0);
  const [showOthersList, setShowOthersList] = useState(false);
  const socketRef = useRef(null);
  const lastPosRef = useRef(null);
  const subscribedRef = useRef(false);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      setStatus('connected');
      if (!subscribedRef.current && lastPosRef.current) {
        socketRef.current.emit('subscribe', { ...lastPosRef.current });
        subscribedRef.current = true;
      }
    });

    socketRef.current.on('disconnect', () => {
      setStatus('disconnected');
      subscribedRef.current = false;
    });

    socketRef.current.on('update', ({ nearest: n, others: o, othersTotal: total }) => {
      if (!n) {
        setNearest(null);
        setOthers([]);
        setOthersTotal(total || 0);
        return;
      }
      if (n.gs !== undefined && n.gs !== null) n.gs_mph = (n.gs * 1.15078).toFixed(0);
      setNearest(n);
      setOthers(Array.isArray(o) ? o : []);
      setOthersTotal(total || (Array.isArray(o) ? o.length : 0));
    });

    socketRef.current.on('error', (e) => console.error('socket error', e));
    return () => socketRef.current && socketRef.current.disconnect();
  }, []);

  useEffect(() => {
    function doSubscribe(pos) {
      lastPosRef.current = pos;
      setUserPos(pos);
      if (socketRef.current && socketRef.current.connected && !subscribedRef.current) {
        socketRef.current.emit('subscribe', { ...pos });
        subscribedRef.current = true;
      }
    }

    if (!navigator.geolocation) {
      doSubscribe({ lat: 51.623842, lon: -0.269584 });
      return;
    }

    navigator.geolocation.getCurrentPosition(position => {
      doSubscribe({ lat: position.coords.latitude, lon: position.coords.longitude });
    }, err => {
      console.warn('geolocation failed', err);
      doSubscribe({ lat: 51.623842, lon: -0.269584 });
    }, { enableHighAccuracy: true, maximumAge: 5000 });
  }, []);

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

              <p><strong>From:</strong>{' '}
                {shown.from_obj ? renderAirportShort(shown.from_obj) : (shown.from ? <span className="route-singleline">{shown.from}</span> : '—')}
              </p>

              <p><strong>To:</strong>{' '}
                {shown.to_obj ? renderAirportShort(shown.to_obj) : (shown.to ? <span className="route-singleline">{shown.to}</span> : '—')}
              </p>

              <p><strong>Ground speed:</strong> {shown.gs_mph ? `${shown.gs_mph} mph` : (shown.gs ? `${(shown.gs*1.15078).toFixed(0)} mph` : '—')}</p>
              <p><strong>Altitude:</strong> {shown.alt_baro ? `${Math.round(shown.alt_baro)} ft` : '—'}</p>
              <p><strong>Track / Heading:</strong> {shown.track ? `${Math.round(shown.track)}°` : '—'}</p>
              {userPos && shown.lat && shown.lon && (<p><strong>Distance:</strong> {haversine(userPos.lat, userPos.lon, shown.lat, shown.lon).toFixed(2)} km</p>)}
            </>
          )}

          <hr style={{margin:'8px 0'}} />

          <p>
            <strong style={{cursor:'pointer'}} onClick={() => setShowOthersList(s => !s)}>
              Other planes nearby: {othersTotal}
            </strong>
          </p>

          {showOthersList && (
            <div style={{maxHeight:260, overflow:'auto', marginTop:8, fontSize:13}}>
              {others.length === 0 && <div style={{color:'#9aa'}}>No other planes returned.</div>}
              {others.map((o, i) => (
                <div key={o.hex || `${o.lat}-${o.lon}-${i}`} style={{padding:'8px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <div style={{fontWeight:700}}>
                    { (o.flight || o.callsign || '—') }{ o.number ? ` / ${o.number}` : '' } <span style={{marginLeft:10, color:'#cfe'}}>{o.airline || '—'}</span>
                  </div>
                  <div style={{color:'#cfe', marginTop:6}}>
                    <div style={{fontSize:13, opacity:0.95}}>{ o.type ? `${o.type}` : '' }{ o.type ? ' • ' : '' }{ o.reg ? `${o.reg}` : '' }</div>
                    <div style={{marginTop:6}}>
                      { o.from_obj ? renderAirportShort(o.from_obj) : (o.from || '—') }
                      <span style={{opacity:0.85}}> — </span>
                      { o.to_obj ? renderAirportShort(o.to_obj) : (o.to || '—') }
                    </div>
                  </div>
                </div>
              ))}
              {othersTotal > others.length && <div style={{padding:10,color:'#9aa',textAlign:'center'}}>… showing {others.length} of {othersTotal}</div>}
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
