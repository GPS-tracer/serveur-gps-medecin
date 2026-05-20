/**
 * Paiements Chariow centralisés — URLs avec UID pour le webhook.
 */
import { CHARIOW_PRODUCTS, CHARIOW_SHOP_BASE } from '../shared/firebase.js';

const OFFRES_VALIDEES = new Set([
  'wifi', 'particulier', 'eleve', 'etudiant', 'flotte', 'illimite',
]);

const PERIODES_VALIDEES = new Set(['mensuel', 'annuel']);

/**
 * Résout l'ID produit Chariow selon le type d'offre et la période.
 * @param {string} typeOffre
 * @param {string} periode
 * @returns {string|null}
 */
export function resoudreProduitChariow(typeOffre, periode) {
  const type = (typeOffre || '').toLowerCase();
  const p    = (periode || 'mensuel').toLowerCase();
  const annuel = p === 'annuel';

  switch (type) {
    case 'wifi':
      return annuel ? CHARIOW_PRODUCTS.WIFI_ANNUEL : CHARIOW_PRODUCTS.WIFI_MENSUEL;
    case 'particulier':
      return annuel ? CHARIOW_PRODUCTS.PARTICULIER_ANNUEL : CHARIOW_PRODUCTS.PARTICULIER_MENSUEL;
    case 'eleve':
      return annuel ? CHARIOW_PRODUCTS.ELEVE_ANNUEL : CHARIOW_PRODUCTS.ELEVE_MENSUEL;
    case 'etudiant':
      return annuel ? CHARIOW_PRODUCTS.ETUDIANT_ANNUEL : CHARIOW_PRODUCTS.ETUDIANT_MENSUEL;
    case 'flotte':
      return CHARIOW_PRODUCTS.FORFAIT_FLOTTE;
    case 'illimite':
      return CHARIOW_PRODUCTS.ACCES_ILLIMITE;
    default:
      return null;
  }
}

/**
 * Construit l'URL de paiement Chariow avec l'UID société.
 * @param {string} typeOffre
 * @param {string} periode
 * @param {string} uid
 * @returns {string}
 */
export function construireUrlChariow(typeOffre, periode, uid) {
  const productId = resoudreProduitChariow(typeOffre, periode);
  if (!productId) {
    throw new Error(`Offre Chariow inconnue : ${typeOffre} / ${periode}`);
  }
  if (!uid) {
    throw new Error('Identifiant utilisateur requis pour le paiement.');
  }
  const params = new URLSearchParams({ uid: String(uid) });
  return `${CHARIOW_SHOP_BASE}/${productId}?${params.toString()}`;
}

/**
 * Ouvre la boutique Chariow pour l'offre demandée.
 * @param {string} typeOffre — wifi | particulier | eleve | etudiant | flotte | illimite
 * @param {string} periode — mensuel | annuel
 * @param {string} uid — UID Firebase Auth (société / parent)
 */
export function declencherPaiementChariow(typeOffre, periode, uid) {
  const type = (typeOffre || '').toLowerCase();
  const p    = (periode || 'mensuel').toLowerCase();

  if (!OFFRES_VALIDEES.has(type)) {
    throw new Error(`Type d'offre invalide : ${typeOffre}`);
  }
  if (!PERIODES_VALIDEES.has(p) && type !== 'flotte' && type !== 'illimite') {
    throw new Error(`Période invalide : ${periode}`);
  }

  const url = construireUrlChariow(type, p, uid);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Libellés et prix des 10 produits Chariow officiels */
export const OFFRES_CHARIOW_AFFICHAGE = [
  { type: 'wifi',        periode: 'mensuel', label: 'Option Wi-Fi suivi',     prix: '150 FCFA/mois'      },
  { type: 'wifi',        periode: 'annuel',  label: 'Option Wi-Fi suivi',     prix: '1 670 FCFA/an'      },
  { type: 'particulier', periode: 'mensuel', label: 'Particulier Premium',    prix: '10 000 FCFA/mois'   },
  { type: 'particulier', periode: 'annuel',  label: 'Particulier Premium',    prix: '111 240 FCFA/an'    },
  { type: 'eleve',       periode: 'mensuel', label: 'Suivi Élève (≤ 15 ans)', prix: '3 000 FCFA/mois'    },
  { type: 'eleve',       periode: 'annuel',  label: 'Suivi Élève (≤ 15 ans)', prix: '33 370 FCFA/an'     },
  { type: 'etudiant',    periode: 'mensuel', label: 'Suivi Étudiant',         prix: '3 000 FCFA/mois'    },
  { type: 'etudiant',    periode: 'annuel',  label: 'Suivi Étudiant',         prix: '33 370 FCFA/an'     },
  { type: 'flotte',      periode: 'mensuel', label: 'Forfait Flotte B2B',     prix: '25 000 FCFA/mois'   },
  { type: 'illimite',    periode: 'mensuel', label: 'Accès Illimité',         prix: '20 000 FCFA'        },
];
