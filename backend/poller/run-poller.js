// ISP SAVIOUR 2.0 - OLT/RADIUS poller
//
// This is a standalone service, separate from server.js. It runs on a
// timer, asks an "adapter" for the current state of every ONU, and pushes
// whatever changed to the backend's internal ingest endpoint
// (POST /api/internal/onu-status). server.js never talks to the OLT
// directly - it just trusts whatever this service reports.
//
// MOCK MODE (default): reads the current ONUs from the backend and
// jitters their RX power / occasionally flips status, so you can see the
// whole pipeline working end to end with zero configuration:
//   node backend/server.js        (terminal 1)
//   node backend/poller/run-poller.js   (terminal 2)
// Watch live-map.html or the topology page - numbers will drift every
// poll cycle.
//
// REAL MODE: set ISP_POLLER_MODE=snmp (or =radius, or run both pollers)
// and fill in snmp-adapter.js / radius-adapter.js with your OLT/RADIUS
// vendor's actual query logic. Nothing else in this file needs to change.

const http = require('http');

const BACKEND_URL = process.env.ISP_BACKEND_URL || 'http://localhost:5000';
const INTERNAL_KEY = process.env.ISP_INTERNAL_KEY || 'isp-saviour-internal-demo-key';
const POLL_INTERVAL_MS = Number(process.env.ISP_POLL_INTERVAL_MS || 30000);
const MODE = process.env.ISP_POLLER_MODE || 'mock'; // 'mock' | 'snmp' | 'radius'

function httpJson(method, url, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ---- MOCK adapter: no external system, just jitters what's already in the backend ----
async function mockPoll() {
  const res = await httpJson('GET', `${BACKEND_URL}/api/onus`);
  if (res.status !== 200) throw new Error(`GET /api/onus failed: ${res.status}`);
  const onus = res.body;

  return onus
    .filter(o => o.onu_id) // skip rows with no ONU id
    .map(o => {
      const update = { onu_id: o.onu_id, name: o.name };
      if (o.status === 'Online' && o.rx_power != null) {
        // small random walk on RX power, occasionally simulate a drop
        const flip = Math.random();
        if (flip < 0.03) {
          update.status = 'Power Off';
          update.reason = 'Power Off';
        } else if (flip < 0.05) {
          update.status = 'Wire Down';
          update.reason = 'Wire Down';
        } else {
          update.status = 'Online';
          update.rx_power = +(o.rx_power + (Math.random() - 0.5) * 0.4).toFixed(2);
        }
      } else if (o.status !== 'Online') {
        // small chance an offline ONU comes back
        if (Math.random() < 0.05) {
          update.status = 'Online';
          update.rx_power = -14 + Math.random() * -6;
        }
      }
      return update;
    })
    .filter(u => u.status); // only send rows we actually changed
}

// ---- Real adapters (see snmp-adapter.js / radius-adapter.js - both currently stubs) ----
let snmpPoll = null, radiusPoll = null;
try { snmpPoll = require('./snmp-adapter').poll; } catch (e) { /* not implemented yet */ }
try { radiusPoll = require('./radius-adapter').poll; } catch (e) { /* not implemented yet */ }

async function runOnce() {
  let updates = [];
  try {
    if (MODE === 'mock') updates = await mockPoll();
    else if (MODE === 'snmp' && snmpPoll) updates = await snmpPoll();
    else if (MODE === 'radius' && radiusPoll) updates = await radiusPoll();
    else {
      console.warn(`[poller] mode "${MODE}" has no adapter implemented yet - see backend/poller/README.md`);
      return;
    }
  } catch (err) {
    console.error('[poller] poll failed:', err.message);
    return;
  }

  if (updates.length === 0) {
    console.log(`[poller] ${new Date().toISOString()} - nothing changed`);
    return;
  }

  const res = await httpJson('POST', `${BACKEND_URL}/api/internal/onu-status`,
    { updates }, { 'X-Internal-Key': INTERNAL_KEY });

  if (res.status === 200) {
    console.log(`[poller] ${new Date().toISOString()} - pushed ${updates.length} update(s), backend applied ${res.body.updated}`);
  } else {
    console.error(`[poller] ingest failed (${res.status}):`, res.body);
  }
}

console.log(`[poller] starting in "${MODE}" mode, polling every ${POLL_INTERVAL_MS}ms against ${BACKEND_URL}`);
runOnce();
setInterval(runOnce, POLL_INTERVAL_MS);
