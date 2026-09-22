# Roadmap — from prototype to production

> **Status:** Phases 1 and 2 below are now partially done for you — see
> `backend/server.js` and `backend/data.json`. It's a plain Node.js server
> (no framework, no external DB) with in-memory-plus-JSON-file storage and
> working endpoints for ONUs, offline ONUs, search, RX history, and fiber
> paths. **All six frontend pages** now call it (with a graceful local-demo
> fallback if it's not running). Treat it as a working reference
> implementation to replace piece-by-piece (e.g. swap the JSON file for
> real Postgres) rather than a finished backend — there's still no
> splitter/junction-box hierarchy modeled, and no real OLT/RADIUS
> connection yet.
>
> **Update:** Phase 3 (auth) below is now also implemented — see
> `login.html`, `auth.js`, and the `/api/auth/*` routes + role checks in
> `backend/server.js`. Tokens are simple HMAC-signed strings (not full JWT)
> with an 8-hour expiry, verified server-side on every write. Passwords
> are hashed with `pbkdf2` (no plaintext storage). This is a solid
> pattern for a real system, but swap `TOKEN_SECRET` in `server.js` for
> an environment variable before ever deploying this anywhere public.
>
> **Update:** Phase 4 (OLT/RADIUS integration) now has a working scaffold
> too — see `backend/poller/`. `run-poller.js` + the new
> `POST /api/internal/onu-status` endpoint in `server.js` are real and
> tested (mock mode actually pushes live updates into `data.json` right
> now). The poller can also now run **in-process**, controlled entirely
> from `settings.html` (enable/disable, choose data source, set OLT/RADIUS
> connection details, test the connection) — no terminal needed for that
> part either. `snmp-adapter.js` and `radius-adapter.js` are documented
> stubs — the one part of this whole project that genuinely can't be
> finished without your actual OLT/RADIUS credentials and vendor MIBs,
> since I have no hardware to test against. See `backend/poller/README.md`.

The six pages in this folder are a **visual + interaction prototype**.
Below is a practical order to turn this into a real, backend-connected ISP
management system. Each phase is meant to be shippable on its own — you
don't need to finish one phase 100% before starting the next.

## Phase 1 — Data model & database ✅ done (for ONUs + RX history)

> **Update:** you can now connect a real Postgres database (via Supabase)
> entirely from the Settings UI — see `backend/supabase/schema.sql` and
> the README's "Connecting Supabase" section. ONU CRUD, search,
> offline-ONU grouping, and RX power history all read/write straight to
> Supabase when enabled. OLTs, PONs, fiber paths, and landmarks are not
> moved over yet — they're smaller, more static tables, and lower
> priority than getting live ONU data onto real Postgres first.
Stand up Postgres (or MySQL) and create tables for the entities the UI
already assumes:
- `olt` (id, name, ip_address, location, status)
- `pon` (id, olt_id, name, port, output_power, status)
- `splitter` (id, parent_id, type, ratio, input_port, output_ports, loss)
- `onu` (id, name, onu_id, pon_id, splitter_id, port, mac, status,
  distance, rx_power, est_power, latitude, longitude, connected_at,
  disconnected_at, reason, download_usage, upload_usage, notes)
- `rx_power_history` (onu_id, timestamp, rx_power)
- `fiber_path` (id, name, olt_id, pon_id, color, style, width, offset,
  coordinates[], fiber_company, fiber_type, batch_no, fiber_year,
  installed_by, comments)
- `landmark` (id, name, latitude, longitude, type)
- `radius_user` (username, account_status, ip_address, mac, logged_in_at,
  download, upload)
- `user_account` (id, email, password_hash, role: admin/engineer/viewer)

**Why first:** every later phase (API, real-time, auth) reads/writes these
tables, so getting the shape right early avoids rework.

## Phase 2 — REST API layer
Build endpoints the existing pages can call instead of using hard-coded
JS arrays:
- `GET /api/olts`, `GET /api/olts/:id/pons`
- `GET /api/onus?pon_id=`, `GET /api/onus/:id`, `GET /api/onus/search?q=`
- `GET /api/onus/:id/rx-history`
- `POST /api/onus` (add), `PUT /api/onus/:id` (edit), `DELETE /api/onus/:id`
- `GET /api/offline-onus?olt_id=`
- `GET /api/topology?olt_id=&pon_id=`
- `GET/POST /api/fiber-paths`
- `GET /api/landmarks`

Any backend stack works (Node/Express, Python/FastAPI, PHP/Laravel — match
whatever your team already knows). Keep responses in the same shape the
front-end mock data already uses, so swapping the JS from "hard-coded
array" to "fetch this endpoint" is a small diff per page.

## Phase 3 — Authentication & roles ✅ done (demo-grade)
- Login page + session/JWT.
- Role-based access: Admin (full CRUD), Network Engineer (edit ONUs/fiber
  paths, no user management), Viewer (read-only — hide Add/Edit/Delete
  controls on `manage-onus.html`).
- Never send RADIUS secrets, SNMP community strings, or OLT passwords to
  the frontend — those stay server-side only.

## Phase 4 — Real OLT & RADIUS integration 🚧 scaffold done, needs your credentials
This is the part that replaces demo numbers with reality:
- **OLT status:** most GPON/EPON OLTs expose either an SNMP interface or a
  scrapeable web UI. Write a backend poller that logs into the OLT
  (SNMP/telnet/HTTP, per your OLT vendor) on a schedule (e.g. every
  30–60s), parses ONU status/RX power/distance, and writes it into the
  `onu` and `rx_power_history` tables.
- **RADIUS data:** if you're on FreeRADIUS/IconRadius, query its
  accounting tables (or its API, if it has one) for username, session
  status, IP, data usage — write into `radius_user`.
- Keep the poller as a separate background service/cron job, not inside
  the web request path.

## Phase 5 — Real-time updates
Once the poller in Phase 4 is writing fresh data every 30–60s:
- Add WebSocket or Server-Sent Events so `live-map.html` and
  `live-offline-onus.html` update without a manual refresh.
- Push only deltas (status changed, new RX reading) rather than the full
  dataset each time.

## Phase 6 — Persistence for map-based editing
- `manage-onus.html`'s Add/Edit/Delete flow should call the Phase 2 ONU
  endpoints instead of just adding a marker in memory.
- `fiber-paths.html`'s "Save Fiber Path" should POST the clicked point
  sequence + metadata to `/api/fiber-paths`.
- `topology.html`'s "Edit Port" / "Unlink from Parent" buttons should call
  matching PUT/DELETE endpoints.

## Phase 7 — Security & hardening
- HTTPS everywhere (Let's Encrypt is fine for a single server).
- Rate-limit login and search endpoints.
- Input validation on every write endpoint (especially fiber path
  coordinates and ONU GPS, which are user-clicked).
- Audit log for who added/edited/deleted what.

## Phase 8 — Deployment
- Containerize (Docker) the API + poller; keep Postgres as a managed
  service or its own container with a volume.
- Reverse proxy (nginx/Caddy) in front of the API + static files.
- `docker-compose.yml` for local dev, then move to your actual server/VPS.
- Point your domain at it, enable HTTPS, and you're live.

---

### Suggested order if you have limited time
1. Phase 1 (schema) + Phase 2 (API) — get real CRUD working, even with
   data you enter by hand.
2. Phase 3 (auth) — don't launch without at least basic login.
3. Phase 4 (OLT/RADIUS polling) — this is the actual hard part; budget the
   most time here since it depends on your specific OLT hardware.
4. Phase 5–8 as time allows — real-time push, hardening, and deployment
   can follow once the core data is flowing correctly.
