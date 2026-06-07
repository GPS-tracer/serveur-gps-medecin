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

export async function lireRoles(uid) {
  const [socSnap, compSnap] = await Promise.all([
    get(ref(db, `societes/${uid}/role`)).catch(() => null),
    get(ref(db, `companies/${uid}/role`)).catch(() => null),
  ]);
  const societeRole = socSnap?.exists?.() ? socSnap.val() : null;
  const companyRole = compSnap?.exists?.() ? compSnap.val() : null;
  return { societeRole, companyRole };
}

export async function estSuperadmin(user) {
  if (!user?.uid) return false;
  const { societeRole, companyRole } = await lireRoles(user.uid);
  return fusionnerRole(societeRole, companyRole) === "superadmin";
}

export function fusionnerProfil(company = {}, societe = {}) {
  return {
    ...company,
    ...societe,
    role: fusionnerRole(societe.role, company.role),
    licence: { ...(company.licence || {}), ...(societe.licence || {}) },
  };
}
