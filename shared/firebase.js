/**
 * Connexion GPTS — base de données temps réel + authentification (SDK modulaire).
 * Configuration serveur sécurisé (domaine auth + clés application web).
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

/** Authentification serveur sécurisé (email / mot de passe) */
export const auth = getAuth(app);

/**
 * Retourne le chemin RTDB des agents d'une société.
 * Structure alignée avec l'app Android : societes/{companyId}/agents
 *
 * @param {string} companyId  Identifiant société (session sécurisée)
 * @returns {string}
 */
export function agentsPath(companyId) {
  if (!companyId) throw new Error("agentsPath: companyId requis");
  return `societes/${companyId}/agents`;
}

/**
 * @deprecated Utiliser agentsPath(companyId) à la place.
 * Conservé pour rétrocompatibilité — pointe vers l'ancienne collection.
 */
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

/**
 * Envoie une position GPS vers Firebase RTDB.
 * Chemin : societes/{companyId}/agents/{agentId}
 *
 * @param {string} agentId
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} timestamp
 * @param {{ name?: string, phone?: string, companyId?: string }} meta
 */
export async function sendLocation(agentId, latitude, longitude, timestamp, meta = {}) {
  const id       = assertValidAgentId(agentId);
  const ts       = normalizeTimestamp(timestamp);
  const tsKey    = String(ts);
  const companyId = meta.companyId || null;

  // Chemin principal : societes/{companyId}/agents/{agentId}
  // Fallback sur l'ancienne structure si companyId absent (rétrocompatibilité)
  const prefix = companyId
    ? `societes/${companyId}/agents/${id}`
    : `agents/${id}`;

  const updates = {
    [`${prefix}/lastUpdate`]: ts,
    [`${prefix}/lat`]:        latitude,
    [`${prefix}/lng`]:        longitude,
    [`${prefix}/history/${tsKey}`]: { lat: latitude, lng: longitude },
  };
  if (meta.name)      updates[`${prefix}/name`]  = meta.name;
  if (meta.phone)     updates[`${prefix}/phone`] = meta.phone;
  if (meta.companyId) updates[`${prefix}/companyId`] = meta.companyId;

  await update(ref(db), updates);
}
