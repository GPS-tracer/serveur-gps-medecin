/**
 * roles.js — Utilitaires de gestion des rôles utilisateurs
 */
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { db } from "../shared/firebase.js";

/**
 * Vérifie si l'utilisateur connecté est superadmin.
 * Lit le champ role dans companies/{uid} dans la RTDB.
 * @param {import("firebase/auth").User} user
 * @returns {Promise<boolean>}
 */
export async function estSuperadmin(user) {
  if (!user) return false;
  try {
    const snap = await get(ref(db, `companies/${user.uid}/role`));
    return snap.exists() && snap.val() === 'superadmin';
  } catch {
    return false;
  }
}

/**
 * Fusionne les données du profil société depuis companies/ et societes/.
 * companies/ contient les infos d'inscription (nom, email, rôle…).
 * societes/ contient les données temps réel (agents, positions…).
 * @param {object} company  — données de companies/{uid}
 * @param {object} societe  — données de societes/{uid}
 * @returns {object}
 */
export function fusionnerProfil(company, societe) {
  return {
    ...societe,
    ...company,
    // Priorité à companies/ pour le nom et le logo
    companyName: company.companyName || societe.companyName || null,
    logoUrl:     company.logoUrl     || societe.logoUrl     || null,
    role:        company.role        || 'company',
  };
}
