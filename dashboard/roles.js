/**
 * Résolution du rôle utilisateur entre societes/ et companies/.
 * superadmin dans l'un OU l'autre chemin prime sur les autres rôles.
 */
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { db } from "../shared/firebase.js";

export function fusionnerRole(societeRole, companyRole) {
  if (societeRole === "superadmin" || companyRole === "superadmin") return "superadmin";
  return societeRole ?? companyRole ?? null;
}

function extraireRole(snap) {
  if (!snap?.exists?.()) return null;
  const val = snap.val();
  return typeof val === "string" ? val : (val?.role ?? null);
}

export async function lireRoles(uid) {
  const [socSnap, compSnap] = await Promise.all([
    get(ref(db, `societes/${uid}`)).catch(() => null),
    get(ref(db, `companies/${uid}`)).catch(() => null),
  ]);
  return {
    societeRole: extraireRole(socSnap),
    companyRole: extraireRole(compSnap),
  };
}

async function estSuperadminViaApi(user) {
  const token = await user.getIdToken();
  const res = await fetch("/api/user/role", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.isSuperadmin === true;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function estSuperadmin(user) {
  if (!user?.uid) return false;

  try {
    await user.getIdToken();
  } catch {
    return false;
  }

  try {
    const viaApi = await estSuperadminViaApi(user);
    if (viaApi === true) return true;
    if (viaApi === false) return false;
  } catch (err) {
    console.warn("[roles] Vérification API échouée, repli RTDB:", err?.message);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { societeRole, companyRole } = await lireRoles(user.uid);
    if (fusionnerRole(societeRole, companyRole) === "superadmin") return true;
    if (societeRole != null || companyRole != null) return false;
    if (attempt < 2) await pause(400);
  }

  return false;
}

export function fusionnerProfil(company = {}, societe = {}) {
  return {
    ...company,
    ...societe,
    role: fusionnerRole(societe.role, company.role),
    licence: { ...(company.licence || {}), ...(societe.licence || {}) },
  };
}
