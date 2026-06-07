/**
 * Bootstrap pages app (fleet, rapport, licence) — exécuté en fin de <body>, module différé.
 */
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../shared/firebase.js";
import { estSuperadmin } from "./roles.js";
import { mountAppShell, initAppNavShell } from './nav-shell.js';

const activeId = document.body.dataset.navActive || '';
const pageTitle = document.body.dataset.navTitle || 'GPS Tracker';
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
  mountAppShell(activeId, pageTitle);
  initAppNavShell(activeId);
  document.documentElement.classList.add('shell-ready');

  if (pageModule) {
    await import(pageModule);
  }
} else {
  window.location.replace('admin.html');
}
