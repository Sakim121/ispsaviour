#!/usr/bin/env node
// olt-scanner.js
// Standalone script: SNMP-polls a VSOL V1600D8 EPON OLT for ONU
// online/offline status + RX optical power, and upserts the results into
// Supabase's `nodes` table. Runs every 60s via setInterval.
//
// ---------------------------------------------------------------------
// WHAT I COULD AND COULDN'T VERIFY WITHOUT YOUR HARDWARE
// ---------------------------------------------------------------------
// I have no network access to 192.168.80.2 (or any local network) from
// where this was written, so I could not actually run this against your
// real OLT. What IS verified:
//   - oltParsers.js's parsing/mapping/scaling logic - 16 real unit tests,
//     run with `node oltParsers.test.js` (see that file).
//   - This file's own syntax (node --check).
//   - The net-snmp API calls below match its documented usage
//     (session.walk, varbind shape, error handling).
// What is NOT verified and needs YOUR testing:
//   - Whether 1.3.6.1.2.1.155.x and 1.3.6.1.4.1.37950.x are the correct
//     OIDs for your specific V1600D8's firmware. VSOL's exact private
//     MIB layout varies by model/firmware even within VSOL's own product
//     line - these are the standard/commonly-cited ones, not something I
//     can confirm against your unit.
//   - The interface-index -> (PON port, ONU id) parsing formula in
//     oltParsers.js.
//   - The RX power scale factor (divide by 100? by 10? already a float?).
//
// Run with DISCOVER_MODE=true first (see below) BEFORE trusting any of
// the parsed output - it prints every OID+value under the base MIBs so
// you can compare against your OLT's web UI and confirm/correct the
// OIDs and scale factors above before relying on this for real alerts.

const snmp = require("net-snmp");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const { parseInterfaceIndex, mapOnuStatus, scaleRxPower, buildExternalRef } = require("./oltParsers");

// ---------------------------------------------------------------------
// Config - defaults match the device given in the brief, override via .env
// ---------------------------------------------------------------------
const OLT_HOST = process.env.OLT_HOST || "192.168.80.2";
const OLT_PORT = Number(process.env.OLT_PORT || 161);
const SNMP_COMMUNITY = process.env.SNMP_COMMUNITY || "public";
const OLT_IDENTIFIER = process.env.OLT_IDENTIFIER || `vsol-${OLT_HOST}`; // used to build external_ref
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60000);
const DISCOVER_MODE = process.env.DISCOVER_MODE === "true";
const STATUS_ONLINE_VALUE = Number(process.env.STATUS_ONLINE_VALUE || 1);
const RX_POWER_DIVISOR = Number(process.env.RX_POWER_DIVISOR || 100);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role - this is a trusted backend script, never the anon key here

// ---------------------------------------------------------------------
// OIDs - VERIFY THESE against your device (see DISCOVER_MODE below)
// ---------------------------------------------------------------------
// Base MIBs mentioned in the brief:
//   dot3Epon (generic EPON standard MIB):  1.3.6.1.2.1.155
//   VSOL/CTC private EPON MIB:             1.3.6.1.4.1.37950
const OIDS = {
  // ONU registration/online status table. 1 = online/active per the
  // brief's convention; see oltParsers.js's mapOnuStatus() for the
  // mapping logic itself.
  onuStatus: process.env.OID_ONU_STATUS || "1.3.6.1.2.1.155.1.4.1.1.1.1",
  // ONU RX optical power table (dot3ExtPkgOptIfInputPower per the brief).
  onuRxPower: process.env.OID_ONU_RX_POWER || "1.3.6.1.2.1.155.1.4.1.5.1.2",
};

// ---------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in your .env - see .env.example");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------------------------------------------------------------------
// SNMP session (read-only: v2c + community string, no set operations
// anywhere in this file, so it cannot modify the OLT's configuration)
// ---------------------------------------------------------------------
function createSession() {
  return snmp.createSession(OLT_HOST, SNMP_COMMUNITY, {
    port: OLT_PORT,
    version: snmp.Version2c,
    retries: 1,
    timeout: 5000,
  });
}

/** Promise-wrapped session.walk - resolves an array of { oid, value }. */
function walkOid(session, baseOid) {
  return new Promise((resolve, reject) => {
    const results = [];
    session.walk(
      baseOid,
      20, // maxRepetitions
      (varbinds) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue; // skip individual errored rows, don't abort the whole walk
          results.push({ oid: vb.oid, value: vb.value });
        }
      },
      (error) => {
        if (error) reject(error);
        else resolve(results);
      }
    );
  });
}

// ---------------------------------------------------------------------
// Discovery mode - dump raw OID/value pairs so you can confirm the
// table layout against your OLT's own web UI before trusting the parsed
// output. Run: DISCOVER_MODE=true node olt-scanner.js
// ---------------------------------------------------------------------
async function runDiscovery(session) {
  console.log(`\n[discover] Walking ${OIDS.onuStatus} (status table)...`);
  const statusRows = await walkOid(session, OIDS.onuStatus);
  statusRows.forEach((r) => console.log(`  ${r.oid} = ${r.value}`));
  console.log(`[discover] ${statusRows.length} row(s).`);

  console.log(`\n[discover] Walking ${OIDS.onuRxPower} (RX power table)...`);
  const rxRows = await walkOid(session, OIDS.onuRxPower);
  rxRows.forEach((r) => console.log(`  ${r.oid} = ${r.value}`));
  console.log(`[discover] ${rxRows.length} row(s).`);

  console.log(
    "\n[discover] Compare the ifIndex suffix (the numbers after the base OID) and " +
      "raw values above against what your OLT's web UI shows for the same ONUs. " +
      "If they don't line up with oltParsers.js's parseInterfaceIndex()/scaleRxPower() " +
      "assumptions, adjust those functions (or the OID_* / RX_POWER_DIVISOR env vars) " +
      "before running the scanner for real."
  );
}

// ---------------------------------------------------------------------
// One scan cycle
// ---------------------------------------------------------------------
async function scanOnce() {
  const session = createSession();

  try {
    if (DISCOVER_MODE) {
      await runDiscovery(session);
      return;
    }

    const [statusRows, rxRows] = await Promise.all([
      walkOid(session, OIDS.onuStatus),
      walkOid(session, OIDS.onuRxPower),
    ]);

    // Index RX power rows by their ifIndex suffix so we can join them to
    // the status rows below.
    const rxByIndex = new Map();
    for (const row of rxRows) {
      const suffix = row.oid.replace(`${OIDS.onuRxPower}.`, "");
      rxByIndex.set(suffix, row.value);
    }

    const upserts = [];
    let onlineCount = 0;
    let offlineCount = 0;

    for (const row of statusRows) {
      const suffix = row.oid.replace(`${OIDS.onuStatus}.`, "");
      let ponPort, onuId;
      try {
        ({ ponPort, onuId } = parseInterfaceIndex(suffix));
      } catch (err) {
        console.warn(`[scan] Skipping unparseable ifIndex "${suffix}": ${err.message}`);
        continue;
      }

      const status = mapOnuStatus(row.value, STATUS_ONLINE_VALUE);
      const rxRaw = rxByIndex.get(suffix);
      const rxPower = rxRaw != null ? scaleRxPower(rxRaw, RX_POWER_DIVISOR) : null;

      status === "online" ? onlineCount++ : offlineCount++;

      upserts.push({
        external_ref: buildExternalRef(OLT_IDENTIFIER, ponPort, onuId),
        name: `PON${ponPort}-ONU${onuId}`, // placeholder - overwritten below if the row already has a real name
        type: "onu",
        status,
        pon_port: `PON ${ponPort}`,
        metadata: { rx_power_dbm: rxPower, onu_id: onuId, source: "snmp-scanner", scanned_at: new Date().toISOString() },
      });
    }

    if (upserts.length === 0) {
      console.warn("[scan] OLT responded but no ONU rows were parsed - check DISCOVER_MODE output and the OID_* env vars.");
      return;
    }

    // Don't clobber a technician-assigned name with our placeholder on
    // every scan - only set `name` for rows that don't exist yet.
    // (Supabase upsert would otherwise overwrite `name` every 60s.)
    const { data: existing } = await supabase
      .from("nodes")
      .select("external_ref, name")
      .in("external_ref", upserts.map((u) => u.external_ref));
    const existingNames = new Map((existing || []).map((r) => [r.external_ref, r.name]));
    for (const u of upserts) {
      if (existingNames.has(u.external_ref)) u.name = existingNames.get(u.external_ref);
    }

    const { error } = await supabase.from("nodes").upsert(upserts, { onConflict: "external_ref" });
    if (error) throw error;

    console.log(`OLT Scan Complete: ${onlineCount} ONUs Online, ${offlineCount} ONUs Offline`);
  } catch (err) {
    // Network drop / OLT timeout / SNMP error - log and move on, never
    // crash the loop over a transient hardware/network issue.
    console.warn(`[scan] WARNING - OLT unreachable or SNMP error: ${err.message}`);
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------
// Main loop - only auto-starts when run directly (`node olt-scanner.js`),
// not when required by a test harness.
// ---------------------------------------------------------------------
function start() {
  console.log(`OLT scanner starting - target ${OLT_HOST}:${OLT_PORT}, community "${SNMP_COMMUNITY}", every ${POLL_INTERVAL_MS}ms`);
  if (DISCOVER_MODE) console.log("Running in DISCOVER_MODE - will print raw OID data once and exit each cycle without writing to Supabase.");

  scanOnce();
  setInterval(scanOnce, POLL_INTERVAL_MS);
}

if (require.main === module) {
  start();
}

module.exports = { scanOnce, runDiscovery, walkOid, createSession, start };
