// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || '51.623842');
const DEFAULT_LON = parseFloat(process.env.DEFAULT_LON || '-0.269584');
const DEFAULT_RADIUS = process.env.DEFAULT_RADIUS || '250';
const DEFAULT_POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);
const ENRICH_LIMIT = parseInt(process.env.ENRICH_LIMIT || '40', 10);

// parse OVERRIDE envs only if set and numeric
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

// load airline mapping (gist)
let AIRLINE_MAP = {};
(async function loadAirlines() {
  try {
    const resp = await fetch('https://gist.githubusercontent.com/AndreiCalazans/390e82a1c3edff852137cb3da813eceb/raw/1a1248f966b3f644f4eae057ad9b9b1b571c6aec/airlines.json');
    if (resp.ok) {
      AIRLINE_MAP = await resp.json();
      console.log('airline map loaded:', Object.keys(AIRLINE_MAP).length, 'entries');
    }
  } catch (err) {
    console.warn('could not load airline map', err && err.message ? err.message : err);
  }
})();

function countryCodeToEmoji(cc) {
  if (!cc) return '';
  return cc.toUpperCase().replace(/./g, ch => String.fromCodePoint(127397 + ch.charCodeAt(0)));
}
function countryCodeToName(cc) {
  if (!cc) return '';
  try {
    // Intl.DisplayNames should be available in Node 18
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(cc.toUpperCase()) || cc;
  } catch (e) {
    return cc;
  }
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

// simple debug proxy
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
    const clientLat = toNumber(opts.lat);
    const clientLon = toNumber(opts.lon);
    const lat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (clientLat !== null ? clientLat : DEFAULT_LAT);
    const lon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (clientLon !== null ? clientLon : DEFAULT_LON);
    const radius = opts.radius || DEFAULT_RADIUS;
    const pollMs = parseInt(opts.pollMs || DEFAULT_POLL_MS, 10);
    const usedOverride = (OVERRIDE_LAT !== null) || (OVERRIDE_LON !== null);

    console.log(`[subscribe] socket=${socket.id} lat=${lat} lon=${lon} radius=${radius} pollMs=${pollMs} override=${usedOverride}`);

    if (interval) clearInterval(interval);

    const fetchAndEmit = async () => {
      try {
        // nearest
        const closestUrl = `https://api.adsb.lol/v2/closest/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
        const r = await fetch(closestUrl, { headers: { accept: 'application/json' } });
        if (!r.ok) {
          const txt = await r.text();
          socket.emit('error', { message: 'adsb proxy error', detail: txt });
          console.warn('[closest] error', r.status, txt);
          return;
        }
        const json = await r.json();
        const nearestRaw = (json.ac && json.ac.length) ? json.ac[0] : null;
        const nearest = sanitizeAircraft(nearestRaw);

        // enrich nearest via callsign -> then routeset if needed
        if (nearest && nearest.flight) {
          const callsign = nearest.flight.trim();
          try {
            // callsign endpoint
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
            console.warn('[nearest callsign] failed', err && err.message ? err.message : err);
          }

          // routeset to get airports and better airline info
          if ((!nearest.from || !nearest.to || !nearest.airline) && nearest.lat && nearest.lon) {
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
                    nearest.airline = AIRLINE_MAP[route.airline_code] || route.airline_code || nearest.airline;
                  }
                  if (route.number) nearest.number = route.number;
                  if (route._airports && route._airports.length) {
                    const a0 = route._airports[0];
                    const a1 = route._airports[1] || null;
                    if (a0) {
                      const emoji = countryCodeToEmoji(a0.countryiso2);
                      const cName = countryCodeToName(a0.countryiso2);
                      nearest.from = `${a0.location} (${a0.name}${a0.iata ? ' — ' + a0.iata : ''}) ${emoji}`;
                      nearest.from_short = `${a0.iata || a0.icao || a0.location} ${cName} ${emoji}`;
                    }
                    if (a1) {
                      const emoji = countryCodeToEmoji(a1.countryiso2);
                      const cName = countryCodeToName(a1.countryiso2);
                      nearest.to = `${a1.location} (${a1.name}${a1.iata ? ' — ' + a1.iata : ''}) ${emoji}`;
                      nearest.to_short = `${a1.iata || a1.icao || a1.location} ${cName} ${emoji}`;
                    }
                  }
                }
              }
            } catch (err) {
              console.warn('[nearest routeset] failed', err && err.message ? err.message : err);
            }
          }
        }

        // others: point endpoint
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
          console.warn('[point] fetch failed', err && err.message ? err.message : err);
        }

        // enrich a limited batch of others (callsigns) using callsign + batch routeset
        try {
          const toEnrich = others.filter(o => o.flight).slice(0, ENRICH_LIMIT);
          // callsign fetches (parallel)
          const csPromises = toEnrich.map(o => (async () => {
            try {
              const csr = await fetch(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(o.flight)}`, { headers: { accept: 'application/json' } });
              if (!csr.ok) return null;
              const csJson = await csr.json();
              const csAc = (csJson.ac && csJson.ac.length) ? csJson.ac[0] : null;
              return { callsign: o.flight, csAc };
            } catch (err) {
              return null;
            }
          })());
          const csResults = await Promise.allSettled(csPromises);
          csResults.forEach((r, idx) => {
            if (r.status === 'fulfilled' && r.value && r.value.csAc) {
              const callsign = r.value.callsign;
              const csAc = r.value.csAc;
              const target = others.find(x => x.flight && x.flight.trim() === callsign.trim());
              if (target) {
                target.airline = csAc.airline || csAc.operator || csAc.registrar || target.airline || null;
                target.from = csAc.from || csAc.o || csAc.origin || target.from || null;
                target.to = csAc.to || csAc.d || csAc.destination || target.to || null;
              }
            }
          });

          // routeset batch POST
          if (toEnrich.length) {
            const body = { planes: toEnrich.map(o => ({ callsign: o.flight, lat: o.lat || lat, lng: o.lon || lon })) };
            try {
              const rr = await fetch('https://api.adsb.lol/api/0/routeset', {
                method: 'POST',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify(body)
              });
              if (rr.ok) {
                const rjson = await rr.json();
                if (Array.isArray(rjson)) {
                  rjson.forEach(route => {
                    const callsign = route.callsign;
                    const target = others.find(x => x.flight && x.flight.trim() === (callsign || '').trim());
                    if (!target) return;
                    if (route.airline_code) {
                      target.airline = AIRLINE_MAP[route.airline_code] || route.airline_code || target.airline;
                    }
                    if (route.number) target.number = route.number;
                    if (route._airports && route._airports.length) {
                      const a0 = route._airports[0];
                      const a1 = route._airports[1] || null;
                      if (a0) {
                        const emoji = countryCodeToEmoji(a0.countryiso2);
                        const cName = countryCodeToName(a0.countryiso2);
                        target.from = `${a0.location} (${a0.name}${a0.iata ? ' — ' + a0.iata : ''}) ${emoji}`;
                        target.from_short = `${a0.iata || a0.icao || a0.location} ${cName} ${emoji}`;
                      }
                      if (a1) {
                        const emoji = countryCodeToEmoji(a1.countryiso2);
                        const cName = countryCodeToName(a1.countryiso2);
                        target.to = `${a1.location} (${a1.name}${a1.iata ? ' — ' + a1.iata : ''}) ${emoji}`;
                        target.to_short = `${a1.iata || a1.icao || a1.location} ${cName} ${emoji}`;
                      }
                    }
                  });
                }
              }
            } catch (err) {
              console.warn('[others routeset] failed', err && err.message ? err.message : err);
            }
          }
        } catch (err) {
          console.warn('[enrich others] failure', err && err.message ? err.message : err);
        }

        console.log(`[emit update] nearest=${nearest ? nearest.hex : 'none'} others=${Array.isArray(others) ? others.length : 0} for ${lat},${lon}`);
        socket.emit('update', { nearest, others, now: json.now || Date.now() });
      } catch (err) {
        console.error('poll error', err && err.message ? err.message : err);
        socket.emit('error', { message: 'server poll error' });
      }
    };

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
