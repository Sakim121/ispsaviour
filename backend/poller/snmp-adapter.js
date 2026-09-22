// SNMP adapter template - fill this in for your OLT vendor.
//
// This file is intentionally a stub: every OLT vendor (Huawei, ZTE, VSOL,
// C-Data, Dasan, etc.) exposes different SNMP OIDs for ONU status, RX
// power, and distance, and some don't support SNMP at all (you'd scrape
// their web UI instead - same idea, different fetch logic inside poll()).
//
// Install a SNMP client when you're ready to implement this:
//   cd backend/poller
//   npm init -y
//   npm install net-snmp
//
// Then set environment variables before starting the poller:
//   ISP_POLLER_MODE=snmp
//   OLT_HOST=10.10.0.1
//   OLT_SNMP_COMMUNITY=public
//   OLT_SNMP_VERSION=2c
//
// and fill in the OIDs your OLT actually uses below (check your OLT's
// vendor MIB documentation - these are NOT universal).

// const snmp = require('net-snmp');

const OLT_HOST = process.env.OLT_HOST;
const OLT_SNMP_COMMUNITY = process.env.OLT_SNMP_COMMUNITY || 'public';

// Example OID shape (Huawei-style GPON MIBs look roughly like this -
// yours will differ, confirm with your OLT vendor's MIB browser):
//   1.3.6.1.4.1.<vendor>.<...>.onuStatus.<pon>.<onu-index>
//   1.3.6.1.4.1.<vendor>.<...>.onuRxPower.<pon>.<onu-index>
//   1.3.6.1.4.1.<vendor>.<...>.onuDistance.<pon>.<onu-index>
const OIDS = {
  // status: '1.3.6.1.4.1.XXXXX.....',
  // rxPower: '1.3.6.1.4.1.XXXXX.....',
  // distance: '1.3.6.1.4.1.XXXXX.....',
};

async function poll() {
  if (!OLT_HOST) {
    throw new Error('OLT_HOST is not set - see backend/poller/snmp-adapter.js for setup instructions');
  }

  // --- Replace everything below with a real SNMP walk against your OLT ---
  //
  // const session = snmp.createSession(OLT_HOST, OLT_SNMP_COMMUNITY);
  // const varbinds = await new Promise((resolve, reject) => {
  //   session.walk(OIDS.status, 20, (varbinds) => resolve(varbinds), (err) => reject(err));
  // });
  // session.close();
  //
  // Map each varbind's SNMP index back to an onu_id (EPON0/x:y) the way
  // your OLT numbers them, then return an array of updates in the same
  // shape run-poller.js already expects:
  //
  // return varbinds.map(vb => ({
  //   onu_id: mapIndexToOnuId(vb.oid),
  //   status: mapSnmpStatusCode(vb.value),   // -> 'Online' | 'Power Off' | 'Wire Down'
  //   rx_power: readRxPowerFor(vb.oid),      // dBm, float
  //   distance: readDistanceFor(vb.oid)      // meters, integer
  // }));

  throw new Error('SNMP adapter not implemented yet - fill in poll() in backend/poller/snmp-adapter.js');
}

module.exports = { poll };
