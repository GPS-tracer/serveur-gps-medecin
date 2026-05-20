/**
 * Redirection après connexion — évite d'envoyer l'utilisateur directement vers Chariow.
 */

const PAGES_AUTORISEES = new Set([
  'index.html',
  'fleet.html',
  'rapport.html',
  'licence.html',
]);

/**
 * Lit la cible post-login depuis ?redirect= ou ?next= (chemins relatifs dashboard uniquement).
 * @param {string} [defaut='index.html']
 */
export function lireRedirectApresLogin(defaut = 'index.html') {
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

/** Redirige vers la page demandée (ou défaut). */
export function redirigerApresLogin(defaut = 'index.html') {
  window.location.replace(lireRedirectApresLogin(defaut));
}
