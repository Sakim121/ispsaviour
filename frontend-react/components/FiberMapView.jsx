// FiberMapView.jsx
//
// Real operational map component for the ISP Saviour dashboard.
// Stack: react-leaflet (Leaflet wrapper) + Leaflet-Geoman (draw/edit/
// delete controls) + OpenStreetMap tiles + Tailwind CSS for chrome.
//
// npm install:
//   npm install leaflet react-leaflet @geoman-io/leaflet-geoman-free
//
// Required CSS imports (once, e.g. in your app's root layout/entry file):
//   import "leaflet/dist/leaflet.css";
//   import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
//
// Known Leaflet + bundler gotcha: Leaflet's *default* marker icon (the
// blue teardrop) resolves its image paths relative to the leaflet.js
// file, which breaks under Webpack/Vite bundling and shows a broken
// image. This only affects Geoman's own "draw marker" tool preview /
// any marker NOT given a custom icon - our OLT/Splitter/ONU markers
// always get a custom divIcon from mapIcons.js, so they're unaffected.
// If you also drop in plain markers with no icon prop, apply this fix
// once at app startup:
//
//   import L from "leaflet";
//   delete L.Icon.Default.prototype._getIconUrl;
//   L.Icon.Default.mergeOptions({
//     iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
//     iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
//     shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
//   });

import { useState, useCallback, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "@geoman-io/leaflet-geoman-free"; // attaches the `.pm` namespace to L.Map / L.Layer
import { deviceIcon, STATUS_COLORS } from "./mapIcons";

const DEFAULT_CENTER = [20.5937, 78.9629]; // placeholder - set to your service area's centroid
const DEFAULT_ZOOM = 13;

const STATUS_OPTIONS = [
  { key: "online", label: "Online", color: STATUS_COLORS.online },
  { key: "offline", label: "Offline", color: STATUS_COLORS.offline },
  { key: "wiredown", label: "Wire Down", color: STATUS_COLORS.wiredown },
];

// ---------------------------------------------------------------------
// Draw / edit / delete controls (Leaflet-Geoman), wired to emit GeoJSON.
// Mounted as a child of <MapContainer> so useMap() resolves the live
// Leaflet map instance - this component renders nothing itself.
// ---------------------------------------------------------------------
function GeomanControls({ onGeometryChange }) {
  const map = useMap();

  useEffect(() => {
    if (!map.pm) {
      console.warn("Leaflet-Geoman not found on the map instance - is @geoman-io/leaflet-geoman-free imported?");
      return;
    }

    map.pm.addControls({
      position: "topleft",
      drawMarker: true,      // OLT / Splitter / ONU placement
      drawPolyline: true,    // fiber cable runs
      drawCircleMarker: false,
      drawRectangle: false,
      drawPolygon: false,
      drawCircle: false,
      drawText: false,
      editMode: true,        // drag vertices / markers on existing shapes
      dragMode: true,        // drag whole shapes
      removalMode: true,     // click-to-delete
      cutPolygon: false,
      rotateMode: false,
    });

    function emit(action, layer) {
      if (!layer || typeof layer.toGeoJSON !== "function") return;
      onGeometryChange({
        action,                                          // "create" | "edit" | "remove"
        layerType: layer instanceof L.Marker ? "marker" : "polyline",
        geojson: layer.toGeoJSON(),
      });
    }

    function handleCreate(e) {
      emit("create", e.layer);
      // Geoman only fires pm:edit on the LAYER itself, not the map, so
      // newly-drawn shapes need their own listener attached here to
      // report subsequent vertex/position edits.
      e.layer.on("pm:edit", () => emit("edit", e.layer));
      e.layer.on("pm:dragend", () => emit("edit", e.layer));
    }
    function handleRemove(e) {
      emit("remove", e.layer);
    }

    map.on("pm:create", handleCreate);
    map.on("pm:remove", handleRemove);

    return () => {
      map.off("pm:create", handleCreate);
      map.off("pm:remove", handleRemove);
      if (map.pm) map.pm.removeControls();
    };
  }, [map, onGeometryChange]);

  return null;
}

// ---------------------------------------------------------------------
// Floating status filter panel (not a page sidebar - a small overlay
// control docked to the map corner, matching the rest of the app's
// existing map screens).
// ---------------------------------------------------------------------
function MapFilterPanel({ activeStatuses, onToggle }) {
  return (
    <div className="absolute right-3 top-3 z-[1000] w-44 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Show devices
      </div>
      <div className="flex flex-col gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <label key={opt.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={activeStatuses.includes(opt.key)}
              onChange={() => onToggle(opt.key)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: opt.color }} />
            <span className="truncate">{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------
/**
 * @param {Array} markers  [{ id, type: 'OLT'|'Splitter'|'ONU', status: 'online'|'offline'|'wiredown', position: [lat,lng], name }]
 * @param {Array} cables   [{ id, name, positions: [[lat,lng], ...] }]
 * @param {(payload: { action: 'create'|'edit'|'remove', layerType: 'marker'|'polyline', geojson: object }) => void} onGeometryChange
 *        Fired every time the operator draws, edits, or deletes a shape.
 *        Wire this to your save-to-database call, e.g.:
 *          onGeometryChange={(p) => fetch('/api/fiber-paths', { method: 'POST', body: JSON.stringify(p.geojson) })}
 */
export default function FiberMapView({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  markers = [],
  cables = [],
  onGeometryChange = () => {},
  className = "",
  children, // e.g. <FaultTraceOverlay .../> - rendered inside the same MapContainer
}) {
  const [activeStatuses, setActiveStatuses] = useState(["online", "offline", "wiredown"]);

  const toggleStatus = useCallback((key) => {
    setActiveStatuses((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  }, []);

  const visibleMarkers = markers.filter((m) => activeStatuses.includes(m.status));

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-xl border border-slate-200 shadow-lg ${className}`}
    >
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-full w-full">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <GeomanControls onGeometryChange={onGeometryChange} />

        {cables.map((cable) => (
          <Polyline key={cable.id} positions={cable.positions} pathOptions={{ color: "#4338ca", weight: 3 }}>
            {cable.name && <Popup>{cable.name}</Popup>}
          </Polyline>
        ))}

        {visibleMarkers.map((m) => (
          <Marker key={m.id} position={m.position} icon={deviceIcon(m.type, m.status)}>
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">{m.name}</div>
                <div className="capitalize text-slate-500">
                  {m.type} &middot; {m.status}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {children}
      </MapContainer>

      <MapFilterPanel activeStatuses={activeStatuses} onToggle={toggleStatus} />
    </div>
  );
}
