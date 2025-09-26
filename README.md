# NearPlane ✈️

Minimal single-container app that shows the **nearest aircraft** to the user's location in realtime. Server polls `adsb.lol` and proxies data to clients over Socket.IO. Client is React + Vite + Leaflet.


<div align="center">

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/cfc3c1fe-abfd-4645-b02c-47188bbd58fa" alt="image" height="400"></td>
    <td><img src="https://github.com/user-attachments/assets/a67a0072-3529-4876-b97d-4d6672ff82e9" alt="image" height="400"></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/507f013f-5975-4856-ada5-3d428c5521aa" alt="image" height="400"></td>
    <td><img src="https://github.com/user-attachments/assets/eb6c88f3-9fa7-4f89-8e01-d2d32b6339a8" alt="image" height="400"></td>
  </tr>
</table>

</div>


## Features
- Nearest aircraft details (callsign, registration, type, alt, speed in mph, heading, From / To airports and airline/operator)
- Aircraft thumbnail 
- Map showing user location and other nearby aircraft (smaller markers)
- Poll intervals and limits configurable via environment variables
- Per-location poller: single server poller per distinct lat/lon/radius key (prevents duplication)
- Request token bucket to avoid spamming third-party APIs
- Light/Dark mode
- Expandeble section with the other nearest aircraft
- Colour change on aircraft in emergancy

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

## Architecture & key files

- `server.js` - main Node/Express server:
	- Creates pollers keyed by (lat,lon,radius).
	- Uses rateLimitedFetch (token bucket) for outbound requests.
	- Caches callsign results and routeset POST responses (TTL configurable).
	- Loads external CSVs (airline map, ICAOList) at startup for enrichment.
	- Exposes `/api/docimg/:code.jpg` that proxies to `doc8643.com` for thumbnails.
	- Serves the client SPA from `client/dist/`.
	- Socket.IO: on subscribe server adds socket to poller; poller broadcast emits update payloads.
- `client/` - React + Vite client
- `src/App.jsx` - main UI, socket connecting/subscribing, status dot, theme switch, left panel.
- `src/MapPlane.jsx` - Leaflet map and animated markers, interpolation/extrapolation logic.
- `src/style.css` - theming, layout and responsive styles.
- `dockerfile` - multi-stage Docker build (build client, then runtime image).
- `.github/workflows/build-publish.yml` - CI workflow to build/publish Docker images.

## Notes
> [!WARNING]  
>This was mostly coded by an LLM. It purpose was for me to get acquainted with this tech stack for work, and I thought it was a cool project. I have no clue what half the code does, and for all I know or care it may set your house on fire. It works for me, and achieved its objectives. 

### Contribution
Feel free to open any pull requests. 

### Security
IDK. Probably not secure (although images are scanned before pushing to dockerhub by Trivy, Trufflehog and Docker Scout CVE scanning). 

### Production
I run in a docker container inside a rootless LXC based on `Ubuntu Server 25.04`, which uses around 165 MiB of RAM, with less then 1 GiB bootsize, and barely any CPU. YMMV.

## 🙏 Credits

| Resource | Purpose | Link |
|----------|---------|------|
| **adsb.lol API** | Provides nearest and nearby aircraft data | [https://adsb.lol](https://adsb.lol) |
| **DOC8643 Aircraft Database** | Aircraft type codes and thumbnail images | [https://doc8643.com](https://doc8643.com) |
| **Airline Codes CSV (IATA/ICAO)** | Airline/operator name lookups from codes | https://raw.githubusercontent.com/rikgale/ICAOList/refs/heads/main/Airlines.csv |
| **ICAO Aircraft Types CSV** | Mapping ICAO aircraft codes to names & models | https://gist.githubusercontent.com/AndreiCalazans/390e82a1c3edff852137cb3da813eceb/raw/1a1248f966b3f644f4eae057ad9b9b1b571c6aec/airlines.json |
| **OpenStreetMap / OSM Tiles** | Map tile rendering in Leaflet | [https://www.openstreetmap.org](https://www.openstreetmap.org) |
| **Leaflet** | Interactive mapping library for the web | [https://leafletjs.com](https://leafletjs.com) |
| **React + Vite** | Frontend framework & bundler for client app | [https://react.dev](https://react.dev) / [https://vitejs.dev](https://vitejs.dev) |
| **Socket.IO** | Real-time bidirectional communication (server ↔ client) | [https://socket.io](https://socket.io) |
