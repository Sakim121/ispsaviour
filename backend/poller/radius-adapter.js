// RADIUS adapter template - fill this in to pull real session/usage data.
//
// Most ISP RADIUS setups (FreeRADIUS + MySQL/Postgres, or IconRadius,
// or similar) log accounting data into a table - commonly `radacct` for
// FreeRADIUS. This adapter is meant to query that table on a schedule
// and report each user's current session (or lack of one), IP, and
// usage totals.
//
// Install a DB client when you're ready to implement this, matching
// whatever your RADIUS accounting DB actually is:
//   cd backend/poller
//   npm install mysql2       # if RADIUS accounting lives in MySQL
//   # or: npm install pg     # if it's Postgres
//
// Then set environment variables before starting the poller:
//   ISP_POLLER_MODE=radius
//   RADIUS_DB_HOST=127.0.0.1
//   RADIUS_DB_USER=radius_reader
//   RADIUS_DB_PASSWORD=...
//   RADIUS_DB_NAME=radius

// const mysql = require('mysql2/promise');

const RADIUS_DB_HOST = process.env.RADIUS_DB_HOST;

// FreeRADIUS's radacct table (standard schema) has columns roughly like:
//   username, framedipaddress, acctstarttime, acctstoptime,
//   acctinputoctets, acctoutputoctets, nasipaddress
//
// A session with acctstoptime IS NULL is currently online. Example query
// you'd run per poll cycle:
//
//   SELECT username, framedipaddress, acctstarttime,
//          acctinputoctets, acctoutputoctets
//   FROM radacct
//   WHERE acctstoptime IS NULL;

async function poll() {
  if (!RADIUS_DB_HOST) {
    throw new Error('RADIUS_DB_HOST is not set - see backend/poller/radius-adapter.js for setup instructions');
  }

  // --- Replace everything below with a real query against radacct ---
  //
  // const conn = await mysql.createConnection({
  //   host: RADIUS_DB_HOST,
  //   user: process.env.RADIUS_DB_USER,
  //   password: process.env.RADIUS_DB_PASSWORD,
  //   database: process.env.RADIUS_DB_NAME
  // });
  // const [rows] = await conn.execute(
  //   `SELECT username, framedipaddress, acctstarttime,
  //           acctinputoctets, acctoutputoctets
  //    FROM radacct WHERE acctstoptime IS NULL`
  // );
  // await conn.end();
  //
  // Match `username` back to the matching row in backend/data.json's
  // onus[].name (or add a dedicated `radius_username` lookup column if
  // your naming doesn't line up 1:1), then return updates in the same
  // shape run-poller.js expects. The backend's /api/internal/onu-status
  // endpoint currently only understands status/rx_power/distance/reason -
  // extend it (and onuPublic() in server.js) if you want IP/usage pushed
  // through this same pipeline too.
  //
  // return rows.map(r => ({
  //   name: r.username,
  //   status: 'Online' // presence in radacct with no stop time = online
  // }));

  throw new Error('RADIUS adapter not implemented yet - fill in poll() in backend/poller/radius-adapter.js');
}

module.exports = { poll };
