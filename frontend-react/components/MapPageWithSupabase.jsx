// MapPageWithSupabase.jsx
// End-to-end example: useMapData() loads/subscribes to Supabase, and
// FiberMapView's onGeometryChange (from the Geoman draw controls) saves
// newly drawn shapes straight back to Supabase.
//
// Assumes FiberMapView.jsx / mapIcons.js from the map-component step are
// in the same project.

import { useMemo } from "react";
import FiberMapView from "./FiberMapView";
import { useMapData } from "../services/useMapData";

// GeoJSON coordinates are [lng, lat]; Leaflet/this schema's convention is
// [lat, lng] - these two helpers keep that swap in one obvious place.
function pointToLatLng([lng, lat]) {
  return { latitude: lat, longitude: lng };
}
function lineToLatLngPairs(coords) {
  return coords.map(([lng, lat]) => [lat, lng]);
}

export default function MapPageWithSupabase() {
  const { nodes, cables, loading, error, saveNewNode, saveNewCable } = useMapData();

  // Adapt Supabase rows -> the prop shape FiberMapView expects
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

  async function handleGeometryChange({ action, layerType, geojson }) {
    if (action !== "create") return; // only persist brand-new shapes here;
    // wire up "edit"/"remove" the same way once you're ready (UPDATE / DELETE
    // by geojson.id if you round-trip the row id through the layer, e.g.
    // layer.feature = { properties: { id } } right after saveNewNode/saveNewCable).

    try {
      if (layerType === "marker") {
        const { latitude, longitude } = pointToLatLng(geojson.geometry.coordinates);
        await saveNewNode({
          name: window.prompt("Device name:") || "Unnamed device",
          type: "onu", // swap for a real type-picker UI (OLT / Splitter / ONU)
          status: "offline",
          latitude,
          longitude,
        });
      } else if (layerType === "polyline") {
        const coordinates = lineToLatLngPairs(geojson.geometry.coordinates);
        await saveNewCable({
          name: window.prompt("Cable name:") || "Unnamed cable",
          coordinates,
        });
      }
    } catch (err) {
      alert(`Could not save: ${err.message}`);
    }
  }

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Loading map…</div>;
  }

  return (
    <div className="h-screen w-full bg-slate-100 p-4">
      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">⚠ {error}</div>
      )}
      <div className="h-[calc(100%-1rem)]">
        <FiberMapView markers={markers} cables={cableLines} onGeometryChange={handleGeometryChange} />
      </div>
    </div>
  );
}
