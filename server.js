// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// config
const PORT = process.env.PORT || 3000;
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || '51.623842');
const DEFAULT_LON = parseFloat(process.env.DEFAULT_LON || '-0.269584');
const DEFAULT_RADIUS = process.env.DEFAULT_RADIUS || '250';
const DEFAULT_POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);
const OVERRIDE_LAT = process.env.OVERRIDE_LAT ? parseFloat(process.env.OVERRIDE_LAT) : null;
const OVERRIDE_LON = process.env.OVERRIDE_LON ? parseFloat(process.env.OVERRIDE_LON) : null;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'client', 'dist')));

// helper to sanitize aircraft
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
    dst: a.dst,
    emergency: a.emergency || 'none'
  };
}

// simple REST proxy (for debugging)
app.get('/api/closest', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    const useLat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (lat || DEFAULT_LAT);
    const useLon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (lon || DEFAULT_LON);
    const useRadius = radius || DEFAULT_RADIUS;
    const url = `https://api.adsb.lol/v2/closest/${encodeURIComponent(useLat)}/${encodeURIComponent(useLon)}/${encodeURIComponent(useRadius)}`;
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    const json = await r.json();
    res.json(json);
  } catch (err) {
    console.error('REST proxy error', err);
    res.status(500).json({ error: 'proxy error' });
  }
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html')));

// Per-socket polling and enrichment
io.on('connection', socket => {
  console.log('client connected', socket.id);
  let interval = null;

  socket.on('subscribe', async (opts = {}) => {
    const lat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (parseFloat(opts.lat) || DEFAULT_LAT);
    const lon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (parseFloat(opts.lon) || DEFAULT_LON);
    const radius = opts.radius || DEFAULT_RADIUS;
    const pollMs = parseInt(opts.pollMs || DEFAULT_POLL_MS, 10);

    if (interval) clearInterval(interval);

    const fetchAndEmit = async () => {
      try {
        const url = `https://api.adsb.lol/v2/closest/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
        const r = await fetch(url, { headers: { accept: 'application/json' } });
        if (!r.ok) {
          const txt = await r.text();
          socket.emit('error', { message: 'adsb proxy error', detail: txt });
          return;
        }
        const json = await r.json();
        const nearestRaw = (json.ac && json.ac.length) ? json.ac[0] : null;
        const nearest = sanitizeAircraft(nearestRaw);

        // Enrich with callsign details if we have a callsign
        if (nearest && nearest.flight) {
          try {
            const callsign = nearest.flight.trim();
            const csUrl = `https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign)}`;
            const csr = await fetch(csUrl, { headers: { accept: 'application/json' } });
            if (csr.ok) {
              const csJson = await csr.json();
              const csAc = (csJson.ac && csJson.ac.length) ? csJson.ac[0] : null;
              if (csAc) {
                // try common keys: from/to/operator/airline
                nearest.from = csAc.from || csAc.o || csAc.origin || null;
                nearest.to = csAc.to || csAc.d || csAc.destination || null;
                nearest.airline = csAc.airline || csAc.operator || csAc.registrar || null;
              }
            }
          } catch (err) {
            // don't fail whole flow on callsign fetch
            console.warn('callsign enrichment failed', err);
          }
        }

        socket.emit('update', { nearest, now: json.now || Date.now() });
      } catch (err) {
        console.error('poll error', err);
        socket.emit('error', { message: 'server poll error' });
      }
    };

    // immediate + interval
    await fetchAndEmit();
    interval = setInterval(fetchAndEmit, pollMs);
    socket.data.interval = interval;
  });

  socket.on('unsubscribe', () => {
    if (socket.data.interval) clearInterval(socket.data.interval);
    socket.data.interval = null;
  });

  socket.on('disconnect', () => {
    if (socket.data.interval) clearInterval(socket.data.interval);
  });
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));