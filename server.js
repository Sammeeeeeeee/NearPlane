// server.js (patched - robust lat/lon selection + logging + others count)
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || '51.623842');
const DEFAULT_LON = parseFloat(process.env.DEFAULT_LON || '-0.269584');
const DEFAULT_RADIUS = process.env.DEFAULT_RADIUS || '250';
const DEFAULT_POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);

// parse OVERRIDE envs only if set and valid numeric
const OVERRIDE_LAT = (process.env.OVERRIDE_LAT !== undefined && process.env.OVERRIDE_LAT !== '')
  ? Number(process.env.OVERRIDE_LAT)
  : null;
const OVERRIDE_LON = (process.env.OVERRIDE_LON !== undefined && process.env.OVERRIDE_LON !== '')
  ? Number(process.env.OVERRIDE_LON)
  : null;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'client', 'dist')));

// optional airline map load (non-blocking)
let AIRLINE_MAP = {};
(async function loadAirlines() {
  try {
    const resp = await fetch('https://gist.githubusercontent.com/AndreiCalazans/390e82a1c3edff852137cb3da813eceb/raw/1a1248f966b3f644f4eae057ad9b9b1b571c6aec/airlines.json');
    if (resp.ok) AIRLINE_MAP = await resp.json();
  } catch (e) {
    console.warn('airline map load failed', e && e.message ? e.message : e);
  }
})();

function countryCodeToEmoji(cc) {
  if (!cc) return '';
  return cc.toUpperCase().replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeAircraft(a) {
  if (!a) return null;
  return {
    hex: a.hex,
    flight: (a.flight || '').trim(),
    reg: a.r,
    type: a.t,
    lat: toNumber(a.lat),
    lon: toNumber(a.lon),
    gs: toNumber(a.gs),
    tas: toNumber(a.tas),
    ias: toNumber(a.ias),
    alt_baro: toNumber(a.alt_baro),
    track: toNumber(a.track),
    heading: toNumber(a.true_heading || a.mag_heading),
    seen: toNumber(a.seen),
    dst: a.dst,
    emergency: a.emergency || 'none'
  };
}

// debug REST proxy
app.get('/api/closest', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    const useLat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (toNumber(lat) !== null ? toNumber(lat) : DEFAULT_LAT);
    const useLon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (toNumber(lon) !== null ? toNumber(lon) : DEFAULT_LON);
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

io.on('connection', socket => {
  console.log('client connected', socket.id);
  let interval = null;

  socket.on('subscribe', async (opts = {}) => {
    // Determine coordinates priority: OVERRIDE env -> client opts -> DEFAULT
    const clientLat = toNumber(opts.lat);
    const clientLon = toNumber(opts.lon);

    const lat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (clientLat !== null ? clientLat : DEFAULT_LAT);
    const lon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (clientLon !== null ? clientLon : DEFAULT_LON);
    const radius = opts.radius || DEFAULT_RADIUS;
    const pollMs = parseInt(opts.pollMs || DEFAULT_POLL_MS, 10);

    const usedOverride = (OVERRIDE_LAT !== null) || (OVERRIDE_LON !== null);

    // log the actual subscription parameters for debugging
    console.log(`[subscribe] socket=${socket.id} lat=${lat} lon=${lon} radius=${radius} pollMs=${pollMs} override=${usedOverride}`);

    if (interval) clearInterval(interval);

    const fetchAndEmit = async () => {
      try {
        const closestUrl = `https://api.adsb.lol/v2/closest/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
        const r = await fetch(closestUrl, { headers: { accept: 'application/json' } });
        if (!r.ok) {
          const txt = await r.text();
          socket.emit('error', { message: 'adsb proxy error', detail: txt });
          console.warn('[fetchAndEmit] adsb closest not ok', r.status, txt);
          return;
        }
        const json = await r.json();
        const nearestRaw = (json.ac && json.ac.length) ? json.ac[0] : null;
        const nearest = sanitizeAircraft(nearestRaw);

        // callsign enrichment
        if (nearest && nearest.flight) {
          const callsign = nearest.flight.trim();
          try {
            const csUrl = `https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsign)}`;
            const csr = await fetch(csUrl, { headers: { accept: 'application/json' } });
            if (csr.ok) {
              const csJson = await csr.json();
              const csAc = (csJson.ac && csJson.ac.length) ? csJson.ac[0] : null;
              if (csAc) {
                nearest.airline = csAc.airline || csAc.operator || csAc.registrar || nearest.airline || null;
                nearest.from = csAc.from || csAc.o || csAc.origin || nearest.from || null;
                nearest.to = csAc.to || csAc.d || csAc.destination || nearest.to || null;
              }
            }
          } catch (err) {
            console.warn('callsign enrichment failed', err && err.message ? err.message : err);
          }

          // routeset POST to enrich from/to/airline when missing
          if ((!nearest.from || !nearest.to) && nearest.lat && nearest.lon) {
            try {
              const routesUrl = 'https://api.adsb.lol/api/0/routeset';
              const body = { planes: [{ callsign, lat: nearest.lat || lat, lng: nearest.lon || lon }] };
              const rr = await fetch(routesUrl, {
                method: 'POST',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify(body)
              });
              if (rr.ok) {
                const rjson = await rr.json();
                if (Array.isArray(rjson) && rjson.length) {
                  const route = rjson[0];
                  if (route.airline_code) {
                    nearest.airline = AIRLINE_MAP[route.airline_code] || route.airline_code;
                  }
                  if (route._airports && route._airports.length) {
                    const a0 = route._airports[0];
                    const a1 = route._airports[1] || null;
                    nearest.from = a0 ? `${a0.location} (${a0.name}${a0.iata ? ' — '+a0.iata : ''}) ${countryCodeToEmoji(a0.countryiso2)}` : nearest.from;
                    nearest.to = a1 ? `${a1.location} (${a1.name}${a1.iata ? ' — '+a1.iata : ''}) ${countryCodeToEmoji(a1.countryiso2)}` : nearest.to;
                  }
                }
              }
            } catch (err) {
              console.warn('routeset call failed', err && err.message ? err.message : err);
            }
          }
        }

        // point endpoint for other nearby planes
        let others = [];
        try {
          const pointUrl = `https://api.adsb.lol/v2/point/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
          const pr = await fetch(pointUrl, { headers: { accept: 'application/json' } });
          if (pr.ok) {
            const pjson = await pr.json();
            if (pjson.ac && Array.isArray(pjson.ac)) {
              others = pjson.ac.map(sanitizeAircraft).filter(a => a && (!nearest || a.hex !== nearest.hex));
            }
          }
        } catch (err) {
          console.warn('nearby point fetch failed', err && err.message ? err.message : err);
        }

        // log emit summary
        console.log(`[emit update] nearest=${nearest ? nearest.hex : 'none'} others=${Array.isArray(others) ? others.length : 0} for ${lat},${lon}`);

        socket.emit('update', { nearest, others, now: json.now || Date.now() });
      } catch (err) {
        console.error('poll error', err && err.message ? err.message : err);
        socket.emit('error', { message: 'server poll error' });
      }
    };

    // initial + interval
    await fetchAndEmit();
    interval = setInterval(fetchAndEmit, pollMs);
    socket.data.interval = interval;
    socket.data.sub = { lat, lon, radius, pollMs, override: usedOverride };
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
