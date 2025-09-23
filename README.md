# Nearest Plane — Realtime (Socket.IO)

Single-container app that shows the nearest aircraft to your browser location using `adsb.lol`.

## Build & run with Docker

1. Build image:

```bash
docker build -t nearest-plane:latest .
```

2. Run (example):

```bash
docker run -p 3000:3000 \
  -e PORT=3000 \
  nearest-plane:latest
```

3. Open `http://localhost:3000` in your browser.