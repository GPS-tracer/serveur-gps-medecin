/**
 * Dashboard: Leaflet + OSM, live RTDB `agents/`, optional history polyline per agent + day.
 */

import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { db, AGENTS_PATH, auth } from "../shared/firebase.js";

const DEFAULT_CENTER = [-4.7761, 11.8635];
const DEFAULT_ZOOM = 12;
const MOVE_DURATION_MS = 450;
const POSITION_EPS = 1e-6;

/** If last Firebase update is older than this, agent is shown as Offline (no new RTDB tick). */
const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;

const deviceListEl = document.getElementById("deviceList");
const emptyStateEl = document.getElementById("emptyState");
const agentCountEl = document.getElementById("agentCount");
const mapEl = document.getElementById("map");
const historyAgentSelect = document.getElementById("historyAgent");
const historyDateInput = document.getElementById("historyDate");
const historyTrailMeta = document.getElementById("historyTrailMeta");

const map = L.map(mapEl, {
  scrollWheelZoom: true,
  zoomControl: true,
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

requestAnimationFrame(() => map.invalidateSize());

/** @type {Map<string, L.Marker>} */
const markers = new Map();

/** Cache reverse geocode results to avoid redundant API calls: "lat,lng" → address string */
const geocodeCache = new Map();

/**
 * Reverse geocode using Nominatim (free, no key needed).
 * Returns a short label: "Quartier, Ville" or falls back to coords.
 */
async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr`;
    const res = await fetch(url, { headers: { "Accept-Language": "fr" } });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.neighbourhood || a.suburb || a.quarter || a.village || a.hamlet,
      a.city || a.town || a.municipality || a.county,
    ].filter(Boolean);
    const label = parts.length ? parts.join(", ") : data.display_name?.split(",").slice(0, 2).join(",").trim() || key;
    geocodeCache.set(key, label);
    return label;
  } catch {
    return key;
  }
}
/** @type {Map<string, number>} */
const markerMoveFrames = new Map();

/** Latest RTDB snapshot object under `agents/` (for history paths) */
let latestAgentsVal = null;

/** @type {L.Polyline | null} */
let historyPolyline = null;

/** Last "agent|date" for which we flew the map to the trail (avoid refit on every RTDB tick). */
let lastTrailSelection = "";

let lastDeviceIdsKey = "";

/** Last agents with coordinates (for re-rendering status as time passes). */
let cachedPanelDevices = [];

function todayYmdLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

if (historyDateInput && !historyDateInput.value) {
  historyDateInput.value = todayYmdLocal();
}

function dayBoundsLocal(ymd) {
  const parts = ymd.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return [0, 0];
  const [y, mo, d] = parts;
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime();
  const end = start + 86400000 - 1;
  return [start, end];
}

/**
 * Build ordered [lat, lng] pairs for one local calendar day from `history` node.
 */
function historyLatLngsForDay(historyObj, ymd) {
  if (!historyObj || typeof historyObj !== "object") return [];
  const [start, end] = dayBoundsLocal(ymd);
  if (!end) return [];

  const entries = [];
  for (const key of Object.keys(historyObj)) {
    const t = Number(key);
    if (!Number.isFinite(t) || t < start || t > end) continue;
    const p = historyObj[key];
    if (!p || typeof p !== "object") continue;
    const lat = typeof p.lat === "number" ? p.lat : null;
    const lng = typeof p.lng === "number" ? p.lng : null;
    if (lat == null || lng == null) continue;
    entries.push([t, lat, lng]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  return entries.map(([, lat, lng]) => [lat, lng]);
}

function clearHistoryPolyline() {
  if (historyPolyline) {
    map.removeLayer(historyPolyline);
    historyPolyline = null;
  }
}

/**
 * Redraw trail from cached RTDB + current UI selection (no page reload).
 */
function refreshHistoryTrail() {
  const agentId = historyAgentSelect.value;
  const ymd = historyDateInput.value;
  const selection = `${agentId}\0${ymd}`;
  const selectionChanged = selection !== lastTrailSelection;

  if (!agentId || !ymd || !latestAgentsVal) {
    clearHistoryPolyline();
    lastTrailSelection = "";
    historyTrailMeta.textContent = "";
    return;
  }

  const row = latestAgentsVal[agentId];
  const latlngs = historyLatLngsForDay(row?.history, ymd);

  if (latlngs.length === 0) {
    clearHistoryPolyline();
    lastTrailSelection = "";
    historyTrailMeta.textContent = "No history points for this day.";
    return;
  }

  if (latlngs.length === 1) {
    clearHistoryPolyline();
    lastTrailSelection = "";
    historyTrailMeta.textContent = "1 point — need 2+ to draw a line.";
    if (selectionChanged) {
      map.flyTo(latlngs[0], Math.max(map.getZoom(), 14), {
        duration: 0.85,
        easeLinearity: 0.25,
      });
    }
    return;
  }

  const polyOpts = {
    color: "#38bdf8",
    weight: 4,
    opacity: 0.92,
    lineJoin: "round",
    lineCap: "round",
  };

  if (!historyPolyline || selectionChanged) {
    clearHistoryPolyline();
    historyPolyline = L.polyline(latlngs, polyOpts).addTo(map);
    lastTrailSelection = selection;
    map.flyToBounds(historyPolyline.getBounds().pad(0.08), {
      maxZoom: 15,
      duration: 1.1,
      easeLinearity: 0.25,
    });
  } else {
    historyPolyline.setLatLngs(latlngs);
  }

  historyTrailMeta.textContent = `${latlngs.length} points — polyline shown.`;
}

function syncHistoryAgentOptions(agentIds) {
  const previous = historyAgentSelect.value;
  historyAgentSelect.innerHTML = '<option value="">— Select agent —</option>';
  for (const id of agentIds) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    historyAgentSelect.appendChild(opt);
  }
  if (previous && agentIds.includes(previous)) {
    historyAgentSelect.value = previous;
  }
}

function stopMarkerMove(agentId) {
  const frameId = markerMoveFrames.get(agentId);
  if (frameId != null) {
    cancelAnimationFrame(frameId);
    markerMoveFrames.delete(agentId);
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function positionChanged(aLat, aLng, bLat, bLng) {
  return Math.abs(aLat - bLat) > POSITION_EPS || Math.abs(aLng - bLng) > POSITION_EPS;
}

function moveMarkerSmooth(agentId, marker, endLat, endLng) {
  const start = marker.getLatLng();
  if (!positionChanged(start.lat, start.lng, endLat, endLng)) {
    marker.setLatLng([endLat, endLng]);
    return;
  }

  stopMarkerMove(agentId);

  const startTime = performance.now();
  const fromLat = start.lat;
  const fromLng = start.lng;

  function step(now) {
    const t = Math.min(1, (now - startTime) / MOVE_DURATION_MS);
    const e = smoothstep(t);
    const lat = fromLat + (endLat - fromLat) * e;
    const lng = fromLng + (endLng - fromLng) * e;
    marker.setLatLng([lat, lng]);

    if (t < 1) {
      markerMoveFrames.set(agentId, requestAnimationFrame(step));
    } else {
      marker.setLatLng([endLat, endLng]);
      markerMoveFrames.delete(agentId);
    }
  }

  markerMoveFrames.set(agentId, requestAnimationFrame(step));
}

function lastUpdateAsMs(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

function formatLastUpdate(raw) {
  const ms = lastUpdateAsMs(raw);
  if (ms == null) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Online = recent `lastUpdate` in RTDB (agent still reporting). */
function isAgentOnline(lastUpdateRaw, now = Date.now()) {
  const ms = lastUpdateAsMs(lastUpdateRaw);
  if (ms == null) return false;
  return now - ms <= ONLINE_THRESHOLD_MS;
}

function buildPopupHtml(agentId, lastUpdateRaw, address, name, phone) {
  const id = escapeHtml(agentId);
  const label = name ? escapeHtml(name) : id;
  const when = escapeHtml(formatLastUpdate(lastUpdateRaw));
  const addr = address ? `<div class="agent-popup__address">📍 ${escapeHtml(address)}</div>` : "";
  const tel = phone ? `<div class="agent-popup__phone">📞 ${escapeHtml(phone)}</div>` : "";
  return (
    '<div class="agent-popup-inner">' +
    `<div class="agent-popup__id">${label}</div>` +
    `<div class="agent-popup__label">Last update</div>` +
    `<div class="agent-popup__time">${when}</div>` +
    tel + addr +
    "</div>"
  );
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function fitMapToMarkersIfNeeded(deviceIdsKey) {
  if (deviceIdsKey === lastDeviceIdsKey) return;
  lastDeviceIdsKey = deviceIdsKey;

  const layers = [...markers.values()];
  if (layers.length === 0) return;

  const bounds = L.featureGroup(layers).getBounds();
  map.flyToBounds(bounds.pad(0.12), {
    maxZoom: 14,
    duration: 1.25,
    easeLinearity: 0.25,
  });
}

function renderAgentPanel(devices) {
  deviceListEl.innerHTML = "";
  const n = devices.length;
  if (agentCountEl) agentCountEl.textContent = String(n);
  emptyStateEl.hidden = n > 0;

  const now = Date.now();

  for (const d of devices) {
    const online = isAgentOnline(d.lastUpdate, now);
    const ms = lastUpdateAsMs(d.lastUpdate);
    const timeEl =
      ms != null
        ? `<time class="agent-card__time" datetime="${escapeHtml(
            new Date(ms).toISOString()
          )}">${escapeHtml(formatLastUpdate(d.lastUpdate))}</time>`
        : `<span class="agent-card__time">—</span>`;

    const li = document.createElement("li");
    li.className = "agent-card";
    li.innerHTML = `
      <div class="agent-card__row">
        <span class="agent-card__id">${escapeHtml(d.name || d.id)}</span>
        <span class="status ${online ? "status--online" : "status--offline"}" role="status">
          ${online ? "Online" : "Offline"}
        </span>
      </div>
      <div class="agent-card__update">
        <span class="agent-card__label">Last update</span>
        ${timeEl}
      </div>
      ${d.phone ? `<div class="agent-card__phone">📞 ${escapeHtml(d.phone)}</div>` : ""}
      <div class="agent-card__coords">${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}</div>
      <div class="agent-card__address">📍 Chargement…</div>
    `;
    reverseGeocode(d.lat, d.lng).then((addr) => {
      const addrEl = li.querySelector(".agent-card__address");
      if (addrEl) addrEl.textContent = "📍 " + addr;
    });
    li.addEventListener("click", () => {
      const z = Math.max(map.getZoom(), 14);
      map.flyTo([d.lat, d.lng], z, { duration: 0.9, easeLinearity: 0.25 });
      const m = markers.get(d.id);
      if (m) m.openPopup();
      historyAgentSelect.value = d.id;
      refreshHistoryTrail();
    });
    deviceListEl.appendChild(li);
  }
}

function rowToDevice(id, row) {
  if (!row || typeof row !== "object") return null;
  const lat = typeof row.lat === "number" ? row.lat : null;
  const lng = typeof row.lng === "number" ? row.lng : null;
  if (lat == null || lng == null) return null;
  return {
    id,
    lat,
    lng,
    lastUpdate: row.lastUpdate ?? row.lastupdate ?? null,
    name: row.name || null,
    phone: row.phone || null,
  };
}

historyAgentSelect.addEventListener("change", refreshHistoryTrail);
historyDateInput.addEventListener("change", refreshHistoryTrail);

document.getElementById("btnSignOut")?.addEventListener("click", () => {
  signOut(auth).catch((e) => console.error(e));
});

/** Recompute Online/Offline as clock advances (no new RTDB event). */
setInterval(() => {
  if (cachedPanelDevices.length > 0) {
    renderAgentPanel(cachedPanelDevices);
  }
}, 10_000);

const agentsRef = ref(db, AGENTS_PATH);

onValue(
  agentsRef,
  (snapshot) => {
    const val = snapshot.val();
    latestAgentsVal = val;
    const devices = [];

    const allIds = val && typeof val === "object" ? Object.keys(val).sort() : [];
    syncHistoryAgentOptions(allIds);

    if (val && typeof val === "object") {
      for (const id of Object.keys(val)) {
        const dev = rowToDevice(id, val[id]);
        if (!dev) continue;

        devices.push(dev);

        const popupHtml = buildPopupHtml(dev.id, dev.lastUpdate, null, dev.name, dev.phone);
        let marker = markers.get(id);

        if (!marker) {
          marker = L.marker([dev.lat, dev.lng], {
            riseOnHover: true,
          }).addTo(map);
          marker.bindPopup(popupHtml, {
            className: "agent-popup",
            maxWidth: 280,
            autoPanPadding: [16, 16],
          });
          markers.set(id, marker);
        } else {
          moveMarkerSmooth(id, marker, dev.lat, dev.lng);
          marker.setPopupContent(popupHtml);
        }

        // Update popup with address once geocoded
        reverseGeocode(dev.lat, dev.lng).then((addr) => {
          const m = markers.get(id);
          if (m) m.setPopupContent(buildPopupHtml(dev.id, dev.lastUpdate, addr, dev.name, dev.phone));
        });
      }
    }

    const seen = new Set(devices.map((d) => d.id));
    markers.forEach((marker, id) => {
      if (!seen.has(id)) {
        stopMarkerMove(id);
        map.removeLayer(marker);
        markers.delete(id);
      }
    });

    devices.sort((a, b) => a.id.localeCompare(b.id));

    cachedPanelDevices = devices;
    renderAgentPanel(devices);

    const deviceIdsKey = devices.map((d) => d.id).join("|");
    if (devices.length > 0) {
      fitMapToMarkersIfNeeded(deviceIdsKey);
    } else {
      lastDeviceIdsKey = "";
      cachedPanelDevices = [];
      renderAgentPanel([]);
      map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.8, easeLinearity: 0.25 });
    }

    refreshHistoryTrail();
  },
  (err) => {
    console.error(err);
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = `Error: ${err.message || err}`;
  }
);
