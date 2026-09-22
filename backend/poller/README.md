# OLT / RADIUS poller

A small standalone service that keeps `backend/data.json` (or, once you've
done Phase 1 of `ROADMAP.md`, your real database) in sync with what's
actually happening on your network. It runs on a timer, asks an
"adapter" for current ONU state, and pushes only what changed to the
backend's internal ingest endpoint.

```
run-poller.js  →  POST /api/internal/onu-status  →  data.json  →  every GET /api/... endpoint sees the update
```

## Try it right now (mock mode, zero setup)

```bash
# Terminal 1
cd backend
node server.js

# Terminal 2
cd backend
node poller/run-poller.js
```

You'll see log lines like:
```
[poller] 2026-09-20T10:04:30.100Z - pushed 6 update(s), backend applied 6
```

Mock mode reads whatever ONUs currently exist in the backend, nudges
their RX power slightly, and occasionally flips one to Power Off/Wire
Down/back Online — purely so you can watch `live-map.html` and
`topology.html` reflect "live" changes without any real hardware. Refresh
either page after a poll cycle and the numbers will have moved.

## Switching to real data

You need two things, and they're independent of each other — set up
whichever one applies to you (most people need both eventually):

### 1. OLT status via SNMP (or HTTP scrape)
Edit `snmp-adapter.js`. It's a documented stub — the comments walk
through what to install (`net-snmp` or similar) and where your OLT
vendor's actual OIDs go. If your OLT doesn't support SNMP, replace the
body of `poll()` with an HTTP request + HTML/JSON parsing of its web UI
instead (the return shape `run-poller.js` expects stays the same either
way).

Then run with:
```bash
ISP_POLLER_MODE=snmp OLT_HOST=10.10.0.1 OLT_SNMP_COMMUNITY=public node poller/run-poller.js
```

### 2. RADIUS session/usage data
Edit `radius-adapter.js`. It's written against FreeRADIUS's standard
`radacct` accounting table (works for most RADIUS setups with light
changes to the SQL). Install `mysql2` or `pg` depending on your DB.

Then run with:
```bash
ISP_POLLER_MODE=radius RADIUS_DB_HOST=127.0.0.1 RADIUS_DB_USER=... RADIUS_DB_PASSWORD=... node poller/run-poller.js
```

### Running both
Real deployments typically run two poller processes (one per mode) so an
SNMP timeout doesn't block RADIUS updates or vice versa — just start
`run-poller.js` twice with different `ISP_POLLER_MODE` values, ideally
under a process manager (`pm2`, `systemd`, or a Docker Compose service
each) rather than a bare terminal.

## Config reference

| Env var                | Default                              | Used by |
|--------------------------|---------------------------------------|---------|
| `ISP_BACKEND_URL`        | `http://localhost:5000`               | run-poller.js |
| `ISP_INTERNAL_KEY`       | `isp-saviour-internal-demo-key`       | run-poller.js + server.js (must match!) |
| `ISP_POLL_INTERVAL_MS`   | `30000`                               | run-poller.js |
| `ISP_POLLER_MODE`        | `mock`                                | run-poller.js |
| `OLT_HOST`, `OLT_SNMP_COMMUNITY` | -                             | snmp-adapter.js |
| `RADIUS_DB_HOST`, `RADIUS_DB_USER`, `RADIUS_DB_PASSWORD`, `RADIUS_DB_NAME` | - | radius-adapter.js |

**Important:** `ISP_INTERNAL_KEY` must match between the poller and
`backend/server.js` (it defaults to the same demo value in both, but
change it — to a real secret, passed via environment variable — before
running this anywhere but your own laptop).
