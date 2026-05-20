/**
 * Paiements Chariow centralisés — URLs avec UID pour le webhook.
 *
 * STRATÉGIE ANTI-POPUP-BLOCKER :
 * Les boutons [data-chariow-offre] sont transformés en <a href> réels
 * dès que l'UID est connu. Le clic est 100% natif → jamais bloqué.
 */
import { CHARIOW_PRODUCTS, CHARIOW_SHOP_BASE } from '../shared/firebase.js';

const OFFRES_VALIDEES  = new Set(['wifi', 'particulier', 'eleve', 'etudiant', 'flotte', 'illimite']);
const PERIODES_VALIDEES = new Set(['mensuel', 'annuel']);

/**
 * Résout l'ID produit Chariow selon le type d'offre et la période.
 */
export function resoudreProduitChariow(typeOffre, periode) {
  const type   = (typeOffre || '').toLowerCase();
  const annuel = (periode || '').toLowerCase() === 'annuel';

  switch (type) {
    case 'wifi':        return annuel ? CHARIOW_PRODUCTS.WIFI_ANNUEL        : CHARIOW_PRODUCTS.WIFI_MENSUEL;
    case 'particulier': return annuel ? CHARIOW_PRODUCTS.PARTICULIER_ANNUEL : CHARIOW_PRODUCTS.PARTICULIER_MENSUEL;
    case 'eleve':       return annuel ? CHARIOW_PRODUCTS.ELEVE_ANNUEL       : CHARIOW_PRODUCTS.ELEVE_MENSUEL;
    case 'etudiant':    return annuel ? CHARIOW_PRODUCTS.ETUDIANT_ANNUEL    : CHARIOW_PRODUCTS.ETUDIANT_MENSUEL;
    case 'flotte':      return CHARIOW_PRODUCTS.FORFAIT_FLOTTE;
    case 'illimite':    return CHARIOW_PRODUCTS.ACCES_ILLIMITE;
    default:            return null;
  }
}

/**
 * Construit l'URL de paiement Chariow avec l'UID société.
 */
export function construireUrlChariow(typeOffre, periode, uid) {
  const productId = resoudreProduitChariow(typeOffre, periode);
  if (!productId) throw new Error(`Offre Chariow inconnue : ${typeOffre} / ${periode}`);
  if (!uid)       throw new Error('Identifiant utilisateur requis pour le paiement.');
  return `${CHARIOW_SHOP_BASE}/${productId}?uid=${encodeURIComponent(uid)}`;
}

/**
 * Injecte les href Chariow sur tous les boutons [data-chariow-offre].
 * Transforme chaque <button> en <a> natif — clic garanti sans popup blocker.
 *
 * @param {string} uid — UID Firebase Auth
 */
export function injecterLiensChariow(uid) {
  if (!uid) return;

  document.querySelectorAll('[data-chariow-offre]').forEach((el) => {
    const type   = el.dataset.chariowOffre   || '';
    const periode = el.dataset.chariowPeriode || 'mensuel';

    try {
      const url = construireUrlChariow(type, periode, uid);

      // Si c'est déjà un <a>, on met juste le href
      if (el.tagName === 'A') {
        el.href   = url;
        el.target = '_blank';
        el.rel    = 'noopener noreferrer';
        return;
      }

      // Sinon on remplace le <button> par un <a> avec les mêmes classes/contenu
      const a = document.createElement('a');
      a.href      = url;
      a.target    = '_blank';
      a.rel       = 'noopener noreferrer';
      a.className = el.className;
      a.innerHTML = el.innerHTML;
      // Copier les data-attributes
      Object.assign(a.dataset, el.dataset);
      el.replaceWith(a);
    } catch {
      // Offre inconnue — on laisse le bouton tel quel
    }
  });
}

/**
 * @deprecated Utiliser injecterLiensChariow(uid) à la place.
 * Conservé pour compatibilité avec l'ancien code.
 */
export function declencherPaiementChariow(typeOffre, periode, uid) {
  const url = construireUrlChariow(
    (typeOffre || '').toLowerCase(),
    (periode   || 'mensuel').toLowerCase(),
    uid,
  );
  // Ouverture directe — fonctionne uniquement si appelé depuis un vrai clic synchrone
  window.location.href = url; // fallback absolu : navigation dans l'onglet courant
}

/** Libellés et prix officiels des 10 produits Chariow */
export const OFFRES_CHARIOW_AFFICHAGE = [
  { type: 'wifi',        periode: 'mensuel', label: 'Option Anti-vol Réseau',  prix: '200 FCFA/mois'    },
  { type: 'wifi',        periode: 'annuel',  label: 'Option Anti-vol Réseau',  prix: '1 670 FCFA/an'    },
  { type: 'particulier', periode: 'mensuel', label: 'Particulier Premium',     prix: '10 000 FCFA/mois' },
  { type: 'particulier', periode: 'annuel',  label: 'Particulier Premium',     prix: '111 240 FCFA/an'  },
  { type: 'eleve',       periode: 'mensuel', label: 'Suivi Élève (≤ 15 ans)',  prix: '3 000 FCFA/mois'  },
  { type: 'eleve',       periode: 'annuel',  label: 'Suivi Élève (≤ 15 ans)',  prix: '33 370 FCFA/an'   },
  { type: 'etudiant',    periode: 'mensuel', label: 'Suivi Étudiant',          prix: '3 000 FCFA/mois'  },
  { type: 'etudiant',    periode: 'annuel',  label: 'Suivi Étudiant',          prix: '33 370 FCFA/an'   },
  { type: 'flotte',      periode: 'mensuel', label: 'Forfait Flotte B2B',      prix: '25 000 FCFA/mois' },
  { type: 'illimite',    periode: 'mensuel', label: 'Accès Illimité',          prix: '20 000 FCFA'      },
];
