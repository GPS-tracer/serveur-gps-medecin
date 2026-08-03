/**
 * roles.js — Utilitaires de gestion des rôles utilisateurs
 */
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { db } from "../shared/firebase.js";

/** Rôles qui n'ont pas accès au dashboard web — uniquement app mobile. */
export const ROLES_MOBILE_UNIQUEMENT = new Set(['eleve', 'etudiant']);

/**
 * Lit le rôle d'un utilisateur depuis companies/{uid}/role.
 * @param {import("firebase/auth").User} user
 * @returns {Promise<string|null>}
 */
export async function lireRole(user) {
  if (!user) return null;
  try {
    const snap = await get(ref(db, `companies/${user.uid}/role`));
    return snap.exists() ? snap.val() : null;
  } catch {
    return null;
  }
}

/**
 * Vérifie si l'utilisateur connecté est superadmin.
 * Lit le champ role dans companies/{uid} dans la RTDB.
 * @param {import("firebase/auth").User} user
 * @returns {Promise<boolean>}
 */
export async function estSuperadmin(user) {
  if (!user) return false;
  try {
    const role = await lireRole(user);
    return role === 'superadmin';
  } catch {
    return false;
  }
}

/**
 * Vérifie si le rôle est réservé à l'app mobile uniquement (élève / étudiant).
 * @param {string|null} role
 * @returns {boolean}
 */
export function estRoleMobileUniquement(role) {
  return ROLES_MOBILE_UNIQUEMENT.has(role);
}

/**
 * Normalise le profil société lu depuis companies/{uid} (source unique du
 * profil — voir server.js `ecrireProfilSociete`). Le paramètre `societe`
 * est conservé pour compatibilité ascendante des appels existants mais
 * n'est plus nécessaire : societes/{uid} ne contient plus que les données
 * temps réel (agents, positions GPS), pas le profil.
 * @param {object} company  — données de companies/{uid}
 * @param {object} [societe] — @deprecated, ignoré
 * @returns {object}
 */
export function fusionnerProfil(company = {}, societe = {}) {
  return {
    ...company,
    companyName:  company.companyName  || null,
    logoUrl:      company.logoUrl      || null,
    role:         company.role         || 'company',
    accountType:  company.accountType  || company.role || 'company',
  };
}
