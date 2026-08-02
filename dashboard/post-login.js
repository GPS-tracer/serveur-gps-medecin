/**
 * Redirection après connexion — intention d'achat ou dashboard.
 * Si le compte a role = "superadmin" → redirige vers admin.html
 * Si le compte a role = "eleve" ou "etudiant" → redirige vers mobile-only.html
 */
import {
  aIntentAchatEnAttente,
  PAGE_CATALOGUE,
  PAGE_DASHBOARD_DEFAUT,
} from './intent-achat.js';
import { auth, db } from '../shared/firebase.js';
import { get, ref } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { estSuperadmin, lireRole, estRoleMobileUniquement } from './roles.js';

const PAGES_AUTORISEES = new Set([
  'index.html',
  'fleet.html',
  'rapport.html',
  'licence.html',
  'admin.html',
]);

/**
 * Lit ?redirect= / ?next= (priorité moindre que intention d'achat).
 * @param {string} [defaut]
 */
export function lireRedirectApresLogin(defaut = PAGE_DASHBOARD_DEFAUT) {
  const params = new URLSearchParams(window.location.search);
  const brut = (params.get('redirect') || params.get('next') || '').trim();
  if (!brut) return defaut;

  try {
    const url = new URL(brut, window.location.href);
    const path = url.pathname.split('/').pop() || '';
    if (PAGES_AUTORISEES.has(path)) return path;
  } catch {
    const simple = brut.replace(/^\/+/, '').split('?')[0];
    if (PAGES_AUTORISEES.has(simple)) return simple;
  }

  return defaut;
}

/**
 * Après auth réussie :
 * - superadmin           → admin.html
 * - eleve / etudiant     → mobile-only.html
 * - produit en attente   → licence.html (catalogue)
 * - sinon                → fleet.html ou ?redirect=
 */
let redirectionEnCours = false;

export async function redirigerApresLogin(defaut = PAGE_DASHBOARD_DEFAUT, user = auth.currentUser) {
  if (redirectionEnCours) return;
  redirectionEnCours = true;

  try {
    if (user && await estSuperadmin(user)) {
      window.location.replace('admin.html');
      return;
    }
  } catch (err) {
    console.error("[post-login] Erreur redirection superadmin:", err);
    redirectionEnCours = false;
  }

  // Bloquer les rôles mobile-uniquement (élève / étudiant)
  try {
    if (user) {
      const role = await lireRole(user);
      if (estRoleMobileUniquement(role)) {
        window.location.replace('mobile-only.html');
        return;
      }
    }
  } catch (err) {
    console.error("[post-login] Erreur vérification rôle mobile:", err);
    redirectionEnCours = false;
  }

  if (aIntentAchatEnAttente()) {
    window.location.replace(PAGE_CATALOGUE);
    return;
  }
  window.location.replace(lireRedirectApresLogin(defaut));
}
