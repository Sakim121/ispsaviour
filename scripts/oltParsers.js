// oltParsers.js
// Pure functions extracted out of olt-scanner.js so the parsing logic -
// the part most likely to need adjusting per OLT vendor/firmware - can
// be unit tested without any real hardware or network access. See
// oltParsers.test.js.

/**
 * VSOL/EPON interface indexes commonly encode (slot, pon port, onu id)
 * into a single integer, but the exact packing formula is NOT
 * standardized across vendors or even across firmware versions of the
 * same vendor - this implementation uses the common convention where the
 * ifIndex's last 2 decimal digits are the ONU id and the next 2 are the
 * PON port, which matches many VSOL/CTC-MIB EPON OLTs but is NOT
 * guaranteed for your specific V1600D8 firmware.
 *
 * VERIFY THIS against your device: run the script with DISCOVER_MODE=true
 * (see olt-scanner.js) and compare the raw ifIndex values against what
 * the OLT's own web UI shows for PON port / ONU id, then adjust the
 * formula below if it doesn't match.
 *
 * @param {string|number} ifIndex
 * @returns {{ ponPort: number, onuId: number }}
 */
function parseInterfaceIndex(ifIndex) {
  const n = Number(ifIndex);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`parseInterfaceIndex: invalid ifIndex "${ifIndex}"`);
  }
  const onuId = n % 100;
  const ponPort = Math.floor(n / 100) % 100;
  return { ponPort, onuId };
}

/**
 * Maps a raw SNMP status integer to our app's status vocabulary.
 * Per the brief: 1 = online/active, anything else = offline/down.
 * Real EPON/GPON MIBs often distinguish MORE offline reasons (power
 * off vs LOS vs deregistered) with different codes - if your OLT
 * exposes that distinction, extend the map below instead of collapsing
 * everything non-1 into a single 'offline'.
 *
 * @param {string|number} rawStatus
 * @returns {'online'|'offline'}
 */
function mapOnuStatus(rawStatus, onlineValue = 1) {
  return Number(rawStatus) === Number(onlineValue) ? "online" : "offline";
}

/**
 * SNMP optical power OIDs very commonly return power as an integer
 * scaled by 100 or 10 (e.g. -1348 meaning -13.48 dBm) rather than a
 * float, because SNMP's INTEGER type has no native decimal support.
 * The scale factor is vendor-specific - confirm yours by comparing a
 * raw walked value against the dBm reading shown in the OLT's own web
 * UI for the same ONU, then set RX_POWER_DIVISOR accordingly (default
 * here assumes hundredths, i.e. divide by 100).
 *
 * @param {string|number} rawValue
 * @param {number} divisor
 * @returns {number|null} dBm, or null if the OLT reported "no signal"
 */
function scaleRxPower(rawValue, divisor = 100) {
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return null;
  // Some OLTs report an out-of-range sentinel (e.g. -9999 or 32767) for
  // "no signal" / ONU offline instead of omitting the OID entirely.
  if (n <= -9000 || n === 32767 || n === -32768) return null;
  return Math.round((n / divisor) * 100) / 100; // round to 2 decimal places
}

/**
 * Stable key to upsert against (see the external_ref column added in
 * nodes_cables_schema.sql). Deterministic for the same OLT+PON+ONU every
 * scan cycle, which is the whole point - it's what lets .upsert() update
 * the same row instead of creating a duplicate each time.
 */
function buildExternalRef(oltIdentifier, ponPort, onuId) {
  return `${oltIdentifier}-pon${ponPort}-onu${onuId}`;
}

module.exports = { parseInterfaceIndex, mapOnuStatus, scaleRxPower, buildExternalRef };
