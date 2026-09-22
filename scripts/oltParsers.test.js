// oltParsers.test.js
// Run with: node oltParsers.test.js

const assert = require("assert");
const { parseInterfaceIndex, mapOnuStatus, scaleRxPower, buildExternalRef } = require("./oltParsers");

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

console.log("parseInterfaceIndex");
{
  check("ifIndex 10203 -> pon 2, onu 3 (per the documented last-2/next-2-digits convention)", () => {
    const { ponPort, onuId } = parseInterfaceIndex(10203);
    assert.strictEqual(ponPort, 2);
    assert.strictEqual(onuId, 3);
  });
  check("accepts a numeric string", () => {
    const { ponPort, onuId } = parseInterfaceIndex("10101");
    assert.strictEqual(ponPort, 1);
    assert.strictEqual(onuId, 1);
  });
  check("throws on garbage input instead of silently returning NaN", () => {
    assert.throws(() => parseInterfaceIndex("not-a-number"));
  });
  check("throws on negative input", () => {
    assert.throws(() => parseInterfaceIndex(-5));
  });
}

console.log("\nmapOnuStatus");
{
  check("1 -> online", () => assert.strictEqual(mapOnuStatus(1), "online"));
  check("'1' (string) -> online", () => assert.strictEqual(mapOnuStatus("1"), "online"));
  check("0 -> offline", () => assert.strictEqual(mapOnuStatus(0), "offline"));
  check("2 -> offline", () => assert.strictEqual(mapOnuStatus(2), "offline"));
  check("custom onlineValue respected", () => assert.strictEqual(mapOnuStatus(4, 4), "online"));
}

console.log("\nscaleRxPower");
{
  check("-1348 / 100 -> -13.48 dBm", () => assert.strictEqual(scaleRxPower(-1348, 100), -13.48));
  check("-160 / 10 -> -16.0 dBm", () => assert.strictEqual(scaleRxPower(-160, 10), -16));
  check("sentinel -9999 -> null (no signal)", () => assert.strictEqual(scaleRxPower(-9999, 100), null));
  check("sentinel 32767 -> null", () => assert.strictEqual(scaleRxPower(32767, 100), null));
  check("non-numeric input -> null instead of throwing", () => assert.strictEqual(scaleRxPower("N/A", 100), null));
}

console.log("\nbuildExternalRef");
{
  check("deterministic key format", () =>
    assert.strictEqual(buildExternalRef("vsol-192.168.80.2", 1, 3), "vsol-192.168.80.2-pon1-onu3")
  );
  check("same inputs always produce the same ref (upsert stability)", () => {
    const a = buildExternalRef("vsol-192.168.80.2", 2, 5);
    const b = buildExternalRef("vsol-192.168.80.2", 2, 5);
    assert.strictEqual(a, b);
  });
}

console.log(`\n${passed} check(s) passed.`);
if (process.exitCode) {
  console.error("SOME TESTS FAILED.");
} else {
  console.log("ALL TESTS PASSED.");
}
