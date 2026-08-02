/**
 * Bootstrap pages app (fleet, rapport, licence) — exécuté en fin de <body>, module différé.
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { estSuperadmin } from "./roles.js";
import { mountAppShell, initAppNavShell, APP_NAV } from './nav-shell.js';

const activeId   = document.body.dataset.navActive  || '';
const pageTitle  = document.body.dataset.navTitle   || 'GPS Tracker';
const pageModule = document.body.dataset.pageModule || '';
const currentPage = window.location.pathname.split('/').pop() || '';

const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    resolve(user);
  });
});

const user = await authReady;
const shouldRedirect = user && user.emailVerified && currentPage !== 'admin.html'
  ? await estSuperadmin(user)
  : false;

if (!shouldRedirect) {
  // ── Adapter le label "Ma Flotte" selon le type de compte ──
  if (user) {
    try {
      const snap    = await get(ref(db, `companies/${user.uid}`));
      const company = snap.val() || {};
      const accountType    = company.accountType || company.role || 'company';
      const typeAbonnement = company.licence?.type_abonnement || null;

      const navFlotte = APP_NAV.find(n => n.id === 'flotte');
      if (navFlotte) {
        if (accountType === 'particulier' || company.role === 'particulier') {
          navFlotte.label = 'Mon appareil';
          navFlotte.icon  = '📱';
        } else if (typeAbonnement === 'suivi_eleve') {
          navFlotte.label = 'Mes élèves';
          navFlotte.icon  = '🎒';
        } else if (typeAbonnement === 'suivi_etudiant') {
          navFlotte.label = 'Mes étudiants';
          navFlotte.icon  = '🎓';
        }
      }

      // Adapter aussi le data-nav-title si on est sur fleet.html
      if (activeId === 'flotte' && navFlotte) {
        document.body.dataset.navTitle = navFlotte.label;
      }
    } catch { /* silencieux — on garde le label par défaut */ }
  }

  mountAppShell(activeId, pageTitle);
  initAppNavShell(activeId);
  document.documentElement.classList.add('shell-ready');

  if (pageModule) {
    await import(pageModule);
  }
} else {
  window.location.replace('admin.html');
}
