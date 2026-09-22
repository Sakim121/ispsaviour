// ISP SAVIOUR 2.0 - demo backend
// Zero npm dependencies - runs with plain `node server.js`.
// Stores data in data.json (loaded at startup, saved after every write).

const http = require('http');
const { traceFault } = require('./faultTracer');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 5000;
const TOKEN_SECRET = process.env.ISP_TOKEN_SECRET || 'isp-saviour-demo-secret-change-me'; // demo only - set ISP_TOKEN_SECRET in production
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const INTERNAL_KEY = process.env.ISP_INTERNAL_KEY || 'isp-saviour-internal-demo-key'; // shared secret for the poller service -> this API
const ALLOWED_ORIGIN = process.env.ISP_ALLOWED_ORIGIN || '*'; // set to your production frontend URL, e.g. https://yourapp.com

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

// ---- password hashing (pbkdf2, no external deps) ----
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

// ---- lightweight signed tokens (HMAC, not full JWT, zero deps) ----
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}
function getAuth(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return verifyToken(token);
}

// seed demo users the first time (plain-text demo passwords, hashed at rest)
if (!db.users) {
  db.users = [
    Object.assign({ id: 1, email: 'admin@isp.local', role: 'admin' }, hashPassword('admin123')),
    Object.assign({ id: 2, email: 'engineer@isp.local', role: 'engineer' }, hashPassword('engineer123')),
    Object.assign({ id: 3, email: 'viewer@isp.local', role: 'viewer' }, hashPassword('viewer123'))
  ];
  saveData(db);
}

// seed default settings the first time
if (!db.settings) {
  db.settings = {
    poller_enabled: false,
    poller_mode: 'mock',       // 'mock' | 'snmp' | 'radius'
    poll_interval_ms: 30000,
    olt: { host: '', snmp_community: 'public', snmp_version: '2c' },
    radius: { host: '', user: '', password: '', db_name: '' },
    supabase: { enabled: false, url: '', key: '' }
  };
  saveData(db);
}
// migrate older data.json files that predate the supabase field
if (!db.settings.supabase) {
  db.settings.supabase = { enabled: false, url: '', key: '' };
  saveData(db);
}

// ---- Supabase data layer (optional - falls back to local data.json when disabled) ----
// Uses Supabase's PostgREST API directly over fetch() - no npm client library
// needed. Table/column names must match backend/supabase/schema.sql.
function useSupabase() {
  const s = db.settings.supabase;
  return !!(s && s.enabled && s.url && s.key);
}
function supabaseConfig() {
  const s = db.settings.supabase || {};
  return { url: (s.url || '').replace(/\/+$/, ''), key: s.key || '' };
}
async function supabaseFetch(pathAndQuery, opts) {
  const { url, key } = supabaseConfig();
  if (!url || !key) throw new Error('Supabase URL and key are not set - configure them in Settings');
  opts = opts || {};
  const headers = Object.assign({
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Content-Type': 'application/json'
  }, opts.headers || {});
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, Object.assign({}, opts, { headers }));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) {
    const msg = (body && body.message) ? body.message : (typeof body === 'string' ? body : res.statusText);
    throw new Error(`Supabase error (${res.status}): ${msg}`);
  }
  return body;
}

async function dbGetOnus(filters) {
  filters = filters || {};
  if (useSupabase()) {
    const params = ['select=*'];
    if (filters.pon_id) params.push('pon_id=eq.' + filters.pon_id);
    if (filters.status) params.push('status=eq.' + encodeURIComponent(filters.status));
    return await supabaseFetch('onus?' + params.join('&'));
  }
  let list = db.onus;
  if (filters.pon_id) list = list.filter(o => o.pon_id === Number(filters.pon_id));
  if (filters.status) list = list.filter(o => o.status === filters.status);
  return list;
}
async function dbSearchOnus(q) {
  if (useSupabase()) {
    return await supabaseFetch(`onus?name=ilike.*${encodeURIComponent(q)}*&select=*`);
  }
  return db.onus.filter(o => o.name.toLowerCase().includes(q.toLowerCase()));
}
async function dbGetOnuById(id) {
  if (useSupabase()) {
    const rows = await supabaseFetch(`onus?id=eq.${id}&select=*`);
    return rows[0] || null;
  }
  return db.onus.find(o => o.id === Number(id)) || null;
}
async function dbCreateOnu(data) {
  if (useSupabase()) {
    const rows = await supabaseFetch('onus', {
      method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(data)
    });
    return rows[0];
  }
  const newOnu = Object.assign({ id: db.next_onu_id++ }, data);
  db.onus.push(newOnu);
  saveData(db);
  return newOnu;
}
async function dbUpdateOnu(id, patch) {
  if (useSupabase()) {
    const rows = await supabaseFetch(`onus?id=eq.${id}`, {
      method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(patch)
    });
    return rows[0] || null;
  }
  const idx = db.onus.findIndex(o => o.id === Number(id));
  if (idx === -1) return null;
  db.onus[idx] = Object.assign({}, db.onus[idx], patch);
  saveData(db);
  return db.onus[idx];
}
async function dbDeleteOnu(id) {
  if (useSupabase()) {
    await supabaseFetch(`onus?id=eq.${id}`, { method: 'DELETE' });
    return true;
  }
  const idx = db.onus.findIndex(o => o.id === Number(id));
  if (idx === -1) return false;
  db.onus.splice(idx, 1);
  saveData(db);
  return true;
}
async function dbFindOnuByOnuIdOrName(onu_id, name) {
  if (useSupabase()) {
    let rows = [];
    if (onu_id) rows = await supabaseFetch(`onus?onu_id=eq.${encodeURIComponent(onu_id)}&select=*`);
    if ((!rows || rows.length === 0) && name) rows = await supabaseFetch(`onus?name=eq.${encodeURIComponent(name)}&select=*`);
    return rows[0] || null;
  }
  return db.onus.find(o => o.onu_id === onu_id || o.name === name) || null;
}
async function dbGetRxHistory(onuId) {
  if (useSupabase()) {
    return await supabaseFetch(`rx_history?onu_id=eq.${onuId}&select=timestamp,rx_power&order=timestamp.desc&limit=50`);
  }
  return db.rx_history[onuId] || [];
}
async function dbAddRxHistory(onuId, timestamp, rxPower) {
  if (useSupabase()) {
    await supabaseFetch('rx_history', { method: 'POST', body: JSON.stringify({ onu_id: onuId, timestamp, rx_power: rxPower }) });
    return;
  }
  if (!db.rx_history[onuId]) db.rx_history[onuId] = [];
  db.rx_history[onuId].unshift({ timestamp, rx_power: rxPower });
  db.rx_history[onuId] = db.rx_history[onuId].slice(0, 50);
}

// ---- in-process poller (so "start the poller" is a Settings toggle, not a second terminal) ----
let pollerTimer = null;
let pollerStatus = { running: false, lastRun: null, lastResult: null, lastError: null };

async function mockPollFromDb() {
  const onus = await dbGetOnus({});
  return onus
    .filter(o => o.onu_id)
    .map(o => {
      const update = { onu_id: o.onu_id, name: o.name };
      if (o.status === 'Online' && o.rx_power != null) {
        const flip = Math.random();
        if (flip < 0.03) { update.status = 'Power Off'; update.reason = 'Power Off'; }
        else if (flip < 0.05) { update.status = 'Wire Down'; update.reason = 'Wire Down'; }
        else { update.status = 'Online'; update.rx_power = +(o.rx_power + (Math.random() - 0.5) * 0.4).toFixed(2); }
      } else if (o.status !== 'Online' && Math.random() < 0.05) {
        update.status = 'Online';
        update.rx_power = -14 + Math.random() * -6;
      }
      return update;
    })
    .filter(u => u.status);
}

async function applyOnuUpdates(updates) {
  const results = [];
  const now = new Date().toISOString();
  for (const u of updates) {
    const onu = await dbFindOnuByOnuIdOrName(u.onu_id, u.name);
    if (!onu) { results.push({ onu_id: u.onu_id, name: u.name, matched: false }); continue; }

    const wasOnline = onu.status === 'Online';
    const nowOnline = u.status === 'Online';
    const patch = {};
    if (u.status) patch.status = u.status;
    if (u.rx_power != null) patch.rx_power = u.rx_power;
    if (u.distance != null) patch.distance = u.distance;
    if (u.reason) patch.reason = u.reason;
    if (!wasOnline && nowOnline) patch.connected_at = now;
    if (wasOnline && !nowOnline) patch.disconnected_at = now;

    const updated = await dbUpdateOnu(onu.id, patch);
    if (nowOnline && u.rx_power != null) {
      await dbAddRxHistory(onu.id, now, u.rx_power);
    }
    results.push({ onu_id: updated.onu_id, name: updated.name, matched: true, status: updated.status });
  }
  return results;
}

async function runPollerCycle() {
  try {
    let updates = [];
    if (db.settings.poller_mode === 'mock') {
      updates = await mockPollFromDb();
    } else if (db.settings.poller_mode === 'snmp') {
      const adapter = require('./poller/snmp-adapter');
      updates = await adapter.poll();
    } else if (db.settings.poller_mode === 'radius') {
      const adapter = require('./poller/radius-adapter');
      updates = await adapter.poll();
    }
    const results = await applyOnuUpdates(updates);
    pollerStatus = {
      running: true, lastRun: new Date().toISOString(),
      lastResult: `Applied ${results.filter(r => r.matched).length}/${updates.length} update(s)`,
      lastError: null
    };
  } catch (err) {
    pollerStatus = { running: true, lastRun: new Date().toISOString(), lastResult: null, lastError: err.message };
  }
}

function stopPoller() {
  if (pollerTimer) clearInterval(pollerTimer);
  pollerTimer = null;
  pollerStatus.running = false;
}
function startPoller() {
  stopPoller();
  if (!db.settings.poller_enabled) return;
  pollerTimer = setInterval(runPollerCycle, Math.max(5000, db.settings.poll_interval_ms));
  runPollerCycle();
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', c => chunks += c);
    req.on('end', () => {
      if (!chunks) return resolve({});
      try { resolve(JSON.parse(chunks)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function ponName(id) {
  const p = db.pons.find(p => p.id === id);
  return p ? p.name : null;
}

function onuPublic(o) {
  const pon = db.pons.find(p => p.id === o.pon_id);
  return Object.assign({}, o, { pon_name: pon ? pon.name : null });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;
  const method = req.method;

  if (method === 'OPTIONS') { send(res, 204, {}); return; }

  try {
    // ---- Auth ----
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const user = db.users.find(u => u.email === (body.email || '').trim().toLowerCase());
      if (!user || !verifyPassword(body.password || '', user.salt, user.hash)) {
        return send(res, 401, { error: 'Invalid email or password' });
      }
      const token = signToken({ uid: user.id, role: user.role, email: user.email, exp: Date.now() + TOKEN_TTL_MS });
      return send(res, 200, { token, email: user.email, role: user.role });
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Not authenticated' });
      return send(res, 200, { email: auth.email, role: auth.role });
    }

    if (pathname === '/api/auth/change-password' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      const body = await readBody(req);
      const user = db.users.find(u => u.id === auth.uid);
      if (!user) return send(res, 404, { error: 'User not found' });
      if (!verifyPassword(body.current_password || '', user.salt, user.hash)) {
        return send(res, 401, { error: 'Current password is incorrect' });
      }
      if (!body.new_password || body.new_password.length < 6) {
        return send(res, 400, { error: 'New password must be at least 6 characters' });
      }
      const { salt, hash } = hashPassword(body.new_password);
      user.salt = salt; user.hash = hash;
      saveData(db);
      return send(res, 200, { changed: true });
    }

    // ---- Internal ingest endpoint (for external poller processes / real deployments) ----
    // Protected by a shared secret, NOT a user login - this is service-to-service.
    if (pathname === '/api/internal/onu-status' && method === 'POST') {
      const key = req.headers['x-internal-key'];
      if (key !== INTERNAL_KEY) return send(res, 401, { error: 'Invalid internal key' });
      const body = await readBody(req);
      const updates = Array.isArray(body.updates) ? body.updates : [];
      const results = await applyOnuUpdates(updates);
      return send(res, 200, { updated: results.filter(r => r.matched).length, results });
    }

    // ---- Settings (admin only) - drives the in-process poller, no terminal/env vars needed ----
    if (pathname === '/api/settings' && method === 'GET') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const s = db.settings;
      return send(res, 200, {
        poller_enabled: s.poller_enabled, poller_mode: s.poller_mode, poll_interval_ms: s.poll_interval_ms,
        olt: s.olt,
        radius: Object.assign({}, s.radius, { password: '', password_set: !!s.radius.password }),
        supabase: Object.assign({}, s.supabase, { key: '', key_set: !!s.supabase.key }),
        status: pollerStatus
      });
    }

    if (pathname === '/api/settings' && method === 'PUT') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const body = await readBody(req);

      if (typeof body.poller_enabled === 'boolean') db.settings.poller_enabled = body.poller_enabled;
      if (body.poller_mode) db.settings.poller_mode = body.poller_mode;
      if (body.poll_interval_ms) db.settings.poll_interval_ms = Number(body.poll_interval_ms);
      if (body.olt) db.settings.olt = Object.assign({}, db.settings.olt, body.olt);
      if (body.radius) {
        const r = Object.assign({}, body.radius);
        if (!r.password) delete r.password; // blank password field = keep existing one
        db.settings.radius = Object.assign({}, db.settings.radius, r);
      }
      if (body.supabase) {
        const sb = Object.assign({}, body.supabase);
        if (!sb.key) delete sb.key; // blank key field = keep existing one
        db.settings.supabase = Object.assign({}, db.settings.supabase, sb);
      }
      saveData(db);
      startPoller(); // re-apply with new settings immediately
      return send(res, 200, { saved: true, status: pollerStatus });
    }

    if (pathname === '/api/settings/status' && method === 'GET') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      return send(res, 200, {
        poller_enabled: db.settings.poller_enabled, poller_mode: db.settings.poller_mode,
        poll_interval_ms: db.settings.poll_interval_ms,
        supabase_enabled: db.settings.supabase.enabled,
        status: pollerStatus
      });
    }

    if (pathname === '/api/settings/test-connection' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const body = await readBody(req);
      try {
        if (body.type === 'olt') {
          const adapter = require('./poller/snmp-adapter');
          await adapter.poll();
        } else if (body.type === 'radius') {
          const adapter = require('./poller/radius-adapter');
          await adapter.poll();
        } else if (body.type === 'supabase') {
          const { url, key } = supabaseConfig();
          if (!url || !key) throw new Error('Enter both the Supabase URL and key first');
          const rows = await supabaseFetch('onus?select=id&limit=1');
          return send(res, 200, { ok: true, message: `Connected. Found the "onus" table${rows.length ? '' : ' (empty - run backend/supabase/schema.sql if you have not yet)'}.` });
        } else if (body.type === 'mock') {
          // always succeeds - nothing external to reach
        } else {
          return send(res, 400, { error: 'type must be olt, radius, supabase, or mock' });
        }
        return send(res, 200, { ok: true, message: 'Connection succeeded.' });
      } catch (err) {
        return send(res, 200, { ok: false, message: err.message });
      }
    }

    // ---- Danger zone: wipe all ONU/fiber-path data, keeping OLT/PON shells so the app doesn't break ----
    if (pathname === '/api/admin/clear-data' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });

      if (useSupabase()) {
        try {
          await supabaseFetch('rx_history?onu_id=gt.0', { method: 'DELETE' });
          await supabaseFetch('onus?id=gt.0', { method: 'DELETE' });
          await supabaseFetch('fiber_paths?id=gt.0', { method: 'DELETE' });
        } catch (err) {
          return send(res, 500, { error: 'Failed to clear Supabase data: ' + err.message });
        }
      }
      // always clear the local copies too, so nothing demo-ish lingers if you
      // later switch Supabase off
      db.onus = [];
      db.rx_history = {};
      db.fiber_paths = [];
      db.next_onu_id = 1;
      db.next_fiber_path_id = 1;
      saveData(db);
      return send(res, 200, { cleared: true });
    }

    // ---- OLTs ----
    if (pathname === '/api/olts' && method === 'GET') {
      return send(res, 200, db.olts);
    }
    if (pathname === '/api/olts' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const body = await readBody(req);
      const nextId = (Math.max(0, ...db.olts.map(o => o.id)) || 0) + 1;
      const newOlt = { id: nextId, name: body.name || 'New OLT', ip_address: body.ip_address || '', location: body.location || '', status: 'Online' };
      db.olts.push(newOlt);
      saveData(db);
      return send(res, 201, newOlt);
    }
    let m;
    if ((m = pathname.match(/^\/api\/olts\/(\d+)$/)) && method === 'PUT') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const olt = db.olts.find(o => o.id === Number(m[1]));
      if (!olt) return send(res, 404, { error: 'OLT not found' });
      const body = await readBody(req);
      Object.assign(olt, body);
      saveData(db);
      return send(res, 200, olt);
    }
    if ((m = pathname.match(/^\/api\/olts\/(\d+)\/pons$/)) && method === 'GET') {
      const oltId = Number(m[1]);
      return send(res, 200, db.pons.filter(p => p.olt_id === oltId));
    }
    if (pathname === '/api/pons' && method === 'GET') {
      return send(res, 200, db.pons);
    }
    if (pathname === '/api/pons' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const body = await readBody(req);
      const nextId = (Math.max(0, ...db.pons.map(p => p.id)) || 0) + 1;
      const newPon = { id: nextId, olt_id: body.olt_id || db.olts[0].id, name: body.name || `PON ${nextId}`, port: body.port || nextId, output_power: body.output_power || 8, status: 'Active', label: body.label || null };
      db.pons.push(newPon);
      saveData(db);
      return send(res, 201, newPon);
    }
    if ((m = pathname.match(/^\/api\/pons\/(\d+)$/)) && method === 'PUT') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      const pon = db.pons.find(p => p.id === Number(m[1]));
      if (!pon) return send(res, 404, { error: 'PON not found' });
      const body = await readBody(req);
      Object.assign(pon, body);
      saveData(db);
      return send(res, 200, pon);
    }
    if ((m = pathname.match(/^\/api\/pons\/(\d+)$/)) && method === 'DELETE') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role !== 'admin') return send(res, 403, { error: 'Admin only' });
      db.pons = db.pons.filter(p => p.id !== Number(m[1]));
      saveData(db);
      return send(res, 200, { deleted: true });
    }

    // ---- Map nodes/cables (Leaflet draw feature) - writes only, proxied to
    // Supabase's nodes/cables tables (see backend/supabase/nodes_cables_schema.sql).
    // The React map reads + subscribes to these tables directly via the
    // Supabase anon key (RLS allows public SELECT + realtime), but writes
    // come through here so they go through the same admin/engineer/viewer
    // role check as everything else, using the service_role key server-side.
    // Requires Settings -> Database (Supabase) to be configured and enabled.
    if (pathname === '/api/nodes' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot add nodes' });
      if (!useSupabase()) return send(res, 400, { error: 'Enable Supabase in Settings first - map nodes/cables require it' });
      const body = await readBody(req);
      try {
        const rows = await supabaseFetch('nodes', {
          method: 'POST', headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            name: body.name, type: body.type, status: body.status || 'offline',
            latitude: body.latitude, longitude: body.longitude, metadata: body.metadata || {}
          })
        });
        return send(res, 201, rows[0]);
      } catch (err) { return send(res, 502, { error: err.message }); }
    }
    if ((m = pathname.match(/^\/api\/nodes\/([0-9a-f-]+)$/i)) && (method === 'PUT' || method === 'DELETE')) {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot edit/delete nodes' });
      if (!useSupabase()) return send(res, 400, { error: 'Enable Supabase in Settings first' });
      try {
        if (method === 'PUT') {
          const body = await readBody(req);
          const rows = await supabaseFetch(`nodes?id=eq.${m[1]}`, {
            method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(body)
          });
          return send(res, 200, rows[0] || null);
        } else {
          await supabaseFetch(`nodes?id=eq.${m[1]}`, { method: 'DELETE' });
          return send(res, 200, { deleted: true });
        }
      } catch (err) { return send(res, 502, { error: err.message }); }
    }

    if (pathname === '/api/cables' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot add cables' });
      if (!useSupabase()) return send(res, 400, { error: 'Enable Supabase in Settings first - map nodes/cables require it' });
      const body = await readBody(req);
      try {
        const rows = await supabaseFetch('cables', {
          method: 'POST', headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            name: body.name || null, source_olt_id: body.source_olt_id || null, pon_port: body.pon_port || null,
            core_capacity: body.core_capacity || null, core_color: body.core_color || null,
            manufacturer: body.manufacturer || null, coordinates: body.coordinates
          })
        });
        return send(res, 201, rows[0]);
      } catch (err) { return send(res, 502, { error: err.message }); }
    }
    if ((m = pathname.match(/^\/api\/cables\/([0-9a-f-]+)$/i)) && (method === 'PUT' || method === 'DELETE')) {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot edit/delete cables' });
      if (!useSupabase()) return send(res, 400, { error: 'Enable Supabase in Settings first' });
      try {
        if (method === 'PUT') {
          const body = await readBody(req);
          const rows = await supabaseFetch(`cables?id=eq.${m[1]}`, {
            method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(body)
          });
          return send(res, 200, rows[0] || null);
        } else {
          await supabaseFetch(`cables?id=eq.${m[1]}`, { method: 'DELETE' });
          return send(res, 200, { deleted: true });
        }
      } catch (err) { return send(res, 502, { error: err.message }); }
    }

    // ---- Fault tracing: given offline ONU ids, find the likely cable cut ----
    // Reads the current nodes/cables tree from Supabase and runs the
    // topology-based algorithm in faultTracer.js. Read-only, so any
    // logged-in role can use it (a viewer diagnosing an outage shouldn't
    // need engineer/admin access just to SEE where the cut likely is).
    if (pathname === '/api/fault-trace' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (!useSupabase()) return send(res, 400, { error: 'Enable Supabase in Settings first - fault tracing needs the nodes/cables tables' });

      const body = await readBody(req);
      const offlineIds = Array.isArray(body.offline_node_ids) ? body.offline_node_ids : [];

      try {
        const [nodesRows, cablesRows] = await Promise.all([
          supabaseFetch('nodes?select=*'),
          supabaseFetch('cables?select=*'),
        ]);
        const result = traceFault(nodesRows, cablesRows, offlineIds);
        return send(res, 200, result);
      } catch (err) {
        return send(res, 502, { error: err.message });
      }
    }

    // ---- Landmarks ----
    if (pathname === '/api/landmarks' && method === 'GET') {
      return send(res, 200, db.landmarks);
    }

    // ---- ONU search (before /api/onus/:id so "search" isn't parsed as an id) ----
    if (pathname === '/api/onus/search' && method === 'GET') {
      const q = (query.q || '').toString().toLowerCase().trim();
      if (q.length < 3) return send(res, 200, []);
      const results = (await dbSearchOnus(q)).map(onuPublic);
      return send(res, 200, results);
    }

    // ---- RX history ----
    if ((m = pathname.match(/^\/api\/onus\/(\d+)\/rx-history$/)) && method === 'GET') {
      const id = m[1];
      return send(res, 200, await dbGetRxHistory(id));
    }

    // ---- Offline ONUs, grouped by PON ----
    if (pathname === '/api/offline-onus' && method === 'GET') {
      const oltId = query.olt_id ? Number(query.olt_id) : db.olts[0].id;
      const ponIds = db.pons.filter(p => p.olt_id === oltId).map(p => p.id);
      const offline = (await dbGetOnus({ status: 'Offline' })).filter(o => ponIds.includes(o.pon_id));
      const grouped = {};
      ponIds.forEach(pid => { grouped[ponName(pid)] = []; });
      offline.forEach(o => {
        const name = ponName(o.pon_id);
        if (!grouped[name]) grouped[name] = [];
        grouped[name].push(onuPublic(o));
      });
      return send(res, 200, grouped);
    }

    // ---- ONU list / single / CRUD ----
    if (pathname === '/api/onus' && method === 'GET') {
      const list = await dbGetOnus({ pon_id: query.pon_id, status: query.status });
      return send(res, 200, list.map(onuPublic));
    }

    if (pathname === '/api/onus' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot add ONUs' });
      const body = await readBody(req);
      const newOnu = await dbCreateOnu({
        name: body.name || ('onu_' + Date.now()),
        onu_id: body.onu_id || null,
        pon_id: body.pon_id || (db.pons[0] && db.pons[0].id),
        mac: body.mac || null,
        status: body.status || 'Online',
        distance: body.distance || null,
        rx_power: body.rx_power != null ? body.rx_power : null,
        connected_at: new Date().toISOString(),
        latitude: body.latitude,
        longitude: body.longitude
      });
      return send(res, 201, onuPublic(newOnu));
    }

    if ((m = pathname.match(/^\/api\/onus\/(\d+)$/))) {
      const id = Number(m[1]);

      if (method === 'GET') {
        const onu = await dbGetOnuById(id);
        if (!onu) return send(res, 404, { error: 'ONU not found' });
        return send(res, 200, onuPublic(onu));
      }

      if (method === 'PUT') {
        const auth = getAuth(req);
        if (!auth) return send(res, 401, { error: 'Login required' });
        if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot edit ONUs' });
        const body = await readBody(req);
        const updated = await dbUpdateOnu(id, body);
        if (!updated) return send(res, 404, { error: 'ONU not found' });
        return send(res, 200, onuPublic(updated));
      }

      if (method === 'DELETE') {
        const auth = getAuth(req);
        if (!auth) return send(res, 401, { error: 'Login required' });
        if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot delete ONUs' });
        const ok = await dbDeleteOnu(id);
        if (!ok) return send(res, 404, { error: 'ONU not found' });
        return send(res, 200, { deleted: true });
      }
    }

    // ---- Fiber paths ----
    if (pathname === '/api/fiber-paths' && method === 'GET') {
      return send(res, 200, db.fiber_paths);
    }
    if (pathname === '/api/fiber-paths' && method === 'POST') {
      const auth = getAuth(req);
      if (!auth) return send(res, 401, { error: 'Login required' });
      if (auth.role === 'viewer') return send(res, 403, { error: 'Viewers cannot save fiber paths' });
      const body = await readBody(req);
      const newPath = {
        id: db.next_fiber_path_id++,
        name: body.name || 'Untitled Path',
        olt_id: body.olt_id || null,
        pon_id: body.pon_id || null,
        color: body.color || 'Blue',
        style: body.style || 'Solid',
        width: body.width || 2,
        offset: body.offset || 'None',
        coordinates: body.coordinates || [],
        fiber_company: body.fiber_company || null,
        fiber_type: body.fiber_type || null,
        batch_no: body.batch_no || null,
        fiber_year: body.fiber_year || null,
        installed_by: body.installed_by || null,
        comments: body.comments || null,
        created_at: new Date().toISOString()
      };
      db.fiber_paths.push(newPath);
      saveData(db);
      return send(res, 201, newPath);
    }

    // ---- health check ----
    if (pathname === '/api/health' && method === 'GET') {
      return send(res, 200, { ok: true, time: new Date().toISOString() });
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error', detail: String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`ISP SAVIOUR 2.0 demo backend running at http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/api/olts`);
  startPoller();
  console.log(`[poller] enabled=${db.settings.poller_enabled} mode=${db.settings.poller_mode} (configure this from Settings in the UI)`);
});
