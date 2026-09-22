// Mock net-snmp for testing olt-scanner.js's logic without real hardware.
// Simulates 3 ONUs: 2 online (PON1-ONU1, PON1-ONU2), 1 offline (PON2-ONU1).

const STATUS_BASE = "1.3.6.1.2.1.155.1.4.1.1.1.1";
const RX_BASE = "1.3.6.1.2.1.155.1.4.1.5.1.2";

// ifIndex suffixes following the documented "last2=onu, next2=pon" scheme:
// 10101 -> pon1 onu1, 10102 -> pon1 onu2, 10201 -> pon2 onu1
const MOCK_STATUS_ROWS = [
  { oid: `${STATUS_BASE}.10101`, value: 1 }, // online
  { oid: `${STATUS_BASE}.10102`, value: 1 }, // online
  { oid: `${STATUS_BASE}.10201`, value: 0 }, // offline
];
const MOCK_RX_ROWS = [
  { oid: `${RX_BASE}.10101`, value: -1348 }, // -13.48 dBm
  { oid: `${RX_BASE}.10102`, value: -1602 }, // -16.02 dBm
  // no RX row for the offline ONU - realistic (no signal to measure)
];

function isVarbindError() {
  return false;
}

function createSession(host, community, opts) {
  return {
    walk(baseOid, maxRep, feedCb, doneCb) {
      let rows = [];
      if (baseOid === STATUS_BASE) rows = MOCK_STATUS_ROWS;
      else if (baseOid === RX_BASE) rows = MOCK_RX_ROWS;
      // simulate async network I/O
      setTimeout(() => {
        feedCb(rows);
        doneCb(null);
      }, 5);
    },
    close() {},
  };
}

module.exports = { Version2c: "2c", isVarbindError, createSession };
