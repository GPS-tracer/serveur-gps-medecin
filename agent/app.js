/**
 * GPS tracking: watchPosition, throttled sync to Firebase, offline queue in localStorage.
 * Uses navigator.onLine + online/offline events; flushes queue when back online.
 */

import { sendLocation } from "../shared/firebase.js";

const deviceIdInput = document.getElementById("deviceId");
const agentNameInput = document.getElementById("agentName");
const agentPhoneInput = document.getElementById("agentPhone");
const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const statusEl = document.getElementById("status");
const connectionBadge = document.getElementById("connectionBadge");
const connectionText = document.getElementById("connectionText");
const latEl = document.getElementById("lat");
const lngEl = document.getElementById("lng");
const accEl = document.getElementById("acc");
const updatedEl = document.getElementById("updated");
const lastSentEl = document.getElementById("lastSent");

/** Minimum time between recorded points (sent or queued) */
const SEND_INTERVAL_MS = 4000;

/** localStorage key for offline queue */
const QUEUE_KEY = "gps-tracker-pending-locations";

/** Avoid unbounded storage if offline a long time (drop oldest) */
const MAX_QUEUE_LENGTH = 800;

const DEVICE_STORAGE_KEY = "gps-tracker-device-id";
const AGENT_NAME_KEY = "gps-tracker-agent-name";
const AGENT_PHONE_KEY = "gps-tracker-agent-phone";

let watchId = null;
/** Last time we recorded a point for throttling (send or enqueue) */
let lastRecordedAt = 0;
let activeAgentId = "";
/** Prevents overlapping flush runs */
let flushRunning = false;

// --- Queue (localStorage) ---

/**
 * @returns {{ agentId: string, lat: number, lng: number, timestamp: number }[]}
 */
function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (row) =>
        row &&
        typeof row.agentId === "string" &&
        typeof row.lat === "number" &&
        typeof row.lng === "number" &&
        typeof row.timestamp === "number"
    );
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  if (queue.length === 0) {
    localStorage.removeItem(QUEUE_KEY);
    return;
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function getPendingCount() {
  return loadQueue().length;
}

/**
 * Append one offline point; trim oldest if over max size.
 */
function enqueuePoint(entry) {
  const q = loadQueue();
  q.push(entry);
  while (q.length > MAX_QUEUE_LENGTH) q.shift();
  saveQueue(q);
}

/**
 * Send queued points in order. On failure, keep the rest and stop.
 * When empty, removes QUEUE_KEY (successful full sync).
 */
async function flushPendingQueue() {
  if (!navigator.onLine || flushRunning) return;

  let queue = loadQueue();
  if (queue.length === 0) {
    localStorage.removeItem(QUEUE_KEY);
    return;
  }

  flushRunning = true;
  try {
    while (queue.length > 0 && navigator.onLine) {
      const item = queue[0];
      try {
        await sendLocation(item.agentId, item.lat, item.lng, item.timestamp, item.meta || {});
        queue.shift();
        saveQueue(queue);
      } catch (e) {
        console.error("Flush item failed:", e);
        saveQueue(queue);
        break;
      }
    }

    if (queue.length === 0) {
      localStorage.removeItem(QUEUE_KEY);
    }
  } finally {
    flushRunning = false;
  }
}

function loadOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (!id) {
    id = `device-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(DEVICE_STORAGE_KEY, id);
  }
  deviceIdInput.value = id;
  agentNameInput.value = localStorage.getItem(AGENT_NAME_KEY) || "";
  agentPhoneInput.value = localStorage.getItem(AGENT_PHONE_KEY) || "";
}

function setConnection(connected) {
  connectionBadge.classList.toggle("connection--connected", connected);
  connectionBadge.classList.toggle("connection--disconnected", !connected);
  connectionText.textContent = connected ? "Connected" : "Disconnected";
}

function setDetailStatus(text, variant = "neutral") {
  statusEl.textContent = text;
  statusEl.classList.remove("status--error", "status--warn");
  if (variant === "error") statusEl.classList.add("status--error");
  if (variant === "warn") statusEl.classList.add("status--warn");
}

function formatTime(d) {
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" });
}

function geolocationErrorMessage(err) {
  const code = err && typeof err.code === "number" ? err.code : 0;
  if (code === 1) {
    return {
      short:
        "Permission denied — allow location for this site in browser or system settings.",
      variant: "error",
    };
  }
  if (code === 2) {
    return {
      short:
        "Location unavailable — turn on GPS/location services and try again (outdoors helps).",
      variant: "error",
    };
  }
  if (code === 3) {
    return {
      short: "Location timed out — move to open sky or tap Start again.",
      variant: "warn",
    };
  }
  return {
    short: err?.message ? `Location error: ${err.message}` : "Location error.",
    variant: "error",
  };
}

function teardownWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

function resetUiAfterStop() {
  teardownWatch();
  btnStart.disabled = false;
  btnStop.disabled = true;
  setConnection(false);
  activeAgentId = "";
  lastRecordedAt = 0;
}

/**
 * Throttle, then either send to Firebase or enqueue. Refreshes UI + tries flush after live send.
 */
async function maybeSendToFirebase(agentId, lat, lng) {
  const now = Date.now();
  if (now - lastRecordedAt < SEND_INTERVAL_MS) return;

  const meta = {
    name: localStorage.getItem(AGENT_NAME_KEY) || "",
    phone: localStorage.getItem(AGENT_PHONE_KEY) || "",
  };
  const entry = { agentId, lat, lng, timestamp: now, meta };
  lastRecordedAt = now;

  if (!navigator.onLine) {
    enqueuePoint(entry);
    setConnection(false);
    setDetailStatus(
      `Offline — saved locally (${getPendingCount()} pending). Will sync when online.`,
      "warn"
    );
    return;
  }

  try {
    await sendLocation(agentId, lat, lng, now, meta);
    lastSentEl.textContent = formatTime(new Date(now));
    setConnection(true);
    setDetailStatus(
      `Synced (${Math.round(SEND_INTERVAL_MS / 1000)}s min. interval)`,
      "neutral"
    );
    await flushPendingQueue();
    refreshStatusAfterFlush();
  } catch (e) {
    console.error(e);
    enqueuePoint(entry);
    setConnection(false);
    setDetailStatus(
      `Sync failed — saved locally (${getPendingCount()} pending). ${e.message || e}`,
      "warn"
    );
  }
}

/** Update message after queue sync (e.g. pending went to 0) */
function refreshStatusAfterFlush() {
  const pending = getPendingCount();
  if (pending > 0) {
    setDetailStatus(
      navigator.onLine
        ? `Synced with backlog — ${pending} still pending (retrying…)`
        : `Offline — ${pending} pending.`,
      "warn"
    );
    return;
  }
  if (activeAgentId && watchId != null) {
    setConnection(true);
    setDetailStatus(
      `Synced (${Math.round(SEND_INTERVAL_MS / 1000)}s min. interval)`,
      "neutral"
    );
  }
}

function start() {
  const agentId = deviceIdInput.value.trim();
  if (!agentId) {
    setDetailStatus("Enter a device ID.", "error");
    setConnection(false);
    return;
  }
  localStorage.setItem(DEVICE_STORAGE_KEY, agentId);
  const agentName = agentNameInput.value.trim();
  const agentPhone = agentPhoneInput.value.trim();
  if (agentName) localStorage.setItem(AGENT_NAME_KEY, agentName);
  if (agentPhone) localStorage.setItem(AGENT_PHONE_KEY, agentPhone);

  if (!navigator.geolocation) {
    setDetailStatus("Geolocation is not supported in this browser.", "error");
    setConnection(false);
    return;
  }

  if (watchId != null) teardownWatch();

  activeAgentId = agentId;
  lastRecordedAt = 0;
  setConnection(false);
  const pending = getPendingCount();
  setDetailStatus(
    pending > 0 && navigator.onLine
      ? `Acquiring GPS… (${pending} offline points will sync)`
      : "Acquiring GPS…",
    "neutral"
  );
  btnStart.disabled = true;
  btnStop.disabled = false;

  if (navigator.onLine) {
    flushPendingQueue().then(refreshStatusAfterFlush);
  }

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      latEl.textContent = latitude.toFixed(6);
      lngEl.textContent = longitude.toFixed(6);
      accEl.textContent = accuracy != null ? String(Math.round(accuracy)) : "—";
      updatedEl.textContent = formatTime(new Date());

      try {
        await maybeSendToFirebase(activeAgentId, latitude, longitude);
      } catch (e) {
        console.error(e);
        setConnection(false);
        setDetailStatus(`Error: ${e.message || e}`, "error");
      }
    },
    (err) => {
      console.error(err);
      const { short, variant } = geolocationErrorMessage(err);
      setConnection(false);
      resetUiAfterStop();
      setDetailStatus(short, variant);
    },
    {
      enableHighAccuracy: true,
      maximumAge: SEND_INTERVAL_MS,
      timeout: 20000,
    }
  );
}

function stop() {
  teardownWatch();
  btnStart.disabled = false;
  btnStop.disabled = true;
  setConnection(false);
  activeAgentId = "";
  lastRecordedAt = 0;
  const n = getPendingCount();
  setDetailStatus(
    n > 0
      ? `Stopped — ${n} point(s) still in storage; open the app online to sync.`
      : "Stopped — press Start to track again",
    n > 0 ? "warn" : "neutral"
  );
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const swUrl = new URL("../sw.js", import.meta.url);
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(swUrl, { scope: "/" })
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}

function wireNetworkListeners() {
  window.addEventListener("online", async () => {
    await flushPendingQueue();
    refreshStatusAfterFlush();
  });

  window.addEventListener("offline", () => {
    setConnection(false);
    const n = getPendingCount();
    if (activeAgentId && watchId != null) {
      setDetailStatus(
        n > 0
          ? `Offline — ${n} pending in storage.`
          : "Offline — new fixes will be saved locally.",
        "warn"
      );
    }
  });
}

loadOrCreateDeviceId();
setConnection(false);
wireNetworkListeners();

// Startup: if browser reports online, push any leftover queue
if (navigator.onLine) {
  flushPendingQueue().then(() => {
    const n = getPendingCount();
    if (n > 0) {
      setDetailStatus(`Ready — ${n} offline point(s) queued; will sync when possible.`, "warn");
    }
  });
} else {
  const n = getPendingCount();
  if (n > 0) {
    setDetailStatus(`Offline — ${n} point(s) waiting to sync.`, "warn");
  }
}

btnStart.addEventListener("click", start);
btnStop.addEventListener("click", stop);
registerServiceWorker();
