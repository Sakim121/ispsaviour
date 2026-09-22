# ISP SAVIOUR 2.0 — Prototype + Demo Backend

This folder contains a click-through prototype of the ISP network
management dashboard (built to match the reference screenshots) **plus a
small working backend** that a few of the pages already talk to over a
real REST API. It's still demo data (see `ROADMAP.md` for the path to a
production system with real OLT/RADIUS integration), but the frontend ↔
backend wiring itself is real, not mocked.

## What's wired to the backend right now
- `dashboard.html` — ONU Search calls `GET /api/onus/search`
- `live-offline-onus.html` — Refresh calls `GET /api/offline-onus`
- `manage-onus.html` — "Yes, Add" calls `POST /api/onus`
- `fiber-paths.html` — "Save Fiber Path" calls `POST /api/fiber-paths`
- `topology.html` — Load / PON dropdown calls `GET /api/onus?pon_id=` and
  builds the tree from real ONU rows (the `teja`/`munwar`/`kanwarbasha`
  cluster now comes straight from `backend/data.json`, not a hard-coded
  JS object)
- `live-map.html` — loads PON 3's ONUs via `GET /api/onus?pon_id=3` and
  `GET /api/onus/:id/rx-history`, and builds markers/popups from that

Every one of these pages falls back to local demo data (with a visible
warning) if the backend isn't running, so the prototype still works
stand-alone if you just want to look at the UI.

## Pages

| File                     | Screen                                                              |
|---------------------------|----------------------------------------------------------------------|
| `dashboard.html`          | Home — welcome, network summary, ONU search                         |
| `live-offline-onus.html`  | Live → Offline ONUs table (per-PON breakdown)                       |
| `live-map.html`           | Live → Map — satellite map, ONU/JB markers, status popups           |
| `topology.html`           | OLT/PON topology tree — zoom, pan, click node, path steps           |
| `manage-onus.html`        | ISP SAVIOUR 2.0 shell — Manage ONUs (View/Add/Edit/Delete + modals) |
| `fiber-paths.html`        | Add Fiber Path — form + click-to-draw path on the map               |

`index.html` just redirects to `dashboard.html`.

## Logging in

`login.html` is now the front door — every other page redirects there if
you're not logged in (via `auth.js`). Three demo accounts are seeded the
first time the backend starts:

| Email                | Password       | Role       | Can do |
|-----------------------|----------------|------------|--------|
| admin@isp.local       | admin123       | admin      | everything |
| engineer@isp.local    | engineer123    | engineer   | add/edit ONUs, save fiber paths |
| viewer@isp.local      | viewer123      | viewer     | read-only — Add/Edit/Delete controls are disabled, and write endpoints reject viewer tokens with 403 even if someone bypasses the UI |

Sessions are stored in the browser's `localStorage` and expire after 8
hours. Click "Logout" in the top nav (or clear `localStorage`) to sign
out.

## Settings — configure everything from the UI

Log in as **admin** and open **⚙ Settings** (top nav, or
`settings.html` directly). Everything that used to require editing files
or setting environment variables is now a form:

- **Enable live polling** — a toggle. When on, the backend itself runs a
  poll cycle on a timer (no second terminal, no `run-poller.js` needed
  unless you want the standalone-service architecture instead).
- **Data source** — Mock / Real OLT (SNMP) / Real RADIUS DB.
- **Poll interval**.
- **OLT connection fields** (IP, SNMP community, SNMP version) and a
  **Test OLT connection** button.
- **RADIUS DB fields** (host, db name, user, password) and a
  **Test RADIUS connection** button.
- A live status box showing whether the poller is running, when it last
  ran, and what happened.

Saving immediately restarts the in-process poller with the new settings
— nothing to restart manually. Settings are stored in
`backend/data.json` under the `settings` key, so they persist across
restarts. Only the `admin` account can see or change this page.

**Note on SNMP/RADIUS:** the *fields and toggle* are fully wired and
saved — the actual network call to a real OLT/RADIUS system depends on
`backend/poller/snmp-adapter.js` and `radius-adapter.js`, which are
documented stubs (see `backend/poller/README.md`). Until you fill those
in, choosing "Real OLT" or "Real RADIUS DB" as the data source will show
a clear error in the status box and Test Connection button rather than
silently doing nothing.

## Connecting Supabase (optional)

Also in **⚙ Settings**, there's a "Database (Supabase)" card:

1. Create a project at [supabase.com](https://supabase.com) if you haven't.
2. In your Supabase project: **SQL Editor → New query**, paste the
   contents of `backend/supabase/schema.sql`, and run it once. This
   creates all the tables (`olts`, `pons`, `onus`, `rx_history`,
   `fiber_paths`, `landmarks`) with the exact same demo data you already
   see in the app, so nothing changes visually when you switch over.
3. In Supabase: **Project Settings → API**, copy the **Project URL** and
   the **service_role** key (not the `anon` key — service_role bypasses
   Row Level Security, which is what lets the backend read/write; RLS is
   enabled with no public policies, so the browser-facing `anon` key
   can't touch this data even if it leaked).
4. Paste both into Settings, click **Test Supabase connection**, then
   toggle **Use Supabase for storage** on and **Save settings**.

From that point on, `GET/POST/PUT/DELETE /api/onus*` and RX history read
and write straight to your Supabase Postgres database instead of
`backend/data.json` — this includes the ONU search, offline-ONUs list,
topology viewer, live map, manage-ONUs Add flow, and the poller. OLTs,
PONs, fiber paths, and landmarks stay in `data.json` for now (see
`ROADMAP.md` if you want to move those too — the same `dbXxx()` pattern
in `server.js` extends cleanly).

Toggle it back off any time to fall back to the local file — your
Supabase data stays untouched, ready to switch back to.

## Running it locally

You need **two things running at once**: the backend API and a static
file server for the HTML pages. Open two terminals.

### 1. Start the backend (Terminal 1)

Zero npm dependencies — just plain Node.js (v14+):

```bash
cd isp-project/backend
node server.js
```

You should see:
```
ISP SAVIOUR 2.0 demo backend running at http://localhost:5000
```

Leave this running. It stores data in `backend/data.json` and writes back
to that file whenever you add an ONU or save a fiber path, so your test
data survives a restart. Delete `data.json`'s contents and re-copy the
seed data if you want to reset it.

### 2. Start the frontend (Terminal 2)

The map pages (`live-map.html`, `manage-onus.html`, `fiber-paths.html`)
also load satellite tiles and the Leaflet library from the internet, so
you need an internet connection, and it's best to serve the files over
`http://` instead of opening them directly as `file://`.

**Easiest way — Python (already on most machines):**

```bash
cd isp-project
python3 -m http.server 8000
```

Then open **http://localhost:8000/login.html** in your browser.

### 3. (Optional) Start the standalone poller terminal

You usually **don't need this anymore** — see "Settings" above: toggle
"Enable live polling" in the UI and the backend polls itself on a timer,
no extra terminal required.

Run `poller/run-poller.js` separately only if you want the
poller running as its own process (e.g. for a real production deployment
where you'd rather the OLT/RADIUS polling survive an API server restart,
or run on a different schedule/machine):

```bash
cd isp-project/backend
node poller/run-poller.js
```

Full details, including how to point it at a real OLT/RADIUS system
instead of mock data, are in `backend/poller/README.md`.

**Alternative — Node.js:**

```bash
npx serve isp-project
```

**Alternative — VS Code:** install the "Live Server" extension, right-click
`dashboard.html` → "Open with Live Server".

## What's real vs. mock right now

- **Real:** all six pages now call the actual HTTP API
  (`backend/server.js`) which reads/writes `backend/data.json` on disk —
  data you add really persists across restarts. `topology.html` and
  `live-map.html` degrade gracefully to local demo data with an on-screen
  warning if the backend isn't reachable.
- **Still demo data:** the *content* of that data (ONU names, MACs, RX
  power, RADIUS usage) is hand-seeded, not pulled from a real OLT or
  RADIUS server. There's no splitter/junction-box hierarchy modeled yet —
  `topology.html` groups all of a PON's real ONUs under one splitter
  node, and `live-map.html`'s fiber lines/JB markers are drawn as a
  simple decorative backbone rather than real topology.
- Map markers and satellite imagery are real (Esri World Imagery via
  Leaflet), but the ONU coordinates in `data.json` are placeholder points,
  not your real network.
- There is no login/auth yet, and no real OLT/RADIUS connection.

See `ROADMAP.md` for the path from here to a production system — phases 1
and 2 (schema + REST API) are effectively started for you already in
`backend/`.
