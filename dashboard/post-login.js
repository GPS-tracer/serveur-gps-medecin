/**
 * Redirection après connexion — intention d'achat ou dashboard.
 */
import {
  aIntentAchatEnAttente,
  PAGE_CATALOGUE,
  PAGE_DASHBOARD_DEFAUT,
} from './intent-achat.js';

const PAGES_AUTORISEES = new Set([
  'index.html',
  'fleet.html',
  'rapport.html',
  'licence.html',
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
 * - produit en attente → licence.html (catalogue)
 * - sinon → fleet.html ou ?redirect=
 */
export function redirigerApresLogin(defaut = PAGE_DASHBOARD_DEFAUT) {
  if (aIntentAchatEnAttente()) {
    window.location.replace(PAGE_CATALOGUE);
    return;
  }
  window.location.replace(lireRedirectApresLogin(defaut));
}
