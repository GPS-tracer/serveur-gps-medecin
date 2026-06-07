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
  // Vérifier si l'utilisateur connecté est superadmin (lire depuis societes + companies)
  try {
    const user = auth.currentUser;
    if (user) {
      console.log("[post-login] Vérification superadmin pour :", user.uid);
      
      const [socSnap, compSnap] = await Promise.all([
        get(ref(db, `societes/${user.uid}/role`)).catch(e => {
          console.warn("[post-login] Erreur lecture societes:", e.message);
          return { exists: () => false };
        }),
        get(ref(db, `companies/${user.uid}/role`)).catch(e => {
          console.warn("[post-login] Erreur lecture companies:", e.message);
          return { exists: () => false };
        }),
      ]);
      
      console.log("[post-login] societes existe?", socSnap.exists(), "val:", socSnap.exists() ? socSnap.val() : null);
      console.log("[post-login] companies existe?", compSnap.exists(), "val:", compSnap.exists() ? compSnap.val() : null);
      
      // Societes prioritaire
      const role = socSnap.exists() ? socSnap.val() : (compSnap.exists() ? compSnap.val() : null);
      console.log("[post-login] Rôle détecté:", role);
      
      if (role === 'superadmin') {
        console.log("[post-login] ✅ Superadmin détecté → redirection vers admin.html");
        window.location.replace('admin.html');
        return;
      }
    }
  } catch (err) {
    console.error("[post-login] Erreur redirection superadmin:", err);
    // En cas d'erreur réseau, continuer avec la redirection normale
  }

  if (aIntentAchatEnAttente()) {
    window.location.replace(PAGE_CATALOGUE);
    return;
  }
  window.location.replace(lireRedirectApresLogin(defaut));
}
