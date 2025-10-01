import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import MapPlane from './MapPlane';
import './style.css';
import logo from './logo.svg';

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
    <span className="route-wrapping">
      {emoji ? (
        <span className="flag-city" aria-hidden>
          <span className="flag">{emoji}</span>
          <span className="route-main">{city || '—'}</span>
        </span>
      ) : (
        <span className="route-main">{city || '—'}</span>
      )}

      <span className="bracket">({iata ? `${iata} - ${name}` : name})</span>
    </span>
  );
}

/* StatusDot component (green/red dot with click tooltip) */
function StatusDot({ status }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!btnRef.current) return;
      if (!btnRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => setOpen(false), [status]);

  return (
    <div className="status-dot-wrap" ref={btnRef}>
      <button
        className={`status-dot ${status === 'connected' ? 'connected' : 'disconnected'}`}
        onClick={(e) => { e.stopPropagation(); setOpen(s => !s); }}
        aria-label={`Connection status: ${status}`}
        title={`Status: ${status}`}
      />
      {open && (
        <div className="status-tooltip" role="status" aria-live="polite">
          <div className="status-tooltip-inner">
            <strong>Status:</strong> {status}
          </div>
        </div>
      )}
    </div>
  );
}

/* Theme switch (on = dark, off = light)
   - defaults to system preference on first load
   - persists choice in localStorage under 'nearplane_theme'
*/
function ThemeSwitch() {
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem('nearplane_theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
    try { localStorage.setItem('nearplane_theme', theme); } catch (e) {}
  }, [theme]);

  const onChange = (e) => {
    setTheme(e.target.checked ? 'dark' : 'light');
  };

  return (
    <div className="theme-toggle" role="toolbar" aria-label="Theme switch">
      <label className="switch">
        <input
          type="checkbox"
          checked={theme === 'dark'}
          onChange={onChange}
          aria-label="Enable dark mode"
        />
        <span className="slider" />
      </label>
    </div>
  );
}

export default function App() {
  const [userPos, setUserPos] = useState(null);
  const [nearest, setNearest] = useState(null);
  const [others, setOthers] = useState([]);
  const [othersTotal, setOthersTotal] = useState(0);
  const [showOthersList, setShowOthersList] = useState(false);
  const [status, setStatus] = useState('connecting');
  const [hideGroundVehicles, setHideGroundVehicles] = useState(false);

  const socketRef = useRef(null);
  const lastPosRef = useRef(null);
  const subscribedRef = useRef(false);
  const hasSetInitialExpanded = useRef(false);

  useEffect(() => {
    // connect to same-origin socket.io
    const socket = io();
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('connected');
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

    socket.on('update', ({ nearest: n, others: o, othersTotal: total, showOthersExpanded, hideGroundVehicles }) => {
      // Set default expanded state on first update only
      if (showOthersExpanded !== undefined && !hasSetInitialExpanded.current) {
        setShowOthersList(showOthersExpanded);
        hasSetInitialExpanded.current = true;
      }

      // Set hide ground vehicles flag
      if (hideGroundVehicles !== undefined) {
        setHideGroundVehicles(hideGroundVehicles);
      }

      if (!n) {
        setNearest(null);
        setOthers(Array.isArray(o) ? o : []);
        setOthersTotal(total || (Array.isArray(o) ? o.length : 0));
        return;
      }

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

    navigator.geolocation.getCurrentPosition((p) => {
      doSubscribe({ lat: p.coords.latitude, lon: p.coords.longitude });
    }, (err) => {
      console.warn('geolocation failed, falling back', err);
      doSubscribe({ lat: 51.623842, lon: -0.269584 });
    }, { enableHighAccuracy: true, maximumAge: 5000 });
  }, []);

  const shown = nearest;

  // Filter out Category C aircraft from the list if hideGroundVehicles is enabled
  const filteredOthers = hideGroundVehicles 
    ? others.filter(o => !o.category || !o.category.startsWith('C'))
    : others;

  const displayedOthersCount = filteredOthers.length;

  return (
    <div className="app">
      <header className="topbar">
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <StatusDot status={status} />
          <h1 style={{margin:0}}>NearPlane</h1>
          <img src={logo} style={{height: 28, width: 'auto'}} />
        </div>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <ThemeSwitch />
        </div>
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
                  background:'var(--thumb-bg)', display:'flex', alignItems:'center', justifyContent:'center'
                }}>
                  {shown.thumb ? (
                    <img src={shown.thumb} alt="aircraft" style={{width:'100%', height:'100%', objectFit:'cover', display:'block'}} />
                  ) : (
                    <div style={{color:'var(--muted)', fontSize:13, padding:6, textAlign:'center'}}>No image</div>
                  )}
                </div>

                <div style={{flex:1, minWidth:0}}>
                  <h2 style={{margin:'0 0 6px 0', overflowWrap:'anywhere', fontSize:18}}>
                    {(shown.flight || shown.callsign || shown.reg || shown.hex) || '—'}
                  </h2>
                  <div style={{color:'var(--muted)', fontSize:13, display:'grid', gap:6}}>
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
              <div style={{color:'var(--muted)', display:'grid', gap:6}}>
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
              {hideGroundVehicles && filteredOthers.length !== othersTotal && (
                <span style={{color:'var(--muted)', fontSize:13, marginLeft:6}}>
                  ({displayedOthersCount} shown, ground vehicles hidden)
                </span>
              )}
            </strong>
          </p>

          {showOthersList && (
            <div style={{maxHeight:260, overflow:'auto', marginTop:8, fontSize:13}}>
              {filteredOthers.length === 0 && <div style={{color:'var(--muted)'}}>No other planes returned.</div>}
              {filteredOthers.map((o, i) => (
                <div key={o.hex || `${o.lat}-${o.lon}-${i}`} style={{padding:'8px 6px', borderBottom:'1px solid rgba(0,0,0,0.04)'}}>
                  <div style={{fontWeight:700, display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}>
                    <div style={{display:'flex', gap:10, alignItems:'center', minWidth:0}}>
                      <div style={{fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {(o.flight || o.callsign || '—')}{ o.number ? ` / ${o.number}` : '' }
                      </div>
                      <div style={{color:'var(--muted)', fontSize:13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {o.airline || '—'}
                      </div>
                    </div>
                    <div style={{color:'var(--muted)', fontSize:12, minWidth:60, textAlign:'right'}}>
                      {o.dst ? `${Number(o.dst).toFixed(1)} km` : (o.lat && userPos ? `${haversineKm(userPos.lat, userPos.lon, o.lat, o.lon).toFixed(1)} km` : '—')}
                    </div>
                  </div>

                  <div style={{color:'var(--muted)', marginTop:6}}>
                    <div style={{fontSize:13, opacity:0.95}}>
                      { o.aircraft_name ? `${o.aircraft_name}` : (o.type ? `${o.type}` : '') }{ o.type ? (o.type && o.reg ? ' • ' : '') : '' }{ o.reg ? `${o.reg}` : '' }
                    </div>
                    <div style={{marginTop:6}}>
                      { o.from_obj ? renderAirportShort(o.from_obj) : (o.from || '—') }
                      <span style={{opacity:0.85}}> -> </span>
                      { o.to_obj ? renderAirportShort(o.to_obj) : (o.to || '—') }
                    </div>
                  </div>
                </div>
              ))}

              {othersTotal > displayedOthersCount && (
                <div style={{padding:10, color:'var(--muted)', textAlign:'center'}}>
                  … showing {displayedOthersCount} of {othersTotal}
                  {hideGroundVehicles && (
                    <span> (ground vehicles hidden)</span>
                  )}
                </div>
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