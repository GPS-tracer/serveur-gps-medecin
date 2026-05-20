import { aIntentAchatEnAttente, lireIntentAchat } from './intent-achat.js';
import { libelleOffreIntent } from './chariow-paiement.js';

const banner = document.getElementById('intentRegisterBanner');
if (banner && aIntentAchatEnAttente()) {
  const intent = lireIntentAchat();
  banner.textContent = `Après inscription et validation email, vous paierez : ${libelleOffreIntent(intent)}`;
  banner.classList.remove('hidden');
}
