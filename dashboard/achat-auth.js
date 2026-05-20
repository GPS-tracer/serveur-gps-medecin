/**
 * Page intermédiaire : login (déjà inscrit) ou inscription (nouveau).
 */
import { lireIntentAchat, aIntentAchatEnAttente, PAGE_CATALOGUE } from './intent-achat.js';
import { trouverOffreParIntent, libelleOffreIntent } from './chariow-paiement.js';
import { auth } from '../shared/firebase.js';

const recapEl = document.getElementById('achatAuthRecap');

async function init() {
  await auth.authStateReady();
  const user = auth.currentUser;

  if (user?.emailVerified) {
    window.location.replace(PAGE_CATALOGUE);
    return;
  }

  if (user && !user.emailVerified) {
    window.location.replace('login.html');
    return;
  }

  if (!aIntentAchatEnAttente()) {
    window.location.replace('register.html');
    return;
  }

  const intent = lireIntentAchat();
  const match  = trouverOffreParIntent(intent);

  if (recapEl && match) {
    const { offre, periode } = match;
    recapEl.hidden = false;
    recapEl.innerHTML = `
      <p class="achat-auth-recap__label">Offre sélectionnée</p>
      <p class="achat-auth-recap__titre">${offre.icon} ${offre.titre}</p>
      <p class="achat-auth-recap__prix">${periode.prixLabel}</p>
      <p class="achat-auth-recap__id">${periode.productId}</p>`;
  }

  const registerHref = lienInscriptionRecommande(intent?.offreType);
  const btnRegister = document.getElementById('btnAchatRegister');
  if (btnRegister) btnRegister.href = registerHref;
}

function lienInscriptionRecommande(offreType) {
  switch (offreType) {
    case 'eleve':    return 'register-eleve.html';
    case 'etudiant': return 'register-etudiant.html';
    default:         return 'register-entreprise.html';
  }
}

init();
