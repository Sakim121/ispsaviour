// FaultTraceOverlay.jsx
// Renders INSIDE the same <MapContainer> as FiberMapView (pass it as a
// child - see MapPageWithFaultTracing.jsx for the wiring). Given the
// backend's fault-trace result, it:
//   - highlights the identified cable segment with a flashing red/amber Polyline
//   - drops a "⚡ Broken Cable" marker at the calculated fault point
//
// Renders nothing if faultResult is null/ok:false, so it's safe to
// always mount and just pass in whatever the last trace call returned.

import { useState, useEffect } from "react";
import { Polyline, Marker, Popup } from "react-leaflet";
import L from "leaflet";

const FLASH_COLORS = ["#dc2626", "#f59e0b"]; // red-600 <-> amber-500
const FLASH_INTERVAL_MS = 500;

const brokenCableIcon = L.divIcon({
  className: "",
  html: `<div style="
      width:30px; height:30px; border-radius:50%;
      background:#dc2626; display:flex; align-items:center; justify-content:center;
      font-size:16px; border:3px solid white; box-shadow:0 2px 8px rgba(220,38,38,.6);
      animation: isp-fault-pulse 1s ease-in-out infinite;
    ">⚡</div>
    <style>
      @keyframes isp-fault-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }
    </style>`,
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -15],
});

/**
 * @param {object|null} faultResult  the object returned by POST /api/fault-trace
 * @param {Array} cables             the same cables array passed to FiberMapView
 *                                   (used to look up the full polyline for the
 *                                   flagged faultCableId, not just its midpoint)
 */
export default function FaultTraceOverlay({ faultResult, cables = [] }) {
  const [flashOn, setFlashOn] = useState(false);

  useEffect(() => {
    if (!faultResult?.ok) return;
    const id = setInterval(() => setFlashOn((v) => !v), FLASH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [faultResult]);

  if (!faultResult || !faultResult.ok) return null;

  const cable = faultResult.faultCableId ? cables.find((c) => c.id === faultResult.faultCableId) : null;
  const segmentPositions = cable?.positions || cable?.coordinates || null;

  return (
    <>
      {segmentPositions && (
        <Polyline
          positions={segmentPositions}
          pathOptions={{
            color: flashOn ? FLASH_COLORS[0] : FLASH_COLORS[1],
            weight: 6,
            opacity: 0.9,
            dashArray: "10,6",
          }}
        />
      )}

      {faultResult.faultCoordinates && (
        <Marker position={faultResult.faultCoordinates} icon={brokenCableIcon}>
          <Popup>
            <div className="text-sm">
              <div className="font-semibold text-red-600">⚡ Suspected fiber cut</div>
              <div className="mt-1 text-slate-600">
                {faultResult.downUserCount} user(s) down
                {faultResult.affectedPonPort ? ` on ${faultResult.affectedPonPort}` : ""}
              </div>
              {faultResult.note && <div className="mt-1 text-xs text-amber-600">{faultResult.note}</div>}
            </div>
          </Popup>
        </Marker>
      )}
    </>
  );
}
