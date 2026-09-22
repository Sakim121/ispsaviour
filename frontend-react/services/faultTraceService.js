// faultTraceService.js
// Calls the backend's fault-tracing endpoint (POST /api/fault-trace),
// which runs backend/faultTracer.js against the live nodes/cables tree.
// Uses the same localStorage-based backend URL + auth token as
// mapService.js, so it shares the existing login session automatically.

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

/**
 * @param {string[]} offlineNodeIds  ids of currently offline/wire_down ONUs
 * @returns {Promise<object>} the traceFault() result from faultTracer.js
 */
export async function traceFault(offlineNodeIds) {
  const res = await fetch(`${backendUrl()}/api/fault-trace`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ offline_node_ids: offlineNodeIds }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Fault trace request failed (${res.status})`);
  return data;
}
