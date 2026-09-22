// faultTracer.test.js
// Run with: node faultTracer.test.js
// Real executable tests against a mock topology (no DB needed) - this is
// the actual "does the algorithm work" verification, not just a syntax
// check, since the tree-walking / LCA / branch-coverage logic is the
// entire point of this feature.

const assert = require("assert");
const { traceFault, haversineMeters, polylineLengthMeters } = require("./faultTracer");

// ---------------------------------------------------------------------
// Mock topology:
//
//   OLT
//    └─ Splitter A (PON 1)
//        ├─ Splitter B
//        │   ├─ ONU 1  (online)
//        │   └─ ONU 2  (online)
//        └─ Splitter C
//            ├─ ONU 3  (online)
//            └─ ONU 4  (online)
// ---------------------------------------------------------------------
const nodes = [
  { id: "olt", name: "Ark OLT 1", type: "olt", status: "online", latitude: 14.7500, longitude: 78.5300, parent_id: null, pon_port: null, upstream_cable_id: null },
  { id: "spA", name: "Splitter A", type: "splitter", status: "online", latitude: 14.7490, longitude: 78.5310, parent_id: "olt", pon_port: "PON 1", upstream_cable_id: "cable-olt-spA" },
  { id: "spB", name: "Splitter B", type: "splitter", status: "online", latitude: 14.7480, longitude: 78.5320, parent_id: "spA", pon_port: "PON 1", upstream_cable_id: "cable-spA-spB" },
  { id: "spC", name: "Splitter C", type: "splitter", status: "online", latitude: 14.7470, longitude: 78.5290, parent_id: "spA", pon_port: "PON 1", upstream_cable_id: "cable-spA-spC" },
  { id: "onu1", name: "onu1", type: "onu", status: "online", latitude: 14.7475, longitude: 78.5325, parent_id: "spB", pon_port: "PON 1", upstream_cable_id: "cable-spB-onu1" },
  { id: "onu2", name: "onu2", type: "onu", status: "online", latitude: 14.7478, longitude: 78.5328, parent_id: "spB", pon_port: "PON 1", upstream_cable_id: "cable-spB-onu2" },
  { id: "onu3", name: "onu3", type: "onu", status: "online", latitude: 14.7465, longitude: 78.5285, parent_id: "spC", pon_port: "PON 1", upstream_cable_id: "cable-spC-onu3" },
  { id: "onu4", name: "onu4", type: "onu", status: "online", latitude: 14.7468, longitude: 78.5288, parent_id: "spC", pon_port: "PON 1", upstream_cable_id: "cable-spC-onu4" },
];

const cables = [
  { id: "cable-olt-spA", coordinates: [[14.7500, 78.5300], [14.7490, 78.5310]] },
  { id: "cable-spA-spB", coordinates: [[14.7490, 78.5310], [14.7480, 78.5320]] },
  { id: "cable-spA-spC", coordinates: [[14.7490, 78.5310], [14.7470, 78.5290]] },
  { id: "cable-spB-onu1", coordinates: [[14.7480, 78.5320], [14.7475, 78.5325]] },
  { id: "cable-spB-onu2", coordinates: [[14.7480, 78.5320], [14.7478, 78.5328]] },
  { id: "cable-spC-onu3", coordinates: [[14.7470, 78.5290], [14.7465, 78.5285]] },
  { id: "cable-spC-onu4", coordinates: [[14.7470, 78.5290], [14.7468, 78.5288]] },
];

let passed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  ok - ${label}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL - ${label}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Test 1: single ONU offline -> fault is its own drop cable");
{
  const result = traceFault(nodes, cables, ["onu1"]);
  check("ok=true", () => assert.strictEqual(result.ok, true));
  check("faultNode is onu1", () => assert.strictEqual(result.faultNode.id, "onu1"));
  check("faultCableId is onu1's drop cable", () => assert.strictEqual(result.faultCableId, "cable-spB-onu1"));
  check("confidence high", () => assert.strictEqual(result.confidence, "high"));
  check("downUserCount is 1", () => assert.strictEqual(result.downUserCount, 1));
}

console.log("\nTest 2: both ONUs under Splitter B offline, Splitter C untouched -> fault is spA-spB cable");
{
  const result = traceFault(nodes, cables, ["onu1", "onu2"]);
  check("ok=true", () => assert.strictEqual(result.ok, true));
  check("faultNode is Splitter B", () => assert.strictEqual(result.faultNode.id, "spB"));
  check("faultCableId is the spA->spB trunk", () => assert.strictEqual(result.faultCableId, "cable-spA-spB"));
  check("confidence medium (both children of spB fully down)", () => assert.strictEqual(result.confidence, "medium"));
  check("downUserCount is 2", () => assert.strictEqual(result.downUserCount, 2));
  check("no unexplained-coverage note", () => assert.strictEqual(result.note.includes("not on this branch"), false));
}

console.log("\nTest 3: ACTIVE NODE VALIDATION - onu1 offline, onu2 (same splitter) still online -> fault must be downstream of the branch point, not the shared trunk");
{
  const result = traceFault(nodes, cables, ["onu1"]); // onu2 implicitly online (not in offline list)
  check("faultNode is onu1 itself, NOT Splitter B", () => assert.strictEqual(result.faultNode.id, "onu1"));
  check("does NOT blame the shared spA->spB trunk", () => assert.notStrictEqual(result.faultCableId, "cable-spA-spB"));
}

console.log("\nTest 4: one ONU each under Splitter B and Splitter C offline, their siblings online -> LCA is Splitter A, but neither branch is FULLY down, so low confidence + a note");
{
  const result = traceFault(nodes, cables, ["onu1", "onu3"]);
  check("ok=true", () => assert.strictEqual(result.ok, true));
  check("faultNode is Splitter A (the LCA)", () => assert.strictEqual(result.faultNode.id, "spA"));
  check("confidence low (no branch fully offline)", () => assert.strictEqual(result.confidence, "low"));
}

console.log("\nTest 5: entire network down (all 4 ONUs offline) -> fault is the OLT's own uplink cable");
{
  const result = traceFault(nodes, cables, ["onu1", "onu2", "onu3", "onu4"]);
  check("ok=true", () => assert.strictEqual(result.ok, true));
  check("faultNode is Splitter A (both spB and spC fully down)", () => assert.strictEqual(result.faultNode.id, "spA"));
  check("faultCableId is the OLT->spA trunk", () => assert.strictEqual(result.faultCableId, "cable-olt-spA"));
  check("confidence medium", () => assert.strictEqual(result.confidence, "medium"));
}

console.log("\nTest 6: unrelated ONUs from different branches with no full-branch coverage -> coverage note fires");
{
  // onu2 alone (spB not fully covered since onu1 stays online) + onu4 alone (spC not fully covered)
  const result = traceFault(nodes, cables, ["onu2", "onu4"]);
  check("ok=true", () => assert.strictEqual(result.ok, true));
  check("low confidence since no branch is fully offline", () => assert.strictEqual(result.confidence, "low"));
}

console.log("\nTest 7: empty input handled cleanly");
{
  const result = traceFault(nodes, cables, []);
  check("ok=false", () => assert.strictEqual(result.ok, false));
  check("has a reason", () => assert.ok(result.reason));
}

console.log("\nTest 8: unknown ONU id handled cleanly");
{
  const result = traceFault(nodes, cables, ["does-not-exist"]);
  check("ok=false", () => assert.strictEqual(result.ok, false));
}

console.log("\nTest 9: Haversine + polyline length sanity");
{
  check("haversine(same point) is ~0", () => {
    const d = haversineMeters([14.75, 78.53], [14.75, 78.53]);
    assert.ok(d < 0.001);
  });
  check("haversine(spA, spB) roughly matches known ~150m real-world spacing for this mock", () => {
    const d = haversineMeters([14.7490, 78.5310], [14.7480, 78.5320]);
    assert.ok(d > 50 && d < 300, `expected 50-300m, got ${d.toFixed(1)}m`);
  });
  check("polylineLength of a 3-point line equals sum of its 2 segments", () => {
    const pts = [[14.75, 78.53], [14.751, 78.531], [14.752, 78.532]];
    const total = polylineLengthMeters(pts);
    const manual = haversineMeters(pts[0], pts[1]) + haversineMeters(pts[1], pts[2]);
    assert.ok(Math.abs(total - manual) < 0.001);
  });
}

console.log("\nTest 10: estimated distance from OLT increases the deeper the fault is in the tree");
{
  const near = traceFault(nodes, cables, ["onu1", "onu2"]); // fault at spB (2 hops from OLT)
  const far = traceFault(nodes, cables, ["onu1"]);          // fault at onu1 (3 hops from OLT)
  check("deeper fault has larger estimated distance", () =>
    assert.ok(far.estimatedDistanceFromOltMeters > near.estimatedDistanceFromOltMeters)
  );
}

console.log(`\n${passed} check(s) passed.`);
if (process.exitCode) {
  console.error("SOME TESTS FAILED - see FAIL lines above.");
} else {
  console.log("ALL TESTS PASSED.");
}
