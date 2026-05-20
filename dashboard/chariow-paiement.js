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

/** Plan gratuit — 1 appareil max (hors Chariow) */
export const PLAN_GRATUIT = {
  id: 'gratuit',
  icon: '🆓',
  titre: 'Plan Gratuit',
  desc: '1 appareil max · 1 rapport/jour · bonus 14 jours (50 crédits)',
  accent: 'free',
  href: 'register.html',
  labelBtn: 'Commencer gratuitement',
};

/**
 * Matrice officielle Chariow — IDs produit + montants FCFA au centime près.
 * Source unique UI ; alignée sur shared/firebase.js CHARIOW_PRODUCTS.
 */
export const CATALOGUE_OFFRES = [
  {
    id: 'wifi',
    icon: '📶',
    titre: 'Option Réseau',
    desc: 'Suivi réseau anti-vol',
    accent: 'slate',
    periodes: [
      { periode: 'mensuel', productId: CHARIOW_PRODUCTS.WIFI_MENSUEL,        montantFcfa: 150,    prixLabel: '150 FCFA/mois' },
      { periode: 'annuel',  productId: CHARIOW_PRODUCTS.WIFI_ANNUEL,         montantFcfa: 1670,   prixLabel: '1 670 FCFA/an' },
    ],
  },
  {
    id: 'particulier',
    icon: '⭐',
    titre: 'Particulier Premium',
    desc: '1 appareil · rapports illimités',
    accent: 'amber',
    periodes: [
      { periode: 'mensuel', productId: CHARIOW_PRODUCTS.PARTICULIER_MENSUEL, montantFcfa: 10000,  prixLabel: '10 000 FCFA/mois' },
      { periode: 'annuel',  productId: CHARIOW_PRODUCTS.PARTICULIER_ANNUEL,  montantFcfa: 111240, prixLabel: '111 240 FCFA/an' },
    ],
  },
  {
    id: 'eleve',
    icon: '🎒',
    titre: 'Scolaire Élève',
    desc: '≤ 15 ans · suivi parental',
    accent: 'cyan',
    periodes: [
      { periode: 'mensuel', productId: CHARIOW_PRODUCTS.ELEVE_MENSUEL,       montantFcfa: 3000,   prixLabel: '3 000 FCFA/mois' },
      { periode: 'annuel',  productId: CHARIOW_PRODUCTS.ELEVE_ANNUEL,        montantFcfa: 33370,  prixLabel: '33 370 FCFA/an' },
    ],
  },
  {
    id: 'etudiant',
    icon: '🎓',
    titre: 'Scolaire Étudiant',
    desc: 'Université · assiduité',
    accent: 'indigo',
    periodes: [
      { periode: 'mensuel', productId: CHARIOW_PRODUCTS.ETUDIANT_MENSUEL,    montantFcfa: 3000,   prixLabel: '3 000 FCFA/mois' },
      { periode: 'annuel',  productId: CHARIOW_PRODUCTS.ETUDIANT_ANNUEL,     montantFcfa: 33370,  prixLabel: '33 370 FCFA/an' },
    ],
  },
  {
    id: 'flotte',
    icon: '🚛',
    titre: 'Forfait Flotte B2B',
    desc: 'Agents et rapports illimités',
    accent: 'emerald',
    periodes: [
      { periode: 'mensuel', productId: CHARIOW_PRODUCTS.FORFAIT_FLOTTE,      montantFcfa: 25000,  prixLabel: '25 000 FCFA/mois', labelBtn: 'S\'abonner' },
    ],
  },
  {
    id: 'illimite',
    icon: '♾️',
    titre: 'Accès Illimité',
    desc: 'Premium permanent · agents et rapports illimités',
    accent: 'yellow',
    periodes: [
      { periode: 'mensuel', productId: CHARIOW_PRODUCTS.ACCES_ILLIMITE,      montantFcfa: 20000,  prixLabel: '20 000 FCFA', labelBtn: 'Acheter' },
    ],
  },
];

/** Vérifie que chaque productId du catalogue existe dans CHARIOW_PRODUCTS */
const IDS_OFFICIELS = new Set(Object.values(CHARIOW_PRODUCTS));
for (const offre of CATALOGUE_OFFRES) {
  for (const p of offre.periodes) {
    if (!IDS_OFFICIELS.has(p.productId)) {
      console.warn(`[Chariow] productId hors catalogue : ${p.productId}`);
    }
    const resolu = resoudreProduitChariow(offre.id, p.periode);
    if (resolu !== p.productId) {
      console.warn(`[Chariow] mismatch ${offre.id}/${p.periode}: attendu ${p.productId}, résolu ${resolu}`);
    }
  }
}

/** @deprecated — utiliser CATALOGUE_OFFRES */
export const OFFRES_CHARIOW_AFFICHAGE = CATALOGUE_OFFRES.flatMap((o) =>
  o.periodes.map((p) => ({
    type: o.id,
    periode: p.periode,
    label: o.titre,
    prix: p.prixLabel,
    productId: p.productId,
    montantFcfa: p.montantFcfa,
  })),
);

const BTN_CLASS = {
  slate:   'offer-card__btn offer-card__btn--slate',
  amber:   'offer-card__btn offer-card__btn--amber',
  cyan:    'offer-card__btn offer-card__btn--cyan',
  indigo:  'offer-card__btn offer-card__btn--indigo',
  emerald: 'offer-card__btn offer-card__btn--emerald',
  yellow:  'offer-card__btn offer-card__btn--yellow',
};

/**
 * Grille HTML des cartes offres (boutons → liens après injecterLiensChariow).
 * @param {string[]} [filterIds] — sous-ensemble d'IDs à afficher
 */
function cartePlanGratuit() {
  const g = PLAN_GRATUIT;
  return `
    <article class="offer-card offer-card--${g.accent}">
      <h4 class="offer-card__title">${g.icon} ${g.titre}</h4>
      <p class="offer-card__desc">${g.desc}</p>
      <div class="offer-card__actions">
        <a href="${g.href}" class="offer-card__btn offer-card__btn--free">${g.labelBtn}</a>
      </div>
    </article>`;
}

export function genererGrilleOffresHtml(filterIds = null, { inclureGratuit = true } = {}) {
  const list = filterIds
    ? CATALOGUE_OFFRES.filter((o) => filterIds.includes(o.id))
    : CATALOGUE_OFFRES;

  const paid = list.map((o) => {
    const btns = o.periodes.map((p) => `
      <button type="button"
        data-chariow-offre="${o.id}"
        data-chariow-periode="${p.periode}"
        data-chariow-product="${p.productId}"
        class="${BTN_CLASS[o.accent] || BTN_CLASS.slate}">
        ${p.labelBtn || (p.periode === 'annuel' ? 'Annuel' : 'Mensuel')} — ${p.prixLabel}
      </button>`).join('');

    return `
      <article class="offer-card offer-card--${o.accent}">
        <h4 class="offer-card__title">${o.icon} ${o.titre}</h4>
        <p class="offer-card__desc">${o.desc}</p>
        <div class="offer-card__actions offer-card__actions--stack">${btns}</div>
      </article>`;
  }).join('');

  return (inclureGratuit && !filterIds ? cartePlanGratuit() : '') + paid;
}

/**
 * Liste compacte pour bannières quota (fleet / rapport).
 */
/**
 * Affiche le catalogue sur licence.html (grille + liens Chariow si UID).
 */
export function rendreCatalogueLicence(uid = null) {
  const el = document.getElementById('catalogueOffres');
  if (!el) return;
  el.innerHTML = genererGrilleOffresHtml();
  if (uid) injecterLiensChariow(uid);
}

/**
 * Tableau admin : 10 produits + liens boutique (sans UID).
 */
export function genererTableauAdminChariowHtml() {
  const lignes = CATALOGUE_OFFRES.flatMap((o) =>
    o.periodes.map((p) => {
      const url = `${CHARIOW_SHOP_BASE}/${p.productId}`;
      return `
        <tr class="border-b border-slate-700/80 hover:bg-slate-700/30">
          <td class="py-2 pr-3 text-slate-200 text-sm">${o.icon} ${o.titre}</td>
          <td class="py-2 pr-3 text-slate-400 text-xs font-mono">${p.productId}</td>
          <td class="py-2 pr-3 text-sky-300 text-sm whitespace-nowrap">${p.prixLabel}</td>
          <td class="py-2">
            <a href="${url}" target="_blank" rel="noopener noreferrer"
               class="text-sky-400 hover:text-sky-300 text-xs font-medium break-all">${url}</a>
          </td>
        </tr>`;
    }),
  ).join('');

  return `
    <div class="bg-slate-800 rounded-xl border border-slate-700 p-6 mb-8 overflow-x-auto">
      <h3 class="text-lg font-bold mb-2 flex items-center gap-2">🛒 Catalogue Chariow (10 produits)</h3>
      <p class="text-slate-400 text-sm mb-4">
        Liens boutique — les clients paient depuis
        <a href="licence.html" class="text-sky-400 hover:underline">Abonnements</a>
        après connexion (UID ajouté automatiquement).
      </p>
      <table class="w-full text-left border-collapse min-w-[640px]">
        <thead>
          <tr class="text-slate-500 text-xs uppercase border-b border-slate-600">
            <th class="pb-2 pr-3">Offre</th>
            <th class="pb-2 pr-3">ID produit</th>
            <th class="pb-2 pr-3">Prix</th>
            <th class="pb-2">Lien Chariow</th>
          </tr>
        </thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>`;
}

export function genererListeUpsellHtml(uid, filterIds = ['particulier', 'flotte', 'eleve', 'etudiant']) {
  if (!uid) {
    return `<p class="text-slate-400 text-xs text-center">
      <a href="licence.html" class="text-sky-400 hover:underline">Choisir une offre (Abonnements)</a>
    </p>`;
  }

  const items = CATALOGUE_OFFRES.filter((o) => filterIds.includes(o.id));
  return items.map((o) => {
    const p = o.periodes[0];
    const url = construireUrlChariow(o.id, p.periode, uid);
    return `
      <a href="${url}" target="_blank" rel="noopener noreferrer"
         class="offer-upsell__row">
        <span class="offer-upsell__label">${o.icon} ${o.titre}</span>
        <span class="offer-upsell__prix">${p.prixLabel}</span>
      </a>`;
  }).join('');
}
