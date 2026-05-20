/**
 * Réveil serveur + auth dashboard (index.html) — fin de <body>, non bloquant.
 */
import { waitForServerWake } from './splash-wake.js';

const statusEl = document.getElementById('splash-status');

await waitForServerWake({
  onStatus: (msg) => { if (statusEl) statusEl.textContent = msg; },
});

if (statusEl) {
  statusEl.textContent = 'Connexion sécurisée établie, vérification de votre session...';
}

await import('./bootstrap.js');
