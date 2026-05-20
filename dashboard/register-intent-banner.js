import { aIntentAchatEnAttente, lireIntentAchat } from './intent-achat.js';

const LIBELLES_OFFRE = {
  wifi:        'Option Réseau — 150 FCFA/mois',
  particulier: 'Particulier Premium — 10 000 FCFA/mois',
  eleve:       'Suivi Élève — 3 000 FCFA/mois',
  etudiant:    'Suivi Étudiant — 3 000 FCFA/mois',
  flotte:      'Forfait Flotte B2B — 25 000 FCFA/mois',
  illimite:    'Accès Illimité — 20 000 FCFA',
};

function libelleIntent(intent) {
  if (!intent) return 'votre offre';
  if (intent.offreType && LIBELLES_OFFRE[intent.offreType]) {
    return LIBELLES_OFFRE[intent.offreType];
  }
  if (intent.productId) return `produit ${intent.productId}`;
  return 'votre offre';
}

const banner = document.getElementById('intentRegisterBanner');
if (banner && aIntentAchatEnAttente()) {
  const intent = lireIntentAchat();
  banner.textContent = `Après inscription et validation email, vous paierez : ${libelleIntent(intent)}`;
  banner.classList.remove('hidden');
}
