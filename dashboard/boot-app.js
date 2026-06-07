/**
 * Bootstrap pages app (fleet, rapport, licence) — exécuté en fin de <body>, module différé.
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { mountAppShell, initAppNavShell } from './nav-shell.js';

const activeId = document.body.dataset.navActive || '';
const pageTitle = document.body.dataset.navTitle || 'GPS Tracker';
const pageModule = document.body.dataset.pageModule || '';
const currentPage = window.location.pathname.split('/').pop() || '';

async function isSuperadmin(user) {
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

const authReady = new Promise((resolve) => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    unsubscribe();
    resolve(user);
  });
});

const user = await authReady;
const shouldRedirect = user && user.emailVerified && currentPage !== 'admin.html'
  ? await isSuperadmin(user)
  : false;

if (!shouldRedirect) {
  mountAppShell(activeId, pageTitle);
  initAppNavShell(activeId);
  document.documentElement.classList.add('shell-ready');

  if (pageModule) {
    await import(pageModule);
  }
} else {
  window.location.replace('admin.html');
}
