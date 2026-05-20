/**
 * Tunnel de conversion vitrine → login → catalogue Chariow.
 * Stocke l'intention d'achat en sessionStorage (même onglet).
 */

const KEY_PRODUCT  = 'gpts_selected_product';
const KEY_OFFRE    = 'gpts_selected_offre_type';
const KEY_PERIODE  = 'gpts_selected_offre_periode';

/**
 * @typedef {{ productId: string|null, offreType: string|null, periode: string }} IntentAchat
 */

/**
 * @param {{ productId?: string, offreType?: string, periode?: string }} intent
 */
export function enregistrerIntentAchat({ productId, offreType, periode = 'mensuel' } = {}) {
  if (productId) sessionStorage.setItem(KEY_PRODUCT, productId);
  else sessionStorage.removeItem(KEY_PRODUCT);

  if (offreType) sessionStorage.setItem(KEY_OFFRE, offreType);
  else sessionStorage.removeItem(KEY_OFFRE);

  sessionStorage.setItem(KEY_PERIODE, periode || 'mensuel');
}

/** @returns {IntentAchat|null} */
export function lireIntentAchat() {
  const productId = sessionStorage.getItem(KEY_PRODUCT);
  const offreType = sessionStorage.getItem(KEY_OFFRE);
  const periode   = sessionStorage.getItem(KEY_PERIODE) || 'mensuel';

  if (!productId && !offreType) return null;
  return {
    productId: productId || null,
    offreType: offreType || null,
    periode,
  };
}

export function aIntentAchatEnAttente() {
  return lireIntentAchat() !== null;
}

export function effacerIntentAchat() {
  sessionStorage.removeItem(KEY_PRODUCT);
  sessionStorage.removeItem(KEY_OFFRE);
  sessionStorage.removeItem(KEY_PERIODE);
}

/** Lit l'intention puis efface le stockage (évite les boucles de redirect). */
export function consommerIntentAchat() {
  const intent = lireIntentAchat();
  effacerIntentAchat();
  return intent;
}

/** Page catalogue après auth ou clic vitrine (utilisateur déjà connecté). */
export const PAGE_CATALOGUE = 'licence.html';

/** Tableau de bord par défaut sans intention d'achat. */
export const PAGE_DASHBOARD_DEFAUT = 'fleet.html';

export const PAGE_LOGIN = 'login.html';
