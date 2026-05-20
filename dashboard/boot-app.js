/**
 * Bootstrap pages app (fleet, rapport, licence) — exécuté en fin de <body>, module différé.
 */
import { mountAppShell, initAppNavShell } from './nav-shell.js';

const activeId = document.body.dataset.navActive || '';
const pageTitle = document.body.dataset.navTitle || 'GPS Tracker';
const pageModule = document.body.dataset.pageModule || '';

mountAppShell(activeId, pageTitle);
initAppNavShell(activeId);
document.documentElement.classList.add('shell-ready');

if (pageModule) {
  await import(pageModule);
}
