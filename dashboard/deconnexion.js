/**
 * Déconnexion sécurisée — nettoie la session locale et redirige vers login.
 */
import { signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { auth } from '../shared/firebase.js';

/** Variables de session dashboard à effacer à la déconnexion */
export function nettoyerSessionLocale() {
  window.__userAccountStatus = null;
  try {
    sessionStorage.removeItem('gpts_session');
    sessionStorage.clear();
  } catch { /* ignore */ }
}

/**
 * Ferme la session côté serveur sécurisé et redirige (sans historique).
 * @param {string} [loginPath='login.html']
 */
export async function deconnecter(loginPath = 'login.html') {
  nettoyerSessionLocale();
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('[session] Erreur lors de la déconnexion :', err.message || err);
  }
  window.location.replace(loginPath);
}

/** Branche un bouton #btnSignOut (ou sélecteur custom) */
export function brancherBoutonDeconnexion(selector = '#btnSignOut', loginPath = 'login.html') {
  const btn = document.querySelector(selector);
  if (!btn || btn.dataset.logoutBound === '1') return;
  btn.dataset.logoutBound = '1';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    deconnecter(loginPath);
  });
}
