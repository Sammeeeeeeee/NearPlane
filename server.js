// server.js
// Centralized poller + rate-limited outbound requests + caches
// Node 18+ (uses global fetch)

const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

/*
  Env config
*/
const PORT = process.env.PORT || 3000;
const DEFAULT_LAT = parseFloat(process.env.DEFAULT_LAT || '51.623842');
const DEFAULT_LON = parseFloat(process.env.DEFAULT_LON || '-0.269584');
const DEFAULT_RADIUS = process.env.DEFAULT_RADIUS || '250';

const POLL_MS = parseInt(process.env.POLL_MS || '5000', 10);        // nearest
const OTHER_POLL_MS = parseInt(process.env.OTHER_POLL_MS || '20000', 10); // others
const OTHERS_LIMIT = parseInt(process.env.OTHERS_LIMIT || '10', 10);

const CALLSIGN_TTL = parseInt(process.env.CALLSIGN_TTL || '60000', 10);
const ROUTESET_TTL = parseInt(process.env.ROUTESET_TTL || '120000', 10);

const MAX_REQUESTS_PER_MIN = parseInt(process.env.MAX_REQUESTS_PER_MIN || '60', 10);

const OVERRIDE_LAT = (process.env.OVERRIDE_LAT !== undefined && process.env.OVERRIDE_LAT !== '') ? Number(process.env.OVERRIDE_LAT) : null;
const OVERRIDE_LON = (process.env.OVERRIDE_LON !== undefined && process.env.OVERRIDE_LON !== '') ? Number(process.env.OVERRIDE_LON) : null;

const ENRICH_CONCURRENCY = parseInt(process.env.ENRICH_CONCURRENCY || '3', 10);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/* --- existing helper functions --- */
function toNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function sanitizeAircraft(a) {
  if (!a) return null;
  return {
    hex: a.hex,
    flight: (a.flight || '').trim(),
    reg: a.r || null,
    type: a.t || a.type || null,
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
function haversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return Number.POSITIVE_INFINITY;
  const R = 6371;
  const toRad = v => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/* --- load two-letter airlines map (unchanged) --- */
let AIRLINE_MAP = {};
(async () => {
  try {
    const u = 'https://gist.githubusercontent.com/AndreiCalazans/390e82a1c3edff852137cb3da813eceb/raw/1a1248f966b3f644f4eae057ad9b9b1b571c6aec/airlines.json';
    const r = await fetch(u);
    if (r.ok) AIRLINE_MAP = await r.json();
    console.log('airline map loaded entries=', Object.keys(AIRLINE_MAP).length);
  } catch (e) {
    console.warn('airline map load failed:', e && e.message ? e.message : e);
  }
})();

/* --- load 3-letter CSV map (unchanged) --- */
const THREE_LETTER_MAP = {};
(async function loadThreeLetterMap() {
  try {
    const url = 'https://raw.githubusercontent.com/rikgale/ICAOList/refs/heads/main/Airlines.csv';
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('failed to fetch 3-letter CSV', resp.status);
      return;
    }
    const txt = await resp.text();

    function parseCSV(text) {
      const rows = [];
      let cur = [];
      let i = 0;
      let field = '';
      let inQuotes = false;
      while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i+1] === '"') { field += '"'; i += 2; continue; }
            inQuotes = false; i++; continue;
          } else { field += ch; i++; continue; }
        } else {
          if (ch === '"') { inQuotes = true; i++; continue; }
          if (ch === ',') { cur.push(field); field = ''; i++; continue; }
          if (ch === '\r') { i++; continue; }
          if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
          field += ch; i++;
        }
      }
      if (field !== '' || cur.length) cur.push(field);
      if (cur.length) rows.push(cur);
      return rows;
    }

    const rows = parseCSV(txt);
    for (let r of rows) {
      if (!r || r.length < 4) continue;
      const company = (r[0] || '').trim();
      const code = (r[3] || '').trim().toUpperCase();
      if (company && code) THREE_LETTER_MAP[code] = company;
    }
    console.log('3-letter airline map loaded entries=', Object.keys(THREE_LETTER_MAP).length);
  } catch (e) {
    console.warn('failed to load 3-letter map', e && e.message ? e.message : e);
  }
})();

/* --- rate-limited fetch (token bucket) --- */
class TokenBucket {
  constructor(limitPerMin) {
    this.capacity = Math.max(1, Math.floor(limitPerMin));
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
    this.refillInterval = 60000;
  }
  _refillIfNeeded() {
    const now = Date.now();
    if (now - this.lastRefill >= this.refillInterval) {
      this.tokens = this.capacity;
      this.lastRefill = now;
    }
  }
  async take() {
    while (true) {
      this._refillIfNeeded();
      if (this.tokens > 0) { this.tokens -= 1; return; }
      await new Promise(r => setTimeout(r, 250));
    }
  }
}
const bucket = new TokenBucket(MAX_REQUESTS_PER_MIN);

async function rateLimitedFetch(url, opts = {}) {
  await bucket.take();
  const t0 = Date.now();
  console.log(`[OUT] ${new Date(t0).toISOString()} → ${opts.method || 'GET'} ${url}`);
  try {
    const res = await fetch(url, opts);
    const took = Date.now() - t0;
    console.log(`[OUT-RESP] status=${res.status} tookMs=${took} url=${url}`);
    return res;
  } catch (err) {
    console.error('[OUT-ERR]', err && err.message ? err.message : err);
    throw err;
  }
}

/* --- caches & utilities (unchanged) --- */
const callsignCache = new Map();
const routesetCache = new Map();
function cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) { map.delete(key); return null; }
  return e.value;
}
function cacheSet(map, key, value, ttl) {
  map.set(key, { value, expires: Date.now() + ttl });
}
function makeKey(lat, lon, radius) {
  const dec = 3;
  const rlat = (Math.round(lat * (10**dec)) / (10**dec)).toFixed(dec);
  const rlon = (Math.round(lon * (10**dec)) / (10**dec)).toFixed(dec);
  return `${rlat}_${rlon}_${radius}`;
}
const pollers = new Map();
function parallelLimit(items, fn, concurrency = 3) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i], i); } catch (e) { results[i] = { error: e && e.message ? e.message : e }; }
    }
  }
  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  return Promise.all(workers).then(()=>results);
}

/* --- DOC8643 image proxy route --- */
/*
  Purpose: avoid CORS/opaque responses by proxying doc8643 images via the server.
  Caching: 24 hours (public). Logs use rateLimitedFetch so it consumes token budget.
*/
app.get('/api/docimg/:code.jpg', async (req, res) => {
  try {
    const codeRaw = req.params.code || '';
    const code = String(codeRaw).replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
    if (!code) return res.status(400).send('bad code');

    // remote doc8643 URL
    const remote = `https://doc8643.com/static/img/aircraft/large/${encodeURIComponent(code)}.jpg`;

    // fetch via rate limited fetch (so logs & limits apply)
    const r = await rateLimitedFetch(remote, { redirect: 'follow' });

    if (!r.ok) {
      const txt = await (r.text().catch(()=>'')); // try to peek text
      res.status(r.status).type('text/plain').send(`Upstream returned ${r.status}: ${txt.slice ? txt.slice(0,200) : ''}`);
      return;
    }

    // stream bytes back
    const arrayBuffer = await r.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600'); // 24h
    res.send(buf);
  } catch (err) {
    console.error('[docimg proxy] error', err && err.message ? err.message : err);
    res.status(502).send('proxy error');
  }
});

/* --- poller implementation (almost unchanged) --- */
function ensurePoller(key, lat, lon, radius) {
  if (pollers.has(key)) return pollers.get(key);

  const state = {
    subs: new Set(),
    lastOthersFetch: 0,
    cachedOthers: [],
    othersTotal: 0,
    timer: null
  };

  async function fetchCycle() {
    try {
      const closestUrl = `https://api.adsb.lol/v2/closest/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
      const r = await rateLimitedFetch(closestUrl, { headers: { accept: 'application/json' } });
      if (!r.ok) {
        try { const txt = await r.text(); console.warn('[closest] non-ok', r.status, txt && txt.slice ? txt.slice(0,200) : ''); } catch(e){}
        broadcast({ nearest: null, others: state.cachedOthers, othersTotal: state.othersTotal, now: Date.now() });
        return;
      }
      const json = await r.json();
      const nearestRaw = (json.ac && json.ac.length) ? json.ac[0] : null;
      const nearest = sanitizeAircraft(nearestRaw);

      // enrich nearest callsign (cache)
      if (nearest && nearest.flight) {
        const callsignKey = nearest.flight.trim();
        const cached = cacheGet(callsignCache, callsignKey);
        if (cached) {
          mergeNearestWithCallsign(nearest, cached);
        } else {
          try {
            const csUrl = `https://api.adsb.lol/v2/callsign/${encodeURIComponent(callsignKey)}`;
            const csr = await rateLimitedFetch(csUrl, { headers: { accept: 'application/json' } });
            if (csr.ok) {
              const csJson = await csr.json();
              const csAc = (csJson.ac && csJson.ac.length) ? csJson.ac[0] : null;
              if (csAc) {
                cacheSet(callsignCache, callsignKey, csAc, CALLSIGN_TTL);
                mergeNearestWithCallsign(nearest, csAc);
              }
            }
          } catch (e) {}
        }
      }

      // routeset for nearest (cache)
      if (nearest && nearest.flight) {
        const rsKey = nearest.flight.trim();
        const rcached = cacheGet(routesetCache, rsKey);
        if (rcached) {
          mergeNearestWithRouteset(nearest, rcached);
        } else {
          try {
            const rr = await rateLimitedFetch('https://api.adsb.lol/api/0/routeset', {
              method: 'POST',
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify({ planes: [{ callsign: rsKey, lat: nearest.lat || lat, lng: nearest.lon || lon }] })
            });
            if (rr.ok) {
              const rjson = await rr.json();
              if (Array.isArray(rjson) && rjson.length) {
                cacheSet(routesetCache, rsKey, rjson[0], ROUTESET_TTL);
                mergeNearestWithRouteset(nearest, rjson[0]);
              }
            }
          } catch (e) {}
        }
      }

      // --- NEW: attach normalized thumb URL for nearest if we have a type ---
      if (nearest && nearest.type) {
        const code = String(nearest.type).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (code) {
          // use our proxy endpoint so the browser always gets a proxied image (no CORS issues)
          nearest.thumb = `/api/docimg/${code}.jpg`;
        }
      }

      // OTHERS: refresh at most every OTHER_POLL_MS
      const now = Date.now();
      if (!state.lastOthersFetch || (now - state.lastOthersFetch) >= OTHER_POLL_MS) {
        try {
          const pointUrl = `https://api.adsb.lol/v2/point/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}/${encodeURIComponent(radius)}`;
          const pr = await rateLimitedFetch(pointUrl, { headers: { accept: 'application/json' } });
          if (pr.ok) {
            const pjson = await pr.json();
            let arr = [];
            if (pjson.ac && Array.isArray(pjson.ac)) {
              arr = pjson.ac.map(sanitizeAircraft).filter(a => a && a.lat && a.lon);
            }
            state.othersTotal = Array.isArray(pjson.ac) ? pjson.ac.length : arr.length;

            arr.sort((A, B) => {
              const da = (A && A.dst !== undefined && A.dst !== null) ? Number(A.dst) : haversineKm(lat, lon, A.lat, A.lon);
              const db = (B && B.dst !== undefined && B.dst !== null) ? Number(B.dst) : haversineKm(lat, lon, B.lat, B.lon);
              return da - db;
            });

            const filtered = arr.filter(a => !(nearest && a.hex && nearest.hex && a.hex === nearest.hex)).slice(0, OTHERS_LIMIT);
            state.cachedOthers = filtered;
            state.lastOthersFetch = Date.now();

            await enrichOthersCallsAndRoutes(state.cachedOthers, lat, lon);
          } else {
            console.warn('[point] non-ok', pr.status);
          }
        } catch (e) {
          console.warn('[point] fetch failed', e && e.message ? e.message : e);
        }
      }

      broadcast({ nearest, others: state.cachedOthers.slice(0, OTHERS_LIMIT), othersTotal: state.othersTotal, now: json.now || Date.now() });

    } catch (err) {
      console.error('[poller] cycle error', err && err.message ? err.message : err);
      broadcast({ nearest: null, others: state.cachedOthers, othersTotal: state.othersTotal, now: Date.now() });
    }
  }

  function broadcast(payload) {
    for (const s of state.subs) {
      try { s.emit('update', payload); } catch(e) {}
    }
  }

  function mergeNearestWithCallsign(nearest, csAc) {
    if (!nearest || !csAc) return;
    nearest.airline = nearest.airline || csAc.airline || csAc.operator || null;
    nearest.from = nearest.from || csAc.from || csAc.o || csAc.origin || null;
    nearest.to = nearest.to || csAc.to || csAc.d || csAc.destination || null;
    if (csAc.r) nearest.reg = csAc.r;
  }
  function mergeNearestWithRouteset(nearest, route) {
    if (!nearest || !route) return;
    if (route.airline_code) {
      const code = String(route.airline_code).trim().toUpperCase();
      const full = THREE_LETTER_MAP[code] || AIRLINE_MAP[code] || code;
      nearest.airline = `${full} (${code})`;
    }
    if (route._airports && route._airports.length) {
      const a0 = route._airports[0];
      const a1 = route._airports[1] || null;
      if (a0) nearest.from_obj = { city: a0.location, name: a0.name, iata: a0.iata || a0.icao || '', countryiso: a0.countryiso2 || '' };
      if (a1) nearest.to_obj   = { city: a1.location, name: a1.name, iata: a1.iata || a1.icao || '', countryiso: a1.countryiso2 || '' };
    }
  }

  async function enrichOthersCallsAndRoutes(othersArr, baseLat, baseLon) {
    if (!Array.isArray(othersArr) || othersArr.length === 0) return;
    const toFetchCalls = [];
    othersArr.forEach(o => {
      if (o && o.flight) {
        const key = o.flight.trim();
        if (!cacheGet(callsignCache, key)) toFetchCalls.push({ key, o });
        else {
          const csAc = cacheGet(callsignCache, key);
          if (csAc) {
            o.airline = o.airline || csAc.airline || csAc.operator || null;
            o.from = o.from || csAc.from || csAc.o || csAc.origin || null;
            o.to = o.to || csAc.to || csAc.d || csAc.destination || null;
            if (csAc.r) o.reg = o.reg || csAc.r;
          }
        }
      }
    });

    await parallelLimit(toFetchCalls, async (item) => {
      const key = item.key;
      try {
        const csr = await rateLimitedFetch(`https://api.adsb.lol/v2/callsign/${encodeURIComponent(key)}`, { headers: { accept: 'application/json' } });
        if (!csr.ok) return;
        const csjson = await csr.json();
        const csAc = (csjson.ac && csjson.ac.length) ? csjson.ac[0] : null;
        if (csAc) {
          cacheSet(callsignCache, key, csAc, CALLSIGN_TTL);
          const target = othersArr.find(x => x.flight && x.flight.trim() === key);
          if (target) {
            target.airline = target.airline || csAc.airline || csAc.operator || null;
            target.from = target.from || csAc.from || csAc.o || csAc.origin || null;
            target.to = target.to || csAc.to || csAc.d || csAc.destination || null;
            if (csAc.r) target.reg = target.reg || csAc.r;
          }
        }
      } catch (e) {}
    }, ENRICH_CONCURRENCY);

    const toRouteset = othersArr.filter(o => o && o.flight && (!o.from_obj || !o.to_obj));
    if (toRouteset.length) {
      const body = { planes: toRouteset.map(o => ({ callsign: o.flight, lat: o.lat || baseLat, lng: o.lon || baseLon })) };
      try {
        const rr = await rateLimitedFetch('https://api.adsb.lol/api/0/routeset', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (rr.ok) {
          const rjson = await rr.json();
          if (Array.isArray(rjson)) {
            rjson.forEach(route => {
              const callsign = route.callsign;
              const target = othersArr.find(x => x.flight && x.flight.trim() === (callsign || '').trim());
              if (!target) return;
              if (route.airline_code) {
                const code = String(route.airline_code).trim().toUpperCase();
                const full = THREE_LETTER_MAP[code] || AIRLINE_MAP[code] || code;
                target.airline = `${full} (${code})`;
              }
              if (route._airports && route._airports.length) {
                const a0 = route._airports[0]; const a1 = route._airports[1] || null;
                if (a0) target.from_obj = { city: a0.location, name: a0.name, iata: a0.iata || a0.icao || '', countryiso: a0.countryiso2 || '' };
                if (a1) target.to_obj   = { city: a1.location, name: a1.name, iata: a1.iata || a1.icao || '', countryiso: a1.countryiso2 || '' };
              }
              if (route && route.callsign) cacheSet(routesetCache, route.callsign, route, ROUTESET_TTL);
            });
          }
        }
      } catch (e) {}
    }
  }

  state.timer = setInterval(fetchCycle, POLL_MS);
  fetchCycle().catch(()=>{});
  pollers.set(key, state);
  return state;
}

function maybeCleanupPoller(key) {
  const p = pollers.get(key);
  if (!p) return;
  if (!p.subs || p.subs.size === 0) {
    clearInterval(p.timer);
    pollers.delete(key);
    console.log('[poller] stopped and removed key=', key);
  }
}

const socketToKey = new Map();

io.on('connection', socket => {
  console.log('[socket] connect', socket.id);

  socket.on('subscribe', async (opts = {}) => {
    const clientLat = toNumber(opts.lat);
    const clientLon = toNumber(opts.lon);
    const lat = (OVERRIDE_LAT !== null) ? OVERRIDE_LAT : (clientLat !== null ? clientLat : DEFAULT_LAT);
    const lon = (OVERRIDE_LON !== null) ? OVERRIDE_LON : (clientLon !== null ? clientLon : DEFAULT_LON);
    const radius = opts.radius || DEFAULT_RADIUS;
    const key = makeKey(lat, lon, radius);

    const oldKey = socketToKey.get(socket.id);
    if (oldKey && oldKey !== key) {
      const oldPoll = pollers.get(oldKey);
      if (oldPoll) {
        oldPoll.subs.delete(socket);
        maybeCleanupPoller(oldKey);
      }
      socketToKey.delete(socket.id);
    }

    const poller = ensurePoller(key, lat, lon, radius);
    poller.subs.add(socket);
    socketToKey.set(socket.id, key);

    const payload = {
      nearest: null,
      others: poller.cachedOthers || [],
      othersTotal: poller.othersTotal || 0,
      now: Date.now()
    };
    socket.emit('update', payload);

    console.log(`[socket] ${socket.id} subscribed -> key=${key}`);
  });

  socket.on('unsubscribe', () => {
    const k = socketToKey.get(socket.id);
    if (!k) return;
    const p = pollers.get(k);
    if (p) {
      p.subs.delete(socket);
      maybeCleanupPoller(k);
    }
    socketToKey.delete(socket.id);
    console.log(`[socket] ${socket.id} unsubscribed from ${k}`);
  });

  socket.on('disconnect', () => {
    const k = socketToKey.get(socket.id);
    if (k) {
      const p = pollers.get(k);
      if (p) {
        p.subs.delete(socket);
        maybeCleanupPoller(k);
      }
      socketToKey.delete(socket.id);
    }
    console.log('[socket] disconnect', socket.id);
  });
});

app.get('/__debug/pollers', (req, res) => {
  const info = {};
  for (const [k, st] of pollers.entries()) {
    info[k] = { subs: st.subs.size, lastOthersFetch: st.lastOthersFetch, cachedOthers: st.cachedOthers.length, othersTotal: st.othersTotal };
  }
  res.json({ pollers: info, tokens: { capacity: bucket.capacity, tokens: bucket.tokens } });
});

/* Serve static and SPA fallback (after API routes above) */
app.use(express.static(path.join(__dirname, 'client', 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html')));

server.listen(PORT, () => {
  console.log(`Server listening on ${PORT}. POLL_MS=${POLL_MS} OTHER_POLL_MS=${OTHER_POLL_MS} OTHERS_LIMIT=${OTHERS_LIMIT} MAX_REQS_PER_MIN=${MAX_REQUESTS_PER_MIN}`);
});
