/**
 * Redirection après connexion — intention d'achat ou dashboard.
 * Si le compte a role = "superadmin" → redirige vers admin.html
 */
import {
  aIntentAchatEnAttente,
  PAGE_CATALOGUE,
  PAGE_DASHBOARD_DEFAUT,
} from './intent-achat.js';
import { auth, db } from '../shared/firebase.js';
import { get, ref } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

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
 * - produit en attente   → licence.html (catalogue)
 * - sinon                → fleet.html ou ?redirect=
 */
export async function redirigerApresLogin(defaut = PAGE_DASHBOARD_DEFAUT) {
  // Vérifier si l'utilisateur connecté est superadmin
  try {
    const user = auth.currentUser;
    if (user) {
      const snap = await get(ref(db, `companies/${user.uid}/role`));
      if (snap.exists() && snap.val() === 'superadmin') {
        window.location.replace('admin.html');
        return;
      }
    }
  } catch {
    // En cas d'erreur réseau, continuer avec la redirection normale
  }

  if (aIntentAchatEnAttente()) {
    window.location.replace(PAGE_CATALOGUE);
    return;
  }
  window.location.replace(lireRedirectApresLogin(defaut));
}
