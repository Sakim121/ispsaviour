// MapPageWithFaultTracing.jsx
// End-to-end example: live map (Supabase-backed) + automatic fault
// tracing whenever 2+ ONUs on the same branch go offline, visualized
// with a flashing highlighted cable segment and a diagnostics widget.

import { useState, useEffect, useMemo, useCallback } from "react";
import FiberMapView from "./FiberMapView";
import FaultTraceOverlay from "./FaultTraceOverlay";
import FaultDiagnosticsPanel from "./FaultDiagnosticsPanel";
import { useMapData } from "../services/useMapData";
import { traceFault } from "../services/faultTraceService";

export default function MapPageWithFaultTracing() {
  const { nodes, cables, loading: mapLoading } = useMapData();
  const [faultResult, setFaultResult] = useState(null);
  const [tracing, setTracing] = useState(false);

  const offlineOnuIds = useMemo(
    () => nodes.filter((n) => n.type === "onu" && (n.status === "offline" || n.status === "wire_down")).map((n) => n.id),
    [nodes]
  );

  const runTrace = useCallback(async () => {
    if (offlineOnuIds.length === 0) {
      setFaultResult(null);
      return;
    }
    setTracing(true);
    try {
      const result = await traceFault(offlineOnuIds);
      setFaultResult(result);
    } catch (err) {
      setFaultResult({ ok: false, reason: err.message });
    } finally {
      setTracing(false);
    }
  }, [offlineOnuIds]);

  // Re-trace automatically whenever the set of offline ONUs changes
  // (e.g. Realtime just told us another one dropped).
  useEffect(() => {
    runTrace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineOnuIds.join(",")]);

  const markers = useMemo(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.type === "olt" ? "OLT" : n.type === "splitter" ? "Splitter" : "ONU",
        status: n.status === "wire_down" ? "wiredown" : n.status === "power_off" ? "offline" : n.status,
        position: [n.latitude, n.longitude],
        name: n.name,
      })),
    [nodes]
  );
  const cableLines = useMemo(
    () => cables.map((c) => ({ id: c.id, name: c.name, positions: c.coordinates })),
    [cables]
  );

  if (mapLoading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading map…</div>;
  }

  return (
    <div className="h-screen w-full bg-slate-100 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Live Fiber Map</h1>
        {offlineOnuIds.length > 0 && (
          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
            {offlineOnuIds.length} ONU(s) offline
          </span>
        )}
      </div>

      <div className="relative h-[calc(100%-2.5rem)]">
        <FiberMapView markers={markers} cables={cableLines} onGeometryChange={() => {}}>
          <FaultTraceOverlay faultResult={faultResult} cables={cableLines} />
        </FiberMapView>

        <FaultDiagnosticsPanel faultResult={faultResult} loading={tracing} onRetrace={runTrace} />
      </div>
    </div>
  );
}
