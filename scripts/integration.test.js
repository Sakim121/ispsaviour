// integration.test.js
// Runs the REAL scanOnce() from olt-scanner.js against mocked net-snmp
// (simulating a VSOL OLT's SNMP responses) and a mocked Supabase client,
// and asserts on the actual upsert payload it would have sent.

process.env.SUPABASE_URL = "https://fake-project.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "fake-service-key";
process.env.OLT_IDENTIFIER = "vsol-192.168.80.2";

const assert = require("assert");
const scanner = require("./olt-scanner");
const supabaseMock = require("@supabase/supabase-js");

(async () => {
  console.log("Running scanOnce() against mocked SNMP data (3 ONUs: 2 online, 1 offline)...\n");
  await scanner.scanOnce();

  const lastUpsert = supabaseMock.__calls.upserts[supabaseMock.__calls.upserts.length - 1];

  let passed = 0;
  function check(label, fn) {
    try {
      fn();
      console.log(`  ok - ${label}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL - ${label}\n         ${err.message}`);
      process.exitCode = 1;
    }
  }

  check("an upsert call was made", () => assert.ok(lastUpsert));
  check("upsert targeted the nodes table", () => assert.strictEqual(lastUpsert.table, "nodes"));
  check("onConflict is external_ref (matches the schema migration)", () =>
    assert.strictEqual(lastUpsert.opts.onConflict, "external_ref")
  );
  check("3 rows upserted (2 online + 1 offline ONU)", () => assert.strictEqual(lastUpsert.rows.length, 3));

  const onu1 = lastUpsert.rows.find((r) => r.external_ref === "vsol-192.168.80.2-pon1-onu1");
  const onu2 = lastUpsert.rows.find((r) => r.external_ref === "vsol-192.168.80.2-pon1-onu2");
  const onu3 = lastUpsert.rows.find((r) => r.external_ref === "vsol-192.168.80.2-pon2-onu1");

  check("PON1-ONU1 correctly parsed as online", () => assert.strictEqual(onu1.status, "online"));
  check("PON1-ONU1 RX power correctly scaled to -13.48 dBm", () =>
    assert.strictEqual(onu1.metadata.rx_power_dbm, -13.48)
  );
  check("PON1-ONU2 correctly parsed as online", () => assert.strictEqual(onu2.status, "online"));
  check("PON2-ONU1 correctly parsed as offline", () => assert.strictEqual(onu3.status, "offline"));
  check("PON2-ONU1 has no RX power (no signal, offline)", () =>
    assert.strictEqual(onu3.metadata.rx_power_dbm, null)
  );
  check("each row's pon_port field is set correctly", () => {
    assert.strictEqual(onu1.pon_port, "PON 1");
    assert.strictEqual(onu3.pon_port, "PON 2");
  });
  check("each row is typed 'onu'", () => lastUpsert.rows.every((r) => assert.strictEqual(r.type, "onu")));

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) {
    console.error("SOME TESTS FAILED.");
  } else {
    console.log("ALL TESTS PASSED - the join/parse/upsert logic is correct against this mock data.");
    console.log("This does NOT verify the real device's actual OID layout - see olt-scanner.js's top comment.");
  }
})();
