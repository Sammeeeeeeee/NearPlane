# Near-Plane

Minimal single-container app that shows the **nearest aircraft** to the user's location in realtime. Server polls `adsb.lol` and proxies data to clients over Socket.IO. Client is React + Vite + Leaflet.

## Features
- Nearest aircraft details (callsign, registration, type, alt, speed in mph, heading, From / To airports and airline/operator)
- Aircraft thumbnail 
- Map showing user location (blue dot) and other nearby aircraft (smaller markers)
- Poll intervals and limits configurable via environment variables
- Per-location poller: single server poller per distinct lat/lon/radius key (prevents duplication)
- Request token bucket to avoid spamming third-party APIs
- Light/Dark mode

## Environment Variables

| Environment Variable | Description                                                                 | Required | Default |
|-----------------------|-----------------------------------------------------------------------------|----------|---------|
| `POLL_MS`            | Interval in milliseconds between fetching nearest aircraft data (primary poll rate) | ❌       | `5000`  |
| `OTHER_POLL_MS`      | Interval in milliseconds between fetching other aircraft data             | ❌       | `20000` |
| `OTHERS_LIMIT`       | Maximum number of nearby aircraft to display (heavy on API)                               | ❌       | `10`    |
| `MAX_REQS_PER_MIN`   | Throttle limit for API requests per minute                                  | ❌       | `60`    |
| `API_URL`            | Base URL of the ADS-B API                    | ❌       | `https://api.adsb.lol`|
| `LAT`                | Default latitude to center the map if user position is unavailable          | ❌       | `51.456121` |
| `LON`                | Default longitude to center the map if user position is unavailable         | ❌       | `-0.384506` |
| `PORT`               | Port for the server to listen on                                            | ❌       | `80`    |
| `NODE_ENV`           | Node.js environment (`development` or `production`)                        | ❌       | `production` |
| `USE_THUMBNAILS`     | Enable DOC8643 thumbnail lookups (`true` or `false`)                       | ❌       | `true` |


## Sample Docker Compose
```yaml
services:
  nearplane:
    image: sammeeeee/near-plane:latest
    container_name: nearplane
    restart: always
    ports:
      - "80:80"
    environment:
      PORT: 80
```

## Build & Run (Docker)
```bash
docker build -t nearest-plane:latest .
docker run -p 80:80 --name nearest-plane  nearest-plane:latest
  ```

