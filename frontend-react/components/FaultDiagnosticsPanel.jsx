// FaultDiagnosticsPanel.jsx
// Small floating widget (bottom-left corner, so it doesn't collide with
// MapFilterPanel's top-right position) - not a page sidebar. Shows the
// result of the last fault trace: affected PON port, how many users are
// down, and estimated distance from the OLT.

const CONFIDENCE_STYLE = {
  high: { label: "High confidence", className: "bg-red-100 text-red-700" },
  medium: { label: "Medium confidence", className: "bg-amber-100 text-amber-700" },
  low: { label: "Low confidence", className: "bg-slate-200 text-slate-700" },
};

function formatDistance(meters) {
  if (meters == null) return "—";
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`;
}

export default function FaultDiagnosticsPanel({ faultResult, loading, onRetrace }) {
  if (!loading && !faultResult) return null;

  return (
    <div className="absolute bottom-3 left-3 z-[1000] w-72 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Fault Diagnostics
        </div>
        {onRetrace && (
          <button
            type="button"
            onClick={onRetrace}
            className="rounded-md px-2 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            Re-trace
          </button>
        )}
      </div>

      {loading && <div className="text-sm text-slate-500">Tracing fault…</div>}

      {!loading && faultResult && !faultResult.ok && (
        <div className="text-sm text-slate-600">
          {faultResult.reason || "Could not determine a single fault point."}
        </div>
      )}

      {!loading && faultResult?.ok && (
        <>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div className="text-slate-500">Affected PON</div>
            <div className="text-right font-medium text-slate-900">
              {faultResult.affectedPonPort || "—"}
            </div>

            <div className="text-slate-500">Users down</div>
            <div className="text-right font-medium text-slate-900">{faultResult.downUserCount}</div>

            <div className="text-slate-500">Dist. from OLT</div>
            <div className="text-right font-medium text-slate-900">
              {formatDistance(faultResult.estimatedDistanceFromOltMeters)}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                (CONFIDENCE_STYLE[faultResult.confidence] || CONFIDENCE_STYLE.low).className
              }`}
            >
              {(CONFIDENCE_STYLE[faultResult.confidence] || CONFIDENCE_STYLE.low).label}
            </span>
            <span className="text-xs text-slate-400">{faultResult.faultNode?.name}</span>
          </div>

          {faultResult.note && (
            <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
              {faultResult.note}
            </div>
          )}
        </>
      )}
    </div>
  );
}
