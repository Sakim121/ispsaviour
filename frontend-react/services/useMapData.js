// useMapData.js
// React hook wrapping mapService.js with component state: loading/error
// flags, initial fetch on mount, live realtime updates applied to local
// state automatically, and save functions that optimistically update
// state from the row Supabase returns.
//
// Usage:
//   const { nodes, cables, loading, error, saveNewNode, saveNewCable, refetch } = useMapData();
//   <FiberMapView markers={toMarkerProps(nodes)} cables={toCableProps(cables)} ... />

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchMapData, saveNewNode, saveNewCable, subscribeToRealtimeChanges } from "./mapService";

function applyRealtimeChange(list, payload) {
  switch (payload.eventType) {
    case "INSERT":
      // avoid duplicating a row we already added optimistically via saveNewNode/saveNewCable
      return list.some((item) => item.id === payload.new.id) ? list : [...list, payload.new];
    case "UPDATE":
      return list.map((item) => (item.id === payload.new.id ? payload.new : item));
    case "DELETE":
      return list.filter((item) => item.id !== payload.old.id);
    default:
      return list;
  }
}

export function useMapData() {
  const [nodes, setNodes] = useState([]);
  const [cables, setCables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const unsubscribeRef = useRef(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { nodes: freshNodes, cables: freshCables } = await fetchMapData();
      setNodes(freshNodes);
      setCables(freshCables);
    } catch (err) {
      setError(err.message || "Failed to load map data");
    } finally {
      setLoading(false);
    }
  }, []);

  // initial load
  useEffect(() => {
    refetch();
  }, [refetch]);

  // realtime subscription - lives for the component's whole lifetime
  useEffect(() => {
    unsubscribeRef.current = subscribeToRealtimeChanges({
      onNodeChange: (payload) => setNodes((prev) => applyRealtimeChange(prev, payload)),
      onCableChange: (payload) => setCables((prev) => applyRealtimeChange(prev, payload)),
    });
    return () => {
      unsubscribeRef.current && unsubscribeRef.current();
    };
  }, []);

  const handleSaveNewNode = useCallback(async (nodeData) => {
    setSaving(true);
    setError(null);
    try {
      const created = await saveNewNode(nodeData);
      setNodes((prev) => (prev.some((n) => n.id === created.id) ? prev : [...prev, created]));
      return created;
    } catch (err) {
      setError(err.message || "Failed to save node");
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  const handleSaveNewCable = useCallback(async (cableData) => {
    setSaving(true);
    setError(null);
    try {
      const created = await saveNewCable(cableData);
      setCables((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      return created;
    } catch (err) {
      setError(err.message || "Failed to save cable");
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    nodes,
    cables,
    loading,
    saving,
    error,
    refetch,
    saveNewNode: handleSaveNewNode,
    saveNewCable: handleSaveNewCable,
  };
}
