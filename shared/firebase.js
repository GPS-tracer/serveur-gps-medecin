/**
 * Shared Firebase — Realtime Database + Authentication (modular SDK).
 *
 * Console: enable Realtime Database, Authentication → Email/Password.
 * Add `authDomain` (already in config) and your web app keys.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/** @type {import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js").FirebaseOptions} */
const firebaseConfig = {
  apiKey: "AIzaSyBB1R8n7ll3jyAUf6aNu4PL4gH1Y-9bKEY",
  authDomain: "db-tracker-d39a7.firebaseapp.com",
  databaseURL: "https://db-tracker-d39a7-default-rtdb.firebaseio.com",
  projectId: "db-tracker-d39a7",
  storageBucket: "db-tracker-d39a7.firebasestorage.app",
  messagingSenderId: "884233207805",
  appId: "1:884233207805:web:45d8d505970be1ac856394",
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);

/** Firebase Auth (email/password on dashboard) */
export const auth = getAuth(app);

/** Root path for agent nodes */
export const AGENTS_PATH = "agents";

const INVALID_AGENT_ID = /[.#$\[\]/]/;

function assertValidAgentId(agentId) {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  if (!id) {
    throw new Error("sendLocation: agentId is required");
  }
  if (INVALID_AGENT_ID.test(id)) {
    throw new Error(
      "sendLocation: agentId must not contain . # $ [ ] /"
    );
  }
  return id;
}

function normalizeTimestamp(timestamp) {
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    return timestamp;
  }
  const n = Number(timestamp);
  if (Number.isFinite(n)) return n;
  return Date.now();
}

export async function sendLocation(agentId, latitude, longitude, timestamp, meta = {}) {
  const id = assertValidAgentId(agentId);
  const ts = normalizeTimestamp(timestamp);
  const tsKey = String(ts);
  const prefix = `${AGENTS_PATH}/${id}`;
  const updates = {
    [`${prefix}/lastUpdate`]: ts,
    [`${prefix}/lat`]: latitude,
    [`${prefix}/lng`]: longitude,
    [`${prefix}/history/${tsKey}`]: { lat: latitude, lng: longitude },
  };
  if (meta.name) updates[`${prefix}/name`] = meta.name;
  if (meta.phone) updates[`${prefix}/phone`] = meta.phone;
  await update(ref(db), updates);
}
