// faultTracer.js
//
// Core "Fiber Cut / Fault Tracing" algorithm. Pure functions only - no
// Supabase, no network - so this can be unit tested directly and reused
// from anywhere (Node backend, a script, tests).
//
// -----------------------------------------------------------------------
// WHY THIS IS TOPOLOGY-BASED, NOT GEOMETRIC INTERSECTION
// -----------------------------------------------------------------------
// The brief asks to "trace back the geometric polylines and find where
// paths overlap/intersect." In practice, real fiber routes rarely follow
// perfectly straight lines matching hand-drawn map polylines closely
// enough for point-in-polyline intersection math to be reliable - two
// cables running side-by-side down the same street can look like they
// "intersect" everywhere and nowhere. What actually determines whether a
// cut affects a given ONU is the PON's physical splitter TREE (ONU ->
// splitter -> ... -> OLT), not GPS coordinates.
//
// So this algorithm finds the fault using topology:
//   1. Take every currently-offline ONU's path back to the OLT.
//   2. Find their Lowest Common Ancestor (LCA) in that tree - the
//      deepest node every affected ONU's path passes through.
//   3. For each of the LCA's children, check whether that whole branch's
//      ONUs are ALL offline. The branch(es) where that's true are where
//      the cut is; a branch with even one online ONU is provably fine
//      downstream of it, which is exactly the "active node validation"
//      requirement in the brief - it falls out of the LCA/branch-check
//      naturally rather than needing separate logic.
//   4. The suspected fault is the cable segment between the LCA and that
//      fully-offline child (or, if a single ONU is down with no shared
//      siblings involved, the cable directly feeding it).
//
// Geometry (lat/lng, Haversine distance) is then used only for what it's
// actually good for: reporting how far the fault is from the OLT, and
// telling the frontend where to draw the highlighted segment.

// ---------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------

/**
 * @param {Array} nodes  rows from the `nodes` table
 * @returns {{ byId: Map, childrenOf: Map }}
 */
function buildTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    if (!childrenOf.has(n.parent_id)) childrenOf.set(n.parent_id, []);
    childrenOf.get(n.parent_id).push(n.id);
  }
  return { byId, childrenOf };
}

/** Ordered list of ancestor ids from the OLT (root) down to nodeId (inclusive). */
function upstreamPath(byId, nodeId) {
  const path = [];
  let current = byId.get(nodeId);
  while (current) {
    path.unshift(current.id);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return path;
}

/** All descendant node ids of type 'onu' under (and including, if applicable) nodeId. */
function onuDescendants(childrenOf, byId, nodeId) {
  const result = [];
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop();
    const node = byId.get(id);
    if (node && node.type === "onu") result.push(id);
    const kids = childrenOf.get(id) || [];
    stack.push(...kids);
  }
  return result;
}

// ---------------------------------------------------------------------
// Haversine distance (meters) between two [lat, lng] points
// ---------------------------------------------------------------------
function haversineMeters([lat1, lng1], [lat2, lng2]) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Total length of a polyline (array of [lat,lng] points), in meters. */
function polylineLengthMeters(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
  return total;
}

// ---------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------

/**
 * @param {Array} nodes   rows from the `nodes` table (must include parent_id, pon_port)
 * @param {Array} cables  rows from the `cables` table (id, coordinates: [[lat,lng],...])
 * @param {string[]} offlineIds  ids of nodes (type 'onu') currently offline/wire_down
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   faultNode?: object,
 *   faultCableId?: string|null,
 *   faultCoordinates?: [number, number],
 *   affectedPonPort?: string|null,
 *   downUserCount?: number,
 *   affectedOnuIds?: string[],
 *   estimatedDistanceFromOltMeters?: number,
 *   confidence?: 'high'|'medium'|'low'
 * }}
 */
function traceFault(nodes, cables, offlineIds) {
  if (!offlineIds || offlineIds.length === 0) {
    return { ok: false, reason: "No offline ONU ids provided." };
  }

  const { byId, childrenOf } = buildTree(nodes);
  const cableById = new Map(cables.map((c) => [c.id, c]));

  const missing = offlineIds.filter((id) => !byId.has(id));
  if (missing.length === offlineIds.length) {
    return { ok: false, reason: "None of the provided ONU ids were found in the current node set." };
  }
  const validOfflineIds = offlineIds.filter((id) => byId.has(id));

  // 1. Upstream path (OLT -> ... -> ONU) for every offline ONU
  const paths = validOfflineIds.map((id) => upstreamPath(byId, id));

  // 2. LCA = deepest node present in every path, walking from the root down
  const shortest = paths.reduce((a, b) => (a.length <= b.length ? a : b));
  let lcaId = null;
  for (let depth = 0; depth < shortest.length; depth++) {
    const candidate = shortest[depth];
    if (paths.every((p) => p[depth] === candidate)) {
      lcaId = candidate;
    } else {
      break;
    }
  }
  if (!lcaId) {
    // Affected ONUs share no common ancestor at all - e.g. two entirely
    // separate PONs both had unrelated ONUs go offline at once. That's
    // not a single fiber cut; report it as such instead of guessing.
    return {
      ok: false,
      reason: "Offline ONUs share no common upstream node - likely unrelated outages, not a single fiber cut.",
      affectedOnuIds: validOfflineIds,
      downUserCount: validOfflineIds.length,
    };
  }

  const lcaNode = byId.get(lcaId);

  // 3. Single-ONU case: LCA IS the offline ONU itself (no shared ancestor
  //    needed) - the fault is simply on the cable feeding that one ONU.
  if (lcaNode.type === "onu") {
    return buildResult({
      faultNode: lcaNode,
      faultCableId: lcaNode.upstream_cable_id || null,
      cableById,
      byId,
      affectedOnuIds: validOfflineIds,
      confidence: "high",
    });
  }

  // 4. Multi-ONU case: check each child branch of the LCA. A branch is a
  //    "fully affected" branch if every ONU under it is in the offline
  //    set (and none of its ONUs are still online).
  const children = childrenOf.get(lcaId) || [];
  const fullyAffectedChildren = [];
  for (const childId of children) {
    const descendantOnus = onuDescendants(childrenOf, byId, childId);
    if (descendantOnus.length === 0) continue;
    const allOffline = descendantOnus.every((id) => validOfflineIds.includes(id));
    if (allOffline) fullyAffectedChildren.push(childId);
  }

  if (fullyAffectedChildren.length === 1) {
    // Clean single-branch break - the common case.
    const branchNode = byId.get(fullyAffectedChildren[0]);
    const explained = onuDescendants(childrenOf, byId, branchNode.id);
    return buildResult({
      faultNode: branchNode,
      faultCableId: branchNode.upstream_cable_id || null,
      cableById,
      byId,
      affectedOnuIds: validOfflineIds,
      confidence: "high",
      note: coverageNote(explained, validOfflineIds),
    });
  }

  if (fullyAffectedChildren.length > 1) {
    // Multiple branches fully down at once under the same splitter -
    // more consistent with the LCA's OWN upstream cable failing (or the
    // splitter itself) than several independent breaks. Report the LCA's
    // upstream link, with lower confidence since it's a less common
    // failure mode worth a technician double-checking on site.
    const explained = fullyAffectedChildren.flatMap((id) => onuDescendants(childrenOf, byId, id));
    return buildResult({
      faultNode: lcaNode,
      faultCableId: lcaNode.upstream_cable_id || null,
      cableById,
      byId,
      affectedOnuIds: validOfflineIds,
      confidence: "medium",
      note: [
        `${fullyAffectedChildren.length} branches under this node are fully down - possible splitter or upstream cable failure rather than a single branch cut.`,
        coverageNote(explained, validOfflineIds),
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  // 5. No child branch is fully offline (each has at least one online ONU
  //    mixed in) - the LCA itself is the best-guess point, low confidence.
  return buildResult({
    faultNode: lcaNode,
    faultCableId: lcaNode.upstream_cable_id || null,
    cableById,
    byId,
    affectedOnuIds: validOfflineIds,
    confidence: "low",
    note: "No single downstream branch is fully offline - affected ONUs may not share one clean cause. Verify on site.",
  });
}

function coverageNote(explainedIds, offlineIds) {
  const unexplained = offlineIds.filter((id) => !explainedIds.includes(id));
  if (unexplained.length === 0) return null;
  return `${unexplained.length} of ${offlineIds.length} offline ONU(s) are not on this branch - they may be a separate, unrelated fault. Consider re-running fault tracing on just those ONUs.`;
}

function buildResult({ faultNode, faultCableId, cableById, byId, affectedOnuIds, confidence, note }) {
  const cable = faultCableId ? cableById.get(faultCableId) : null;
  const faultCoordinates = midpointOf(cable, faultNode);

  const olt = findRoot(byId, faultNode);
  const distanceFromOlt = olt ? estimateDistanceAlongTree(byId, cableById, olt.id, faultNode.id) : null;

  return {
    ok: true,
    faultNode: { id: faultNode.id, name: faultNode.name, type: faultNode.type },
    faultCableId: faultCableId || null,
    faultCoordinates,
    affectedPonPort: faultNode.pon_port || null,
    downUserCount: affectedOnuIds.length,
    affectedOnuIds,
    estimatedDistanceFromOltMeters: distanceFromOlt,
    confidence,
    ...(note ? { note } : {}),
  };
}

function midpointOf(cable, fallbackNode) {
  if (cable && Array.isArray(cable.coordinates) && cable.coordinates.length >= 2) {
    const total = polylineLengthMeters(cable.coordinates);
    let travelled = 0;
    const half = total / 2;
    for (let i = 1; i < cable.coordinates.length; i++) {
      const segLen = haversineMeters(cable.coordinates[i - 1], cable.coordinates[i]);
      if (travelled + segLen >= half) {
        const ratio = segLen === 0 ? 0 : (half - travelled) / segLen;
        const [lat1, lng1] = cable.coordinates[i - 1];
        const [lat2, lng2] = cable.coordinates[i];
        return [lat1 + (lat2 - lat1) * ratio, lng1 + (lng2 - lng1) * ratio];
      }
      travelled += segLen;
    }
    return cable.coordinates[cable.coordinates.length - 1];
  }
  // No cable geometry on record for this hop - fall back to the node's
  // own position so the frontend still has somewhere to put the marker.
  return [fallbackNode.latitude, fallbackNode.longitude];
}

function findRoot(byId, node) {
  let current = node;
  while (current.parent_id && byId.has(current.parent_id)) current = byId.get(current.parent_id);
  return current;
}

function estimateDistanceAlongTree(byId, cableById, rootId, targetId) {
  const path = upstreamPath(byId, targetId); // rootId ... targetId
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const node = byId.get(path[i]);
    const cable = node.upstream_cable_id ? cableById.get(node.upstream_cable_id) : null;
    if (cable && Array.isArray(cable.coordinates)) {
      total += polylineLengthMeters(cable.coordinates);
    } else {
      // no cable geometry recorded for this hop - fall back to a
      // straight-line estimate between the two node positions
      const parent = byId.get(path[i - 1]);
      total += haversineMeters([parent.latitude, parent.longitude], [node.latitude, node.longitude]);
    }
  }
  return Math.round(total);
}

module.exports = {
  traceFault,
  buildTree,
  upstreamPath,
  onuDescendants,
  haversineMeters,
  polylineLengthMeters,
};
