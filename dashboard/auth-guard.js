/**
 * Auth Guard - Protège les routes du dashboard
 * Vérifie que l'utilisateur est connecté ET que son email est vérifié
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { deconnecter } from "./deconnexion.js";

const loadingEl = document.getElementById("auth-loading");
const dashboardRoot = document.getElementById("dashboard-root");

// Pages publiques qui ne nécessitent pas d'authentification
const PUBLIC_PAGES = ['login.html', 'register.html'];

// Vérifier si on est sur une page publique
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const isPublicPage = PUBLIC_PAGES.includes(currentPage);

async function estSuperadmin(user) {
  if (!user) return false;
  try {
    const [socSnap, compSnap] = await Promise.all([
      get(ref(db, `societes/${user.uid}/role`)).catch(() => ({ exists: () => false })),
      get(ref(db, `companies/${user.uid}/role`)).catch(() => ({ exists: () => false })),
    ]);
    const role = socSnap.exists() ? socSnap.val() : (compSnap.exists() ? compSnap.val() : null);
    return role === 'superadmin';
  } catch {
    return false;
  }
}

// Protéger les routes
onAuthStateChanged(auth, async (user) => {
  if (loadingEl) loadingEl.hidden = true;

  if (!user && !isPublicPage) {
    window.location.replace('login.html');
    return;
  }

  if (user && !user.emailVerified && !isPublicPage) {
    deconnecter('login.html');
    return;
  }

  if (user && user.emailVerified) {
    const isSuperadmin = await estSuperadmin(user);

    if (isPublicPage) {
      window.location.replace(isSuperadmin ? 'admin.html' : 'index.html');
      return;
    }

    if (isSuperadmin && currentPage !== 'admin.html') {
      window.location.replace('admin.html');
      return;
    }
  }

  if (dashboardRoot) {
    dashboardRoot.hidden = false;
  }
});

// Export pour utilisation dans d'autres fichiers
export function requireAuth() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      
      if (!user) {
        reject(new Error('User not authenticated'));
        window.location.replace('login.html');
        return;
      }
      
      if (!user.emailVerified) {
        reject(new Error('Email not verified'));
        window.location.replace('login.html');
        return;
      }
      
      resolve(user);
    });
  });
}
