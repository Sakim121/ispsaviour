// mapService.js
// saveNewNode / saveNewCable go through the existing Node backend
// (server.js), so they're covered by its admin/engineer/viewer role
// checks - matching backend/supabase/nodes_cables_schema.sql's RLS
// setup, which deliberately allows NO direct writes from the browser.
// fetchMapData / subscribeToRealtimeChanges still talk to Supabase
// directly, since Realtime needs a live browser<->Supabase connection
// either way, and reads are public per that schema's RLS.

import { supabase } from "./supabaseClient";

// Mirrors the same localStorage keys the rest of the app's pages use
// (see config.js / auth.js) so this plugs into the existing login
// session without any extra setup.
function backendUrl() {
  return localStorage.getItem("isp_backend_url") || "http://localhost:5000";
}
function authHeaders() {
  try {
    const auth = JSON.parse(localStorage.getItem("isp_auth") || "null");
    return auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  } catch {
    return {};
  }
}
async function backendFetch(path, options = {}) {
  const res = await fetch(`${backendUrl()}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...options.headers },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

/**
 * Insert a newly placed map marker (OLT / Splitter / ONU) via the backend.
 * @param {{ name: string, type: 'olt'|'splitter'|'onu', status?: string,
 *           latitude: number, longitude: number, metadata?: object }} nodeData
 * @returns {Promise<object>} the inserted row, including its generated id
 */
export async function saveNewNode(nodeData) {
  return backendFetch("/api/nodes", { method: "POST", body: JSON.stringify(nodeData) });
}

/**
 * Insert a newly drawn fiber route polyline via the backend.
 * @param {{ name?: string, source_olt_id?: string, pon_port?: string,
 *           core_capacity?: number, core_color?: string, manufacturer?: string,
 *           coordinates: Array<[number, number]> }} cableData
 * @returns {Promise<object>} the inserted row, including its generated id
 */
export async function saveNewCable(cableData) {
  if (!Array.isArray(cableData.coordinates) || cableData.coordinates.length < 2) {
    throw new Error("saveNewCable failed: coordinates must have at least 2 points");
  }
  return backendFetch("/api/cables", { method: "POST", body: JSON.stringify(cableData) });
}

/** Edit an existing node. Goes through the backend, same as saveNewNode. */
export async function updateNode(id, patch) {
  return backendFetch(`/api/nodes/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}
/** Delete a node. Goes through the backend, same as saveNewNode. */
export async function deleteNode(id) {
  return backendFetch(`/api/nodes/${id}`, { method: "DELETE" });
}
/** Edit an existing cable. Goes through the backend, same as saveNewCable. */
export async function updateCable(id, patch) {
  return backendFetch(`/api/cables/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}
/** Delete a cable. Goes through the backend, same as saveNewCable. */
export async function deleteCable(id) {
  return backendFetch(`/api/cables/${id}`, { method: "DELETE" });
}

/**
 * Fetch every node and cable concurrently - call this once on page load.
 * Reads Supabase directly (public SELECT per the schema's RLS).
 * @returns {Promise<{ nodes: object[], cables: object[] }>}
 */
export async function fetchMapData() {
  const [nodesRes, cablesRes] = await Promise.all([
    supabase.from("nodes").select("*"),
    supabase.from("cables").select("*"),
  ]);

  if (nodesRes.error) throw new Error(`fetchMapData (nodes) failed: ${nodesRes.error.message}`);
  if (cablesRes.error) throw new Error(`fetchMapData (cables) failed: ${cablesRes.error.message}`);

  return { nodes: nodesRes.data || [], cables: cablesRes.data || [] };
}

/**
 * Subscribe to live INSERT/UPDATE/DELETE on nodes + cables, e.g. so an
 * ONU's marker updates the instant its status flips in the database -
 * including changes made via the backend's write endpoints above, since
 * those hit the same Supabase tables Realtime is watching.
 *
 * @param {{ onNodeChange?: (payload: object) => void,
 *           onCableChange?: (payload: object) => void }} handlers
 * @returns {() => void} call the returned function to unsubscribe
 */
export function subscribeToRealtimeChanges({ onNodeChange, onCableChange } = {}) {
  const channel = supabase
    .channel("isp-map-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "nodes" },
      (payload) => onNodeChange && onNodeChange(payload)
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "cables" },
      (payload) => onCableChange && onCableChange(payload)
    )
    .subscribe((status, err) => {
      if (err) console.error("Realtime subscription error:", err);
    });

  return () => supabase.removeChannel(channel);
}
