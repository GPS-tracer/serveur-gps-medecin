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
    titre: 'Anti-vol Réseau',
    desc: 'Option GPS Tracker — suivi réseau anti-vol',
    accent: 'slate',
    periodes: [
      {
        periode: 'mensuel',
        productId: CHARIOW_PRODUCTS.WIFI_MENSUEL,
        libelleChariow: 'Option GPS Tracker - Anti-vol Réseau Mensuel',
        montantFcfa: 150,
        prixLabel: '150 FCFA/mois',
      },
      {
        periode: 'annuel',
        productId: CHARIOW_PRODUCTS.WIFI_ANNUEL,
        libelleChariow: 'Option GPS Tracker - Anti-vol Réseau Annuel',
        montantFcfa: 1670,
        prixLabel: '1 670 FCFA/an',
      },
    ],
  },
  {
    id: 'particulier',
    icon: '⭐',
    titre: 'Particulier',
    desc: 'Licence GPS Tracker — 1 appareil, rapports illimités',
    accent: 'amber',
    periodes: [
      {
        periode: 'mensuel',
        productId: CHARIOW_PRODUCTS.PARTICULIER_MENSUEL,
        libelleChariow: 'Licence GPS Tracker - Particulier Mensuelle',
        montantFcfa: 10000,
        prixLabel: '10 000 FCFA/mois',
      },
      {
        periode: 'annuel',
        productId: CHARIOW_PRODUCTS.PARTICULIER_ANNUEL,
        libelleChariow: 'Licence GPS Tracker - Particulier Annuelle',
        montantFcfa: 111240,
        prixLabel: '111 240 FCFA/an',
      },
    ],
  },
  {
    id: 'eleve',
    icon: '🎒',
    titre: 'Licence Élève',
    desc: 'Application GPS Tracker — ≤ 15 ans, suivi parental',
    accent: 'cyan',
    periodes: [
      {
        periode: 'mensuel',
        productId: CHARIOW_PRODUCTS.ELEVE_MENSUEL,
        libelleChariow: 'Application GPS Tracker - Licence Élève Mensuelle',
        montantFcfa: 3000,
        prixLabel: '3 000 FCFA/mois',
      },
      {
        periode: 'annuel',
        productId: CHARIOW_PRODUCTS.ELEVE_ANNUEL,
        libelleChariow: 'Application GPS Tracker - Licence Élève Annuelle',
        montantFcfa: 33370,
        prixLabel: '33 370 FCFA/an',
      },
    ],
  },
  {
    id: 'etudiant',
    icon: '🎓',
    titre: 'Licence Étudiant',
    desc: 'Application GPS Tracker — université, assiduité',
    accent: 'indigo',
    periodes: [
      {
        periode: 'mensuel',
        productId: CHARIOW_PRODUCTS.ETUDIANT_MENSUEL,
        libelleChariow: 'Application GPS Tracker - Licence Étudiant Mensuelle',
        montantFcfa: 3000,
        prixLabel: '3 000 FCFA/mois',
      },
      {
        periode: 'annuel',
        productId: CHARIOW_PRODUCTS.ETUDIANT_ANNUEL,
        libelleChariow: 'GPS Tracker - Étudiant Annuel',
        montantFcfa: 33370,
        prixLabel: '33 370 FCFA/an',
      },
    ],
  },
  {
    id: 'flotte',
    icon: '🚛',
    titre: 'Forfait Flotte',
    desc: 'GpSTracker — agents et rapports illimités (B2B)',
    accent: 'emerald',
    periodes: [
      {
        periode: 'mensuel',
        productId: CHARIOW_PRODUCTS.FORFAIT_FLOTTE,
        libelleChariow: 'GpSTracker - Forfait Flotte',
        montantFcfa: 25000,
        prixLabel: '25 000 FCFA/mois',
        labelBtn: 'S\'abonner',
      },
    ],
  },
  {
    id: 'illimite',
    icon: '♾️',
    titre: 'Accès Illimité Premium',
    desc: 'Pack permanent — agents et rapports illimités',
    accent: 'yellow',
    periodes: [
      {
        periode: 'mensuel',
        productId: CHARIOW_PRODUCTS.ACCES_ILLIMITE,
        libelleChariow: 'Pack Accès Illimité Premium',
        montantFcfa: 20000,
        prixLabel: '20 000 FCFA',
        labelBtn: 'Acheter',
      },
    ],
  },
];

/** URL boutique Chariow (avec UID optionnel pour le webhook). */
export function urlProduitChariow(productId, uid = null) {
  const base = `${CHARIOW_SHOP_BASE}/${productId}`;
  return uid ? `${base}?uid=${encodeURIComponent(uid)}` : base;
}

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

export function genererGrilleOffresHtml(filterIds = null, { inclureGratuit = true, uid = null } = {}) {
  const list = filterIds
    ? CATALOGUE_OFFRES.filter((o) => filterIds.includes(o.id))
    : CATALOGUE_OFFRES;

  const paid = list.map((o) => {
    const btns = o.periodes.map((p) => {
      const href = urlProduitChariow(p.productId, uid);
      const libelle = p.libelleChariow || o.titre;
      const sousTitre = p.labelBtn
        ? `${p.labelBtn} — ${p.prixLabel}`
        : `${p.periode === 'annuel' ? 'Annuel' : 'Mensuel'} — ${p.prixLabel}`;
      return `
      <a href="${href}"
        target="_blank"
        rel="noopener noreferrer"
        data-chariow-offre="${o.id}"
        data-chariow-periode="${p.periode}"
        data-chariow-product="${p.productId}"
        class="${BTN_CLASS[o.accent] || BTN_CLASS.slate}"
        title="${libelle}">
        <span class="offer-card__btn-label">${libelle}</span>
        <span class="offer-card__btn-prix">${sousTitre}</span>
      </a>`;
    }).join('');

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
/**
 * Résout l'offre catalogue correspondant à une intention vitrine.
 * @param {{ productId?: string|null, offreType?: string|null, periode?: string }|null} intent
 */
export function trouverOffreParIntent(intent) {
  if (!intent) return null;

  for (const offre of CATALOGUE_OFFRES) {
    for (const p of offre.periodes) {
      if (intent.productId && p.productId === intent.productId) {
        return { offre, periode: p };
      }
    }
  }

  if (intent.offreType) {
    const offre = CATALOGUE_OFFRES.find((o) => o.id === intent.offreType);
    if (offre) {
      const periode = offre.periodes.find((p) => p.periode === (intent.periode || 'mensuel'))
        || offre.periodes[0];
      return { offre, periode };
    }
  }

  return null;
}

export function libelleOffreIntent(intent) {
  const m = trouverOffreParIntent(intent);
  return m ? `${m.offre.titre} — ${m.periode.prixLabel}` : 'Offre sélectionnée';
}

/**
 * Fiche détaillée du produit choisi sur la vitrine + bouton paiement Chariow.
 */
export function genererFicheProduitSelectionneHtml(intent, uid) {
  const match = trouverOffreParIntent(intent);
  if (!match || !uid) return '';

  const { offre, periode } = match;
  const url = construireUrlChariow(offre.id, periode.periode, uid);
  const btnClass = BTN_CLASS[offre.accent] || BTN_CLASS.slate;

  return `
    <section class="fiche-produit" aria-labelledby="fiche-produit-titre">
      <p class="fiche-produit__badge">Votre sélection</p>
      <h3 id="fiche-produit-titre" class="fiche-produit__titre">${offre.icon} ${offre.titre}</h3>
      <p class="fiche-produit__desc">${offre.desc}</p>
      <p class="fiche-produit__prix">${periode.prixLabel}</p>
      <p class="fiche-produit__id">Produit Chariow : <code>${periode.productId}</code></p>
      <a href="${url}" target="_blank" rel="noopener noreferrer"
         class="fiche-produit__cta ${btnClass}"
         data-chariow-offre="${offre.id}"
         data-chariow-periode="${periode.periode}"
         data-chariow-product="${periode.productId}">
        Payer via Chariow (Airtel / MTN) →
      </a>
      <p class="fiche-produit__note">Activation automatique sur votre compte après confirmation du paiement.</p>
    </section>`;
}

export function rendreCatalogueLicence(uid = null, intent = null) {
  const ficheEl = document.getElementById('ficheProduitSelectionne');
  if (ficheEl && intent && uid) {
    ficheEl.innerHTML = genererFicheProduitSelectionneHtml(intent, uid);
    ficheEl.classList.remove('hidden');
  } else if (ficheEl) {
    ficheEl.innerHTML = '';
    ficheEl.classList.add('hidden');
  }

  const el = document.getElementById('catalogueOffres');
  if (!el) return;
  el.innerHTML = genererGrilleOffresHtml(null, { inclureGratuit: !uid, uid });
  if (uid) injecterLiensChariow(uid);
}

/**
 * Met en évidence la carte correspondant à l'intention vitrine (après consommation storage).
 * @param {{ productId?: string|null, offreType?: string|null, periode?: string }|null} intent
 */
export function surlignerOffreIntentee(intent) {
  if (!intent) return;

  let cible = null;
  if (intent.productId) {
    cible = document.querySelector(`[data-chariow-product="${intent.productId}"]`);
  }
  if (!cible && intent.offreType) {
    const periode = intent.periode || 'mensuel';
    cible = document.querySelector(
      `[data-chariow-offre="${intent.offreType}"][data-chariow-periode="${periode}"]`,
    );
  }
  if (!cible && intent.offreType) {
    cible = document.querySelector(`[data-chariow-offre="${intent.offreType}"]`);
  }

  const card = cible?.closest('.offer-card');
  if (!card) return;

  card.classList.add('offer-card--highlighted');
  card.setAttribute('aria-selected', 'true');
  requestAnimationFrame(() => {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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
