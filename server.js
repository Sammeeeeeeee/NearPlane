// server.js
// Minimal Express + Socket.IO server that proxies adsb.lol per-client

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// Config: polling and defaults
const PORT = process.env.PORT || 3000;
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || '51.623842');
const DEFAULT_LON = parseFloat(process.env.DEFAULT_LON || '-0.269584');
const DEFAULT_RADIUS = process.env.DEFAULT_RADIUS || '250';
const DEFAULT_POLL_MS = parseInt(process.env.POLL_MS || '5000', 10); // 5s default

// Optional override: if set, server uses these coordinates and ignores browser
const OVERRIDE_LAT = process.env.OVERRIDE_LAT ? parseFloat(process.env.OVERRIDE_LAT) : null;
const OVERRIDE_LON = process.env.OVERRIDE_LON ? parseFloat(process.env.OVERRIDE_LON) : null;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { /* defaults, same origin */ });

// Serve client build
app.use(express.static(path.join(__dirname, 'client', 'dist')));

// Simple REST proxy for debugging
app.get('/api/closest', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    // server-side priority: OVERRIDE -> query params -> DEFAULT
    const useLat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (lat || DEFAULT_LAT);
    const useLon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (lon || DEFAULT_LON);
    const useRadius = radius || DEFAULT_RADIUS;
    const url = `https://api.adsb.lol/v2/closest/${encodeURIComponent(useLat)}/${encodeURIComponent(useLon)}/${encodeURIComponent(useRadius)}`;
    const headers = { accept: 'application/json' };
    const r = await fetch(url, { headers });
    const json = await r.json();
    return res.json(json);
  } catch (err) {
    console.error('REST proxy error', err);
    res.status(500).json({ error: 'proxy error' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// Helper: sanitize aircraft object
function sanitizeAircraft(a) {
  if (!a) return null;
  return {
    hex: a.hex,
    flight: (a.flight || '').trim(),
    reg: a.r,
    type: a.t,
    lat: a.lat,
    lon: a.lon,
    gs: a.gs,
    tas: a.tas,
    ias: a.ias,
    alt_baro: a.alt_baro,
    track: a.track,
    heading: a.true_heading || a.mag_heading,
    seen: a.seen,
    dst: a.dst
  };
}

// Per-socket polling: client sends 'subscribe' with { lat, lon, radius, pollMs }
io.on('connection', (socket) => {
  console.log('client connected', socket.id);
  let interval = null;

  socket.on('subscribe', async (opts = {}) => {
    // If the server has OVERRIDE lat/lon set, use it and ignore opts.lat/lon.
    const lat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (parseFloat(opts.lat) || DEFAULT_LAT);
    const lon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (parseFloat(opts.lon) || DEFAULT_LON);
    const radius = opts.radius || DEFAULT_RADIUS;
    const pollMs = parseInt(opts.pollMs || DEFAULT_POLL_MS, 10);

    // clear existing poller if present
    if (interval) clearInterval(interval);

    const fetchAndEmit = async () => {
      try {
        const url = `https://api.adsb.lol/v2/closest/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
        const headers = { accept: 'application/json' };
        const r = await fetch(url, { headers });
        if (!r.ok) {
          const txt = await r.text();
          socket.emit('error', { message: 'adsb proxy error', detail: txt });
          return;
        }
        const json = await r.json();
        const nearest = (json.ac && json.ac.length) ? sanitizeAircraft(json.ac[0]) : null;
        socket.emit('update', { nearest, now: json.now || Date.now() });
      } catch (err) {
        console.error('poll error', err);
        socket.emit('error', { message: 'server poll error' });
      }
    };

    // initial one-off then interval
    await fetchAndEmit();
    interval = setInterval(fetchAndEmit, pollMs);
    // store so we can clear on disconnect
    socket.data.interval = interval;
    socket.data.sub = { lat, lon, radius, pollMs };
  });

  socket.on('unsubscribe', () => {
    if (socket.data.interval) clearInterval(socket.data.interval);
    socket.data.interval = null;
  });

  socket.on('disconnect', () => {
    if (socket.data.interval) clearInterval(socket.data.interval);
    console.log('client disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});