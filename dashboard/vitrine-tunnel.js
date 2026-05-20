/**
 * Grille tarifaire index.html (racine) — interception des clics produit.
 */
import { auth } from '../shared/firebase.js';
import {
  enregistrerIntentAchat,
  PAGE_CATALOGUE,
  PAGE_LOGIN,
} from './intent-achat.js';

const BASE = '/dashboard';

function destinationConnexion() {
  return `${BASE}/${PAGE_LOGIN}`;
}

function destinationCatalogue() {
  return `${BASE}/${PAGE_CATALOGUE}`;
}

async function traiterClicOffre(btn) {
  const productId = btn.dataset.vitrineProduct || '';
  const offreType   = btn.dataset.vitrineOffre   || '';
  const periode     = btn.dataset.vitrinePeriode || 'mensuel';

  if (!productId && !offreType) return;

  enregistrerIntentAchat({ productId, offreType, periode });

  await auth.authStateReady();
  const user = auth.currentUser;

  if (user?.emailVerified) {
    window.location.href = destinationCatalogue();
    return;
  }

  window.location.href = destinationConnexion();
}

function initVitrineTunnel() {
  document.querySelectorAll('[data-vitrine-offre]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      traiterClicOffre(btn);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initVitrineTunnel);
} else {
  initVitrineTunnel();
}
