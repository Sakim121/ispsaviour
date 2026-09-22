// mapIcons.js
// Colored divIcon factory for network devices. Green = online, red =
// offline, amber = wire down - matches the status vocabulary used
// everywhere else in the ISP Saviour app.

import L from "leaflet";

export const STATUS_COLORS = {
  online: "#16a34a",   // green-600
  offline: "#dc2626",  // red-600
  wiredown: "#d97706", // amber-600
};

const DEVICE_SHAPE = {
  OLT: "square",
  Splitter: "diamond",
  ONU: "circle",
};

export function deviceIcon(type, status) {
  const color = STATUS_COLORS[status] || "#64748b"; // slate-500 fallback for unknown status
  const shape = DEVICE_SHAPE[type] || "circle";

  const shapeStyle =
    shape === "square"
      ? "border-radius:4px;"
      : shape === "diamond"
      ? "border-radius:4px; transform: rotate(45deg);"
      : "border-radius:50%;";

  return L.divIcon({
    className: "isp-device-marker",
    html: `<span style="
        display:block; width:16px; height:16px;
        background:${color}; ${shapeStyle}
        border:2px solid white; box-shadow:0 1px 3px rgba(0,0,0,.4);
      "></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  });
}
