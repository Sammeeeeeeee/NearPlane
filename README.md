# Near-Plane

Minimal single-container app that shows the **nearest aircraft** to the user's location in realtime. Server polls `adsb.lol` and proxies data to clients over Socket.IO. Client is React + Vite + Leaflet.

## Features
- Nearest aircraft details (callsign, registration, type, alt, speed in mph, heading)
- From / To airports and airline/operator (via `routeset` + airlines gist)
- Aircraft thumbnail lookup (airport-data) with caching
- Map showing user location (blue dot) and other nearby aircraft (smaller markers)
- Poll intervals and limits configurable via environment variables
- Per-location poller: single server poller per distinct lat/lon/radius key (prevents duplication)
- Request token bucket to avoid spamming third-party APIs


## Build & Run (Docker)
```bash
docker build -t nearest-plane:latest .
docker run -p 3000:3000 --name nearest-plane \
  -e PORT=3000 \
  -e POLL_MS=5000 \
  -e OTHER_POLL_MS=20000 \
  -e OTHERS_LIMIT=10 \
  nearest-plane:latest
  ```

Then open http://localhost:3000.
Important env vars

    PORT — server port (default 3000)

    DEFAULT_LAT, DEFAULT_LON — fallback location when browser geolocation unavailable

    OVERRIDE_LAT, OVERRIDE_LON — if set, server will override browser location

    POLL_MS — nearest-plane poll interval (ms) default 5000

    OTHER_POLL_MS — point/other-planes poll interval (ms) default 20000

    OTHERS_LIMIT — how many other planes to keep/display (default 10)

    MAX_REQUESTS_PER_MIN — token bucket for outbound API requests (default 60)

    USE_THUMBNAILS — true/false to enable airport-data thumbnail lookups (default true)

    THUMB_TTL_MS — thumbnail cache TTL in ms (default 6 hours)

Debug endpoints

    GET /__debug/pollers — returns active pollers, subscribers, cached others count and token bucket state.

Outbound API calls summary (what the server does)

For each poller (unique lat/lon/radius):

    Every POLL_MS:

        GET /v2/closest/{lat}/{lon}/{radius} — nearest plane

        If nearest has callsign: GET /v2/callsign/{callsign} (cached)

        If nearest missing route info: POST /api/0/routeset with single plane (cached)

        Thumbnail lookup for nearest: GET airport-data ac_thumb.json?m={HEX}&n=1 (cached)

    Every OTHER_POLL_MS:

        GET /v2/point/{lat}/{lon}/{radius} — returns all aircraft in area

        For up to OTHERS_LIMIT others:

            GET /v2/callsign/{callsign} (cached)

        One batch POST /api/0/routeset for up to OTHERS_LIMIT callsigns (cached)

    All outbound requests go through a token bucket limited to MAX_REQUESTS_PER_MIN.

 