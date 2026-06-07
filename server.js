const express  = require('express');
const path     = require('path');
const admin    = require('firebase-admin');
const cron     = require('node-cron');
const crypto   = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
// Firebase Admin SDK
// Render : utiliser la variable d'env FIREBASE_SERVICE_ACCOUNT (JSON minifié)
// ou un Secret File monté à /etc/secrets/service-account.json
// ─────────────────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Variable d'env : JSON minifié sur une seule ligne
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT invalide (JSON mal formé):', e.message);
    process.exit(1);
  }
} else {
  // Secret File Render ou fichier local de développement
  const secretPath = '/etc/secrets/service-account.json';
  const localPath  = './firebase-service-account.json';
  const fs = require('fs');
  const filePath = fs.existsSync(secretPath) ? secretPath : localPath;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`❌ Impossible de lire le fichier service account (${filePath}):`, e.message);
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://db-tracker-d39a7-default-rtdb.firebaseio.com',
});

// Realtime Database (agents, companies)
const db = admin.database();

// Firestore (collection licences — clés Chariow)
const firestore = admin.firestore();

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(express.json());

// Vérifier le token Firebase Auth sur les routes protégées
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
}

// [ADMIN SUPRÊME] — Middleware de sécurisation exclusif pour le rôle Administrateur Suprême
async function requireSuperadmin(req, res, next) {
  // Option A : Authentification par secret admin (rétrocompatibilité et scripts de test)
  const secret = req.headers['x-admin-secret'];
  if (secret && secret === process.env.ADMIN_SECRET) {
    return next();
  }

  // Option B : Authentification par Firebase ID Token (Bearer) + vérification du rôle dans Firebase RTDB
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(403).json({ error: 'Accès refusé. Secret ou token admin requis.' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const companyId = decoded.uid;
    const profil = await lireProfilSociete(companyId);
    if (profil.role === 'superadmin') {
      req.user = decoded;
      return next();
    }
    return res.status(403).json({ error: 'Accès interdit. Rôle superadmin requis.' });
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}


// ─────────────────────────────────────────────────────────────
// CONSTANTES FREEMIUM & ABONNEMENTS
// ─────────────────────────────────────────────────────────────
const USER_STATUS = {
  FREE_BONUS:  'FREE_BONUS',
  FREE_STRICT: 'FREE_STRICT',
  PREMIUM:     'PREMIUM',
};

const FREEMIUM = {
  MAX_AGENTS_FREE:        1,    // plan gratuit strict : 1 seul appareil à suivre
  MAX_AGENTS_PACK:        10,   // pack_20 / pack_40 / bonus démarrage : jusqu'à 10 appareils
  WARN_AGENTS_THRESHOLD:   8,   // avertissement préventif pour les packs (8/10)
  FREE_REPORTS_PER_DAY:    1,   // 1 impression gratuite/jour (FREE_STRICT)
  BONUS_DAYS:             14,   // durée du bonus d'entrée (essai)
  INITIAL_CREDITS:        50,   // crédits bonus à la création du compte
  BONUS_DAYS_MS:          14 * 24 * 60 * 60 * 1000,
  PACK_PRICES: {
    pack_20:              590,   // FCFA frais Chariow inclus (net ~490)
    pack_40:             1180,   // FCFA frais Chariow inclus (net ~1 000)
    illimite:           20000,   // FCFA — Pack Accès Illimité Premium (prd_7hj1hc)
    abonnement_flotte:  25000,   // FCFA/mois — Forfait Flotte (prd_zvj2cv)
    abonnement_unite:   31192,   // FCFA frais Chariow inclus (net 30 000 / agent / mois)
    suivi_eleve:         3000,   // FCFA/mois — Licence Élève Mensuelle (prd_aotwqf)
    suivi_etudiant:      3000,   // FCFA/mois — Licence Étudiant Mensuelle (prd_tv5t2h)
  },
  // Durée d'un abonnement mensuel en millisecondes
  ABONNEMENT_DUREE_MS: 30 * 24 * 60 * 60 * 1000, // 30 jours
};

// Types de packs valides (utilisés dans plusieurs routes)
const TYPES_PACKS_VALIDES = [
  'pack_20', 'pack_40', 'illimite',
  'abonnement_flotte', 'abonnement_unite',
  'suivi_eleve',      // abonnement suivi scolaire élève    — 3 000 FCFA/mois
  'suivi_etudiant',   // abonnement suivi scolaire étudiant — 3 000 FCFA/mois
];

// Types d'abonnements mensuels (ont une date d'expiration de 30 jours)
const TYPES_ABONNEMENTS = [
  'abonnement_flotte',
  'abonnement_unite',
  'suivi_eleve',
  'suivi_etudiant',
];

// Types de suivi scolaire (sous-ensemble de TYPES_ABONNEMENTS)
const TYPES_SCOLAIRES = ['suivi_eleve', 'suivi_etudiant'];

// Catalogue Chariow officiel (aligné sur shared/firebase.js)
const CHARIOW_PRODUCTS = {
  WIFI_MENSUEL:         'prd_ggudpxa3',
  WIFI_ANNUEL:          'prd_ldq33m9h',
  PARTICULIER_MENSUEL:  'prd_raupzm8z',
  PARTICULIER_ANNUEL:   'prd_3iklqt66',
  ELEVE_MENSUEL:        'prd_aotwqf',
  ELEVE_ANNUEL:         'prd_ci4t10',
  ETUDIANT_MENSUEL:     'prd_tv5t2h',
  ETUDIANT_ANNUEL:      'prd_zaxkdc',
  FORFAIT_FLOTTE:       'prd_zvj2cv',
  ACCES_ILLIMITE:       'prd_7hj1hc',
};

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Génère une clé alphanumérique de 16 caractères (usage interne / tests) */
function generateLicenceKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) key += '-';
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key; // format: XXXX-XXXX-XXXX-XXXX
}

/** Retourne la date du jour au format YYYY-MM-DD (UTC) */
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** Prolonge une expiration : base = max(now, date actuelle si future) + jours */
function prolongerExpirationMs(expirationActuelle, jours) {
  const actuelle = typeof expirationActuelle === 'number'
    ? expirationActuelle
    : (expirationActuelle ? new Date(expirationActuelle).getTime() : 0);
  const base = actuelle > Date.now() ? actuelle : Date.now();
  return base + jours * MS_PAR_JOUR;
}

/** Lit le profil unifié (societes prioritaire, fallback companies) */
async function lireProfilSociete(companyId) {
  const [socSnap, compSnap] = await Promise.all([
    db.ref(`societes/${companyId}`).get(),
    db.ref(`companies/${companyId}`).get(),
  ]);
  const societe = socSnap.val() || {};
  const company = compSnap.val() || {};
  return fusionnerProfilSociete(company, societe);
}

function fusionnerRole(societeRole, companyRole) {
  if (societeRole === 'superadmin' || companyRole === 'superadmin') return 'superadmin';
  return societeRole ?? companyRole;
}

function fusionnerProfilSociete(company = {}, societe = {}) {
  return {
    ...company,
    ...societe,
    role: fusionnerRole(societe.role, company.role),
    licence: { ...(company.licence || {}), ...(societe.licence || {}) },
  };
}

/** Double écriture champs racine societes + companies */
async function ecrireProfilSociete(companyId, patch) {
  await Promise.all([
    db.ref(`societes/${companyId}`).update(patch),
    db.ref(`companies/${companyId}`).update(patch),
  ]);
}

/** Double écriture sous-nœud licence */
async function ecrireLicenceDual(companyId, patch) {
  await Promise.all([
    db.ref(`societes/${companyId}/licence`).update(patch),
    db.ref(`companies/${companyId}/licence`).update(patch),
  ]);
}

/** UID acheteur depuis le payload Chariow */
async function resoudreCompanyIdDepuisPayload(payload) {
  const direct = payload.uid || payload.metadata?.uid || payload.customer_uid
    || payload.custom_fields?.uid || payload.query?.uid;
  if (direct) return String(direct);

  const email = payload.customer_email || payload.email;
  if (!email) return null;

  const snap = await db.ref('companies').orderByChild('email').equalTo(email).limitToFirst(1).get();
  if (!snap.exists()) return null;
  return Object.keys(snap.val())[0];
}

/** ID produit normalisé depuis le payload Chariow */
function extraireProductIdChariow(payload) {
  const raw = payload.product?.id || payload.product_id || payload.productId || '';
  return String(raw).toLowerCase().trim();
}

/** Jours à créditer selon l'ID produit (mensuel 30 / annuel 365) */
function joursPourProduitChariow(productId) {
  const annuels = new Set([
    CHARIOW_PRODUCTS.WIFI_ANNUEL,
    CHARIOW_PRODUCTS.PARTICULIER_ANNUEL,
    CHARIOW_PRODUCTS.ELEVE_ANNUEL,
    CHARIOW_PRODUCTS.ETUDIANT_ANNUEL,
  ]);
  return annuels.has(productId) ? 365 : 30;
}

/** Compte payant (pack, abonnement ou crédits restants) — hors bonus gratuit */
function estComptePremium(droits) {
  return droits.estIllimite ||
    droits.abonnementActif ||
    droits.particulierActif ||
    droits.rapportsIllimitesParticulier ||
    droits.userStatus === 'premium' ||
    droits.typePack === 'illimite' ||
    droits.typePack === 'pack_20' ||
    droits.typePack === 'pack_40' ||
    droits.rapportsRestants > 0;
}

/**
 * Lit l'état freemium (champs plats ou ancien schéma bonus_demarrage).
 * @returns {{ dateCreation: number, expirationEssai: number, credits: number|null }}
 */
function lireEtatFreemium(company) {
  const dateCreation = company.date_creation || company.createdAt || Date.now();
  let expirationEssai = company.expiration_essai;
  if (expirationEssai == null && company.bonus_demarrage?.expires_at) {
    expirationEssai = new Date(company.bonus_demarrage.expires_at).getTime();
  }
  if (expirationEssai == null) {
    expirationEssai = dateCreation + FREEMIUM.BONUS_DAYS_MS;
  }

  let credits = company.credits_freemium;
  if (typeof credits !== 'number' && company.bonus_demarrage) {
    credits = company.bonus_demarrage.credits_freemium;
  }
  if (typeof credits !== 'number') credits = null;

  return { dateCreation, expirationEssai, credits };
}

/**
 * Crée ou migre le profil freemium d'un compte gratuit.
 * Champs RTDB : date_creation, expiration_essai (J+14), credits_freemium (50).
 */
async function creerProfilFreemiumGratuit(companyId, company = {}) {
  const { dateCreation, expirationEssai, credits: existingCredits } = lireEtatFreemium(company);
  let credits = existingCredits;

  if (credits == null) {
    credits = Date.now() >= expirationEssai ? 0 : FREEMIUM.INITIAL_CREDITS;
  }

  const userStatus = (Date.now() >= expirationEssai || credits <= 0)
    ? USER_STATUS.FREE_STRICT
    : USER_STATUS.FREE_BONUS;

  const patch = {
    date_creation:     dateCreation,
    expiration_essai:  expirationEssai,
    credits_freemium:  credits,
    user_status:       userStatus,
    createdAt:         company.createdAt || dateCreation,
  };

  await Promise.all([
    db.ref(`companies/${companyId}`).update(patch),
    db.ref(`societes/${companyId}`).update(patch),
  ]);
  return patch;
}

/** @deprecated alias interne */
const initialiserBonusDemarrage = creerProfilFreemiumGratuit;

// ─────────────────────────────────────────────────────────────
// HELPER : Résoudre les droits effectifs d'une société
// Lit le nœud RTDB companies/{id}/licence et retourne un objet
// normalisé utilisé par toutes les routes de vérification.
// ─────────────────────────────────────────────────────────────
/**
 * Résout les droits effectifs d'une société ou d'un compte parent.
 *
 * Matrice des droits :
 * ┌─────────────────────┬──────────┬──────────────┬──────────────────────────┐
 * │ typePack /          │ Rapports │ Agents max   │ Notes                    │
 * │ type_abonnement     │          │              │                          │
 * ├─────────────────────┼──────────┼──────────────┼──────────────────────────┤
 * │ free (FREE_STRICT)  │ 1/jour   │ 1            │ Plan gratuit limité      │
 * │ free (FREE_BONUS)   │ illimité │ 10           │ Bonus de démarrage 14j   │
 * │ pack_20 / pack_40   │ solde    │ 10           │ Crédits ponctuels        │
 * │ illimite (typePack) │ ∞        │ ∞            │ Pack permanent           │
 * │ abonnement_flotte   │ ∞        │ ∞            │ Mensuel B2B flotte       │
 * │ abonnement_unite    │ ∞        │ quantite     │ Mensuel B2B par agent    │
 * │ suivi_eleve         │ ∞        │ quantite     │ 3 000 FCFA/mois — élève  │
 * │ suivi_etudiant      │ ∞        │ quantite     │ 3 000 FCFA/mois — étud.  │
 * └─────────────────────┴──────────┴──────────────┴──────────────────────────┘
 *
 * Convention RTDB (inchangée) :
 *  - typePack       → packs crédits : 'free' | 'pack_20' | 'pack_40' | 'illimite'
 *  - type_abonnement → abonnements mensuels : 'abonnement_flotte' | 'abonnement_unite'
 *                      | 'suivi_eleve' | 'suivi_etudiant'
 *  Les deux champs coexistent sans conflit.
 *
 * @param {string} companyId
 * @returns {Promise<{
 *   typePack: string,
 *   estIllimite: boolean,
 *   abonnementActif: boolean,
 *   typeAbonnement: string|null,
 *   maxAgents: number,
 *   rapportsRestants: number,
 *   dateExpiration: string|null,
 *   quantiteAgents: number,
 *   estSuiviScolaire: boolean,
 *   elevesLies: string[],
 * }>}
 */
async function resoudreDroits(companyId) {
  const profil = await lireProfilSociete(companyId);
  const licence = profil.licence || {};

  const typePack         = licence.typePack         || 'free';
  const estIllimite      = licence.est_illimite === true || typePack === 'illimite';
  const abonnementActifLicence = licence.abonnement_actif === true;
  const typeAbonnement   = licence.type_abonnement  || profil.abonnement_scolaire_type || null;
  const dateExpiration   = licence.date_expiration  || null;
  const quantiteAgents   = licence.quantite_agents  || 1;
  const rapportsRestants = licence.rapportsRestants ?? 0;

  const particulierExpire = profil.abonnement_particulier_expire;
  const particulierActif  = particulierExpire
    && Number(particulierExpire) > Date.now();

  const scolaireExpire = profil.abonnement_scolaire_expire;
  const scolaireActif  = scolaireExpire
    && Number(scolaireExpire) > Date.now();

  const wifiExpire = profil.option_tracking_wifi_expire;
  const wifiActif  = wifiExpire && Number(wifiExpire) > Date.now();

  let abonnementValide = false;
  if (abonnementActifLicence && dateExpiration) {
    abonnementValide = new Date(dateExpiration).getTime() > Date.now();
  }
  if (scolaireActif) {
    abonnementValide = true;
  }

  const estSuiviScolaire = scolaireActif && TYPES_SCOLAIRES.includes(typeAbonnement);

  let elevesLies = [];
  if (estSuiviScolaire) {
    const [socEleves, compEleves] = await Promise.all([
      db.ref(`societes/${companyId}/eleves_lies`).get(),
      db.ref(`companies/${companyId}/eleves_lies`).get(),
    ]);
    const merged = { ...(compEleves.val() || {}), ...(socEleves.val() || {}) };
    elevesLies = Object.keys(merged);
  }

  let maxAgents = FREEMIUM.MAX_AGENTS_FREE;

  if (estIllimite || (abonnementValide && typeAbonnement === 'abonnement_flotte')) {
    maxAgents = Infinity;
  } else if (particulierActif || profil.user_status === 'premium') {
    maxAgents = 1;
  } else if (abonnementValide && typeAbonnement === 'abonnement_unite') {
    maxAgents = quantiteAgents;
  } else if (estSuiviScolaire) {
    maxAgents = quantiteAgents;
  } else if (typePack === 'pack_20' || typePack === 'pack_40') {
    maxAgents = FREEMIUM.MAX_AGENTS_PACK;
  } else if (typePack === 'free') {
    const userStatus = profil.user_status;
    if (userStatus === USER_STATUS.FREE_BONUS) {
      maxAgents = FREEMIUM.MAX_AGENTS_PACK;
    }
  }

  const rapportsIllimitesParticulier = particulierActif || profil.user_status === 'premium';

  return {
    typePack,
    estIllimite:      estIllimite || (abonnementValide && typeAbonnement === 'abonnement_flotte'),
    abonnementActif:  abonnementValide || particulierActif,
    typeAbonnement,
    maxAgents,
    rapportsRestants,
    dateExpiration,
    quantiteAgents,
    estSuiviScolaire,
    elevesLies,
    particulierActif,
    scolaireActif,
    wifiActif,
    rapportsIllimitesParticulier,
    userStatus: profil.user_status || null,
  };
}

// ─────────────────────────────────────────────────────────────
// HELPER : Appliquer le mode Freemium restreint sur une société
// Appelé par le cron d'expiration pour réinitialiser les droits.
//
// RÈGLES STRICTES :
//  - Coupe l'accès aux rapports et à la limite d'agents étendue
//  - Conserve les crédits pack_20/pack_40 déjà achetés
//  - Ne touche PAS aux données eleves_lies (lien parent/élève permanent)
// ─────────────────────────────────────────────────────────────
async function appliquerFreemiumRestreint(companyId) {
  await ecrireLicenceDual(companyId, {
    abonnement_actif: false,
    type_abonnement:  null,
    est_illimite:     false,
    quantite_agents:  null,
  });
  console.log(`🔒 Freemium restreint appliqué → société ${companyId}`);
}

// ─────────────────────────────────────────────────────────────
// ROUTE : Rôle utilisateur (fusion societes + companies)
// GET /api/user/role — utilisé après login pour rediriger le superadmin
// ─────────────────────────────────────────────────────────────
app.get('/api/user/role', requireAuth, async (req, res) => {
  try {
    const profil = await lireProfilSociete(req.user.uid);
    const role = profil.role || null;
    res.json({
      role,
      isSuperadmin: role === 'superadmin',
    });
  } catch (err) {
    console.error('user/role error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Initialiser un compte gratuit (bonus d'entrée)
// POST /api/user/init-account
// À appeler à la création du compte : date_creation, expiration_essai J+14, 50 crédits
// ─────────────────────────────────────────────────────────────
app.post('/api/user/init-account', requireAuth, async (req, res) => {
  const companyId = req.user.uid;

  try {
    const droits = await resoudreDroits(companyId);
    if (estComptePremium(droits)) {
      return res.json({ status: USER_STATUS.PREMIUM, initialized: false });
    }

    const snap    = await db.ref(`companies/${companyId}`).get();
    const company = snap.val() || {};

    if (company.date_creation != null && typeof company.credits_freemium === 'number') {
      const etat = lireEtatFreemium(company);
      return res.json({
        status:           company.user_status || USER_STATUS.FREE_BONUS,
        alreadyInitialized: true,
        creditsRemaining: etat.credits,
        expirationEssai:  etat.expirationEssai,
      });
    }

    const dateCreation = company.date_creation || company.createdAt || Date.now();
    const patch = {
      date_creation:    dateCreation,
      expiration_essai: company.expiration_essai || (dateCreation + FREEMIUM.BONUS_DAYS_MS),
      credits_freemium: FREEMIUM.INITIAL_CREDITS,
      user_status:      USER_STATUS.FREE_BONUS,
      createdAt:        company.createdAt || dateCreation,
    };

    await db.ref(`companies/${companyId}`).update(patch);

    res.json({
      status:           USER_STATUS.FREE_BONUS,
      initialized:      true,
      creditsRemaining: FREEMIUM.INITIAL_CREDITS,
      expirationEssai:  patch.expiration_essai,
      daysRemaining:    FREEMIUM.BONUS_DAYS,
    });
  } catch (err) {
    console.error('init-account error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Statut utilisateur (bonus d'entrée → freemium strict permanent)
// GET /api/user/check-status
// Vérifie crédits + 14 j ; décrémente 1 crédit par visite dashboard
// ─────────────────────────────────────────────────────────────
app.get('/api/user/check-status', requireAuth, async (req, res) => {
  const companyId = req.user.uid;

  try {
    const [droits, companySnap] = await Promise.all([
      resoudreDroits(companyId),
      db.ref(`companies/${companyId}`).get(),
    ]);

    let company    = companySnap.val() || {};
    const companyRef = db.ref(`companies/${companyId}`);

    if (estComptePremium(droits)) {
      return res.json({
        status:           USER_STATUS.PREMIUM,
        typePack:         droits.typePack,
        creditsRemaining: null,
        daysRemaining:    null,
        maxAgents:        droits.maxAgents === Infinity ? null : droits.maxAgents,
        reportsPerDay:    null,
        showStrictBanner: false,
      });
    }

    if (company.date_creation == null || typeof company.credits_freemium !== 'number') {
      company = await creerProfilFreemiumGratuit(companyId, company);
    }

    const { expirationEssai } = lireEtatFreemium(company);
    let credits               = company.credits_freemium ?? 0;
    const tempsEcoule         = Date.now() >= expirationEssai;

    if (tempsEcoule || credits <= 0) {
      await companyRef.update({
        user_status:      USER_STATUS.FREE_STRICT,
        credits_freemium: 0,
      });
      return res.json({
        status:           USER_STATUS.FREE_STRICT,
        creditsRemaining: 0,
        daysRemaining:    0,
        maxAgents:        FREEMIUM.MAX_AGENTS_FREE,
        reportsPerDay:    FREEMIUM.FREE_REPORTS_PER_DAY,
        showStrictBanner: true,
      });
    }

    const txResult = await companyRef.transaction((data) => {
      if (!data) return data;
      let c = typeof data.credits_freemium === 'number' ? data.credits_freemium : FREEMIUM.INITIAL_CREDITS;
      const exp = data.expiration_essai || (data.date_creation || Date.now()) + FREEMIUM.BONUS_DAYS_MS;
      if (Date.now() >= exp || c <= 0) {
        data.credits_freemium = 0;
        data.user_status       = USER_STATUS.FREE_STRICT;
        return data;
      }
      c -= 1;
      data.credits_freemium = c;
      data.user_status      = c > 0 ? USER_STATUS.FREE_BONUS : USER_STATUS.FREE_STRICT;
      return data;
    });

    const updated = txResult.committed ? txResult.snapshot.val() : company;
    credits       = updated.credits_freemium ?? 0;
    const status  = updated.user_status ||
      (credits > 0 ? USER_STATUS.FREE_BONUS : USER_STATUS.FREE_STRICT);

    if (status === USER_STATUS.FREE_STRICT) {
      return res.json({
        status:           USER_STATUS.FREE_STRICT,
        creditsRemaining: 0,
        daysRemaining:    0,
        maxAgents:        FREEMIUM.MAX_AGENTS_FREE,
        reportsPerDay:    FREEMIUM.FREE_REPORTS_PER_DAY,
        showStrictBanner: true,
      });
    }

    const exp           = updated.expiration_essai || expirationEssai;
    const daysRemaining = Math.max(0, Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000)));

    res.json({
      status:           USER_STATUS.FREE_BONUS,
      creditsRemaining: credits,
      daysRemaining,
      maxAgents:        FREEMIUM.MAX_AGENTS_PACK,
      reportsPerDay:    null,
      showStrictBanner: false,
    });
  } catch (err) {
    console.error('check-status error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Vérifier le statut freemium d'une société
// GET /api/freemium/:companyId
// ─────────────────────────────────────────────────────────────
app.get('/api/freemium/:companyId', requireAuth, async (req, res) => {
  const { companyId } = req.params;

  // Seule la société elle-même peut consulter son statut
  if (req.user.uid !== companyId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const [droits, companySnap, agentsSnap] = await Promise.all([
      resoudreDroits(companyId),
      db.ref(`companies/${companyId}`).get(),
      db.ref(`societes/${companyId}/agents`).get(),
    ]);

    const company    = companySnap.val() || {};
    const today      = todayKey();

    // Quota freemium : basé sur freemium_quota.derniere_impression + compteur_jours
    const userStatus         = company.user_status || USER_STATUS.FREE_STRICT;
    const quota              = company.freemium_quota || {};
    const derniereImpression = quota.derniere_impression || null;
    const compteurJours      = quota.compteur_jours      || 0;
    const dernierRapport     = company.dernier_rapport_date || null;
    const quotaActuel        = derniereImpression === today ? compteurJours : 0;
    const strictQuotaUsed    = userStatus === USER_STATUS.FREE_STRICT &&
      (dernierRapport === today || quotaActuel >= FREEMIUM.FREE_REPORTS_PER_DAY);
    const freeRemaining      = userStatus === USER_STATUS.FREE_BONUS
      ? FREEMIUM.FREE_REPORTS_PER_DAY
      : Math.max(0, FREEMIUM.FREE_REPORTS_PER_DAY - (strictQuotaUsed ? FREEMIUM.FREE_REPORTS_PER_DAY : quotaActuel));
    const agentCount = agentsSnap.exists() ? Object.keys(agentsSnap.val()).length : 0;

    // Rapports disponibles : illimité si abonnement flotte ou pack illimité
    const rapportsIllimites = droits.estIllimite ||
      droits.rapportsIllimitesParticulier ||
      (droits.abonnementActif && droits.typeAbonnement === 'abonnement_flotte') ||
      (droits.abonnementActif && droits.typeAbonnement === 'abonnement_unite') ||
      droits.scolaireActif;

    res.json({
      typePack:               droits.typePack,
      userStatus,
      isIllimite:             droits.estIllimite,
      abonnementActif:        droits.abonnementActif,
      typeAbonnement:         droits.typeAbonnement,
      dateExpiration:         droits.dateExpiration,
      quantiteAgents:         droits.quantiteAgents,
      rapportsRestants:       rapportsIllimites ? Infinity : droits.rapportsRestants,
      rapportsIllimites,
      agentCount,
      maxAgents:              droits.maxAgents === Infinity ? null : droits.maxAgents,
      agentLimitReached:      droits.maxAgents !== Infinity && agentCount >= droits.maxAgents,
      maxAgentsFree:          FREEMIUM.MAX_AGENTS_FREE,
      freeReportsRemainingToday: freeRemaining,
      creditsFreemium:        company.credits_freemium ?? 0,
      expirationEssai:        company.expiration_essai ?? null,
      particulierActif:        droits.particulierActif || false,
      scolaireActif:           droits.scolaireActif || false,
      wifiActif:               droits.wifiActif || false,
      canPrint: rapportsIllimites || droits.rapportsRestants > 0 ||
        userStatus === USER_STATUS.FREE_BONUS || freeRemaining > 0,
    });
  } catch (err) {
    console.error('freemium error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Activer une clé de licence
// POST /api/licence/activate
// Body: { licenceKey: "XXXX-XXXX-XXXX-XXXX" }
// Gère : pack_20, pack_40, illimite, abonnement_flotte, abonnement_unite
// ─────────────────────────────────────────────────────────────
app.post('/api/licence/activate', requireAuth, async (req, res) => {
  const companyId      = req.user.uid;
  const { licenceKey } = req.body;

  if (!licenceKey || typeof licenceKey !== 'string') {
    return res.status(400).json({ error: 'Clé de licence requise' });
  }

  // Normaliser : majuscules, retirer espaces/tirets, reformater XXXX-XXXX-XXXX-XXXX
  const alphaOnly = licenceKey.toUpperCase().replace(/[\s-]/g, '');
  if (alphaOnly.length !== 16 || !/^[A-Z0-9]{16}$/.test(alphaOnly)) {
    return res.status(400).json({ error: 'Format de clé invalide (16 caractères alphanumériques attendus)' });
  }
  const key = (alphaOnly.match(/.{1,4}/g) || []).join('-');

  let licenceRef, originalData; // Pour rollback en cas d'erreur

  try {
    licenceRef = firestore.collection('licences').doc(key);

    // Variables extraites pendant la transaction
    let typePack;
    let quantiteAgents = 1;
    let alreadyUsed    = false;

    // ── Transaction Firestore atomique ────────────────────────
    // Lit, vérifie le statut, marque "utilise" en une seule opération.
    // Impossible d'activer deux fois même en double-clic simultané.
    await firestore.runTransaction(async (t) => {
      const snap = await t.get(licenceRef);

      if (!snap.exists) {
        throw Object.assign(new Error('Clé de licence invalide'), { code: 'NOT_FOUND' });
      }

      const data = snap.data();
      originalData = { ...data }; // Sauvegarder pour rollback potentiel

      if (data.statut === 'utilise') {
        alreadyUsed = true;
        return; // sort sans modifier — transaction réussit mais flag posé
      }

      typePack       = data.type_pack;
      quantiteAgents = data.quantite_agents || 1;

      // Calcul de la date d'expiration pour les abonnements mensuels
      const dateActivation = new Date();
      const dateExpiration = new Date(dateActivation.getTime() + FREEMIUM.ABONNEMENT_DUREE_MS);

      const updateData = {
        statut:           'utilise',
        statut_abonnement: TYPES_ABONNEMENTS.includes(typePack) ? 'actif' : null,
        utilise_par:      companyId,
        date_activation:  admin.firestore.FieldValue.serverTimestamp(),
        date_expiration:  TYPES_ABONNEMENTS.includes(typePack)
          ? admin.firestore.Timestamp.fromDate(dateExpiration)
          : null,
      };

      t.update(licenceRef, updateData);
    });

    if (alreadyUsed) {
      return res.status(409).json({ error: 'Cette clé a déjà été utilisée' });
    }

    // ── Créditer le compte dans Realtime Database ─────────────
    const [socLicSnap, compLicSnap] = await Promise.all([
      db.ref(`societes/${companyId}/licence`).get(),
      db.ref(`companies/${companyId}/licence`).get(),
    ]);
    const currentLicence = { ...(compLicSnap.val() || {}), ...(socLicSnap.val() || {}) };

    const now            = new Date();
    const nowISO         = now.toISOString();
    const dateExpiration = new Date(now.getTime() + FREEMIUM.ABONNEMENT_DUREE_MS).toISOString();

    let updateRTDB = {
      lastActivation: nowISO,
      lastLicenceKey: key,
    };
    let messageReponse;
    let estIllimite = false;

    if (typePack === 'abonnement_flotte') {
      // ── Forfait Flotte : illimité total pendant 30 jours ──────
      updateRTDB = {
        ...updateRTDB,
        typePack:          'abonnement_flotte',
        abonnement_actif:  true,
        type_abonnement:   'abonnement_flotte',
        date_expiration:   dateExpiration,
        est_illimite:      true,
        quantite_agents:   null,
      };
      estIllimite    = true;
      messageReponse = `✅ Forfait Flotte activé — rapports et agents illimités jusqu'au ${new Date(dateExpiration).toLocaleDateString('fr-FR')}.`;

    } else if (typePack === 'abonnement_unite') {
      // ── Tarif à l'Unité : limite dynamique par quantité ───────
      updateRTDB = {
        ...updateRTDB,
        typePack:          'abonnement_unite',
        abonnement_actif:  true,
        type_abonnement:   'abonnement_unite',
        date_expiration:   dateExpiration,
        est_illimite:      false,
        quantite_agents:   quantiteAgents,
      };
      messageReponse = `✅ Abonnement ${quantiteAgents} agent(s) activé jusqu'au ${new Date(dateExpiration).toLocaleDateString('fr-FR')}.`;

    } else if (typePack === 'illimite') {
      // ── Pack illimité permanent ────────────────────────────────
      updateRTDB = {
        ...updateRTDB,
        typePack:         'illimite',
        est_illimite:     true,
        rapportsRestants: null,
      };
      estIllimite    = true;
      messageReponse = 'Pack illimité activé — rapports et agents désormais illimités !';

    } else {
      // ── Pack crédits (pack_20 / pack_40) ──────────────────────
      const credits   = typePack === 'pack_20' ? 20 : 40;
      const existing  = currentLicence.rapportsRestants || 0;
      const newTotal  = existing + credits;
      // Conserver illimité si déjà illimité
      const newType   = currentLicence.typePack === 'illimite' ? 'illimite' : typePack;
      updateRTDB = {
        ...updateRTDB,
        typePack:          newType,
        rapportsRestants:  newTotal,
      };
      messageReponse = `${credits} rapports crédités sur votre compte (total : ${newTotal}).`;
    }

    // ── Écriture RTDB avec ROLLBACK en cas d'erreur ───────────
    try {
      await Promise.all([
        ecrireLicenceDual(companyId, updateRTDB),
        db.ref(`companies/${companyId}/licenceHistory`).push({
          key,
          typePack,
          activatedAt:    nowISO,
          dateExpiration: TYPES_ABONNEMENTS.includes(typePack) ? dateExpiration : null,
          quantiteAgents: typePack === 'abonnement_unite' ? quantiteAgents : null,
          credits:        ['pack_20', 'pack_40'].includes(typePack)
            ? (typePack === 'pack_20' ? 20 : 40)
            : typePack,
        }),
      ]);
    } catch (rtdbErr) {
      // [ROLLBACK] Écriture RTDB échouée → Remettre la license à "disponible"
      console.error(`⚠️ Erreur RTDB lors activation ${key}. Rollback Firestore...`, rtdbErr);
      try {
        await licenceRef.update({
          statut: 'disponible',
          utilise_par: admin.firestore.FieldValue.delete(),
          date_activation: admin.firestore.FieldValue.delete(),
          date_expiration: admin.firestore.FieldValue.delete(),
        });
        console.log(`✅ Rollback Firestore réussi pour ${key}`);
      } catch (rollbackErr) {
        console.error(`❌ CRITIQUE: Rollback Firestore échoué pour ${key}`, rollbackErr);
      }
      throw rtdbErr; // Rethrow pour la réponse d'erreur
    }

    console.log(`✅ Licence activée: ${key} → société ${companyId} (${typePack})`);

    res.json({
      success:        true,
      typePack,
      estIllimite,
      quantiteAgents: typePack === 'abonnement_unite' ? quantiteAgents : null,
      dateExpiration: TYPES_ABONNEMENTS.includes(typePack) ? dateExpiration : null,
      message:        messageReponse,
    });

  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Clé de licence invalide' });
    }
    console.error('licence activate error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'activation. Veuillez réessayer.' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Consommer un rapport (impression)
// POST /api/rapport/consommer
// ─────────────────────────────────────────────────────────────
app.post('/api/rapport/consommer', requireAuth, async (req, res) => {
  const companyId = req.user.uid;

  try {
    const [droits, companySnap] = await Promise.all([
      resoudreDroits(companyId),
      db.ref(`companies/${companyId}`).get(),
    ]);

    const company    = companySnap.val() || {};
    const today      = todayKey();
    const dailyUsage = company.dailyReports?.[today] || 0;
    const companyRef = db.ref(`companies/${companyId}`);

    // Abonnement actif (flotte ou unité) ou pack illimité → toujours OK
    const rapportsIllimites = droits.estIllimite ||
      (droits.abonnementActif && TYPES_ABONNEMENTS.includes(droits.typeAbonnement));

    if (rapportsIllimites) {
      await companyRef.child(`dailyReports/${today}`).set(dailyUsage + 1);
      return res.json({ success: true, source: droits.typeAbonnement || 'illimite' });
    }

    // Rapports payants restants (pack_20 / pack_40)
    if (droits.rapportsRestants > 0) {
      await Promise.all([
        companyRef.child('licence/rapportsRestants').set(droits.rapportsRestants - 1),
        companyRef.child(`dailyReports/${today}`).set(dailyUsage + 1),
      ]);
      return res.json({
        success:          true,
        source:           'pack',
        rapportsRestants: droits.rapportsRestants - 1,
      });
    }

    // Impression gratuite du jour (plan freemium)
    if (dailyUsage < FREEMIUM.FREE_REPORTS_PER_DAY) {
      await companyRef.child(`dailyReports/${today}`).set(dailyUsage + 1);
      return res.json({
        success:                   true,
        source:                    'gratuit',
        freeReportsRemainingToday: 0,
      });
    }

    // Aucun crédit disponible
    return res.status(402).json({
      error:   'Aucun rapport disponible',
      message: 'Vous avez utilisé votre impression gratuite du jour. Achetez un pack pour continuer.',
      canBuy:  true,
    });

  } catch (err) {
    console.error('rapport consommer error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Vérifier limite agents (avant ajout)
// GET /api/agents/check-limit/:companyId
// Gère : freemium (max 10), abonnement_unite (limite dynamique),
//        abonnement_flotte / illimite (illimité)
// ─────────────────────────────────────────────────────────────
app.get('/api/agents/check-limit/:companyId', requireAuth, async (req, res) => {
  const { companyId } = req.params;
  if (req.user.uid !== companyId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const [droits, agentsSnap, companySnap] = await Promise.all([
      resoudreDroits(companyId),
      db.ref(`societes/${companyId}/agents`).get(),
      db.ref(`companies/${companyId}`).get(),
    ]);

    const company    = companySnap.val() || {};
    const userStatus = company.user_status || USER_STATUS.FREE_STRICT;
    const count      = agentsSnap.exists() ? Object.keys(agentsSnap.val()).length : 0;

    // ── Étape A : Illimité (pack illimité ou abonnement flotte actif) ──
    if (droits.estIllimite) {
      return res.json({
        allowed:        true,
        typePack:       droits.typePack,
        estIllimite:    true,
        abonnementActif: droits.abonnementActif,
        dateExpiration: droits.dateExpiration,
      });
    }

    let maxAgents = droits.maxAgents;
    if (droits.typePack === 'free' && !droits.abonnementActif && !droits.estIllimite) {
      maxAgents = userStatus === USER_STATUS.FREE_BONUS
        ? FREEMIUM.MAX_AGENTS_PACK
        : FREEMIUM.MAX_AGENTS_FREE;
    }

    // ── Étape B : Limite atteinte ──────────────────────────────
    if (count >= maxAgents) {
      let message;
      if (droits.abonnementActif && droits.typeAbonnement === 'abonnement_unite') {
        message = `Limite atteinte. Vous avez atteint le nombre maximal d'agents inclus dans votre abonnement actuel (${droits.quantiteAgents} agents). Veuillez ajuster votre quantité sur Chariow ou passer au Forfait Flotte Illimitée pour ajouter de nouveaux agents.`;
      } else if (droits.typePack === 'pack_20' || droits.typePack === 'pack_40') {
        message = `Limite atteinte. Passez au Forfait Flotte B2B (25 000 FCFA/mois) ou à l'Accès Illimité (20 000 FCFA) pour gérer plus d'agents.`;
      } else if (userStatus === USER_STATUS.FREE_STRICT) {
        message = `Limite atteinte. Plan gratuit : ${FREEMIUM.MAX_AGENTS_FREE} seul appareil suivi. Activez votre licence sur Chariow pour lever les limites.`;
      } else {
        message = `Limite atteinte. Le bonus de démarrage autorise ${FREEMIUM.MAX_AGENTS_PACK} appareils maximum. Passez à un pack ou abonnement pour en ajouter d'autres.`;
      }
      return res.json({
        allowed:         false,
        count,
        max:             maxAgents,
        typePack:        droits.typePack,
        typeAbonnement:  droits.typeAbonnement,
        quantiteAgents:  droits.quantiteAgents,
        abonnementActif: droits.abonnementActif,
        userStatus,
        planGratuit:     droits.typePack === 'free' && !droits.abonnementActif,
        message,
        upgradeUrl:      '/dashboard/licence.html',
      });
    }

    // ── Étape C : Avertissement préventif ─────────────────────
    // Pas d'avertissement pour le plan gratuit (limite = 1, pas de zone grise)
    // Avertissement à WARN_AGENTS_THRESHOLD pour les packs (8/10)
    // 80% de la limite pour les abonnements dynamiques
    const seuilAvertissement = maxAgents === Infinity
      ? Infinity                              // illimité → jamais d'avertissement
      : maxAgents >= FREEMIUM.MAX_AGENTS_PACK
        ? FREEMIUM.WARN_AGENTS_THRESHOLD      // packs 10 agents → alerte à 8
        : maxAgents;                          // gratuit (1) → pas d'alerte intermédiaire

    const warning = (seuilAvertissement !== Infinity && count >= seuilAvertissement && count < maxAgents)
      ? `⚠️ Il ne vous reste que ${maxAgents - count} place(s). Pensez à renouveler ou upgrader votre abonnement.`
      : null;

    res.json({
      allowed:         true,
      count,
      max:             maxAgents,
      typePack:        droits.typePack,
      estIllimite:     false,
      abonnementActif: droits.abonnementActif,
      typeAbonnement:  droits.typeAbonnement,
      dateExpiration:  droits.dateExpiration,
      userStatus,
      planGratuit:     droits.typePack === 'free' && !droits.abonnementActif,
      warning,
    });

  } catch (err) {
    console.error('check-limit error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE ADMIN : Enregistrer une ou plusieurs clés Chariow
// POST /api/admin/licence/import
// Header: x-admin-secret: <ADMIN_SECRET>
// Body: { keys: [...], type_pack: "pack_20"|"pack_40"|"illimite"|
//                                 "abonnement_flotte"|"abonnement_unite",
//         quantite_agents: number (requis pour abonnement_unite) }
//   OU  { key: "...", type_pack: "..." }  (clé unique)
// ─────────────────────────────────────────────────────────────
app.post('/api/admin/licence/import', requireSuperadmin, async (req, res) => {
  const { type_pack, key, keys, quantite_agents } = req.body;

  if (!TYPES_PACKS_VALIDES.includes(type_pack)) {
    return res.status(400).json({
      error: `type_pack invalide. Valeurs acceptées : ${TYPES_PACKS_VALIDES.join(', ')}`,
    });
  }

  // Pour abonnement_unite, la quantité d'agents est obligatoire
  if (type_pack === 'abonnement_unite') {
    if (!Number.isInteger(quantite_agents) || quantite_agents < 1) {
      return res.status(400).json({ error: 'quantite_agents (entier ≥ 1) requis pour abonnement_unite' });
    }
  }

  // Accepter un tableau ou une clé unique
  const rawList = Array.isArray(keys) ? keys : (key ? [key] : []);
  if (rawList.length === 0) {
    return res.status(400).json({ error: 'Fournir "key" (string) ou "keys" (array)' });
  }

  // Normaliser et valider chaque clé
  const normalized = [];
  const invalid    = [];
  for (const raw of rawList) {
    if (typeof raw !== 'string') { invalid.push(raw); continue; }
    const alphaOnly = raw.toUpperCase().replace(/[\s-]/g, '');
    if (alphaOnly.length !== 16 || !/^[A-Z0-9]{16}$/.test(alphaOnly)) {
      invalid.push(raw);
      continue;
    }
    normalized.push((alphaOnly.match(/.{1,4}/g) || []).join('-'));
  }

  if (invalid.length > 0) {
    return res.status(400).json({
      error: 'Certaines clés ont un format invalide (16 caractères alphanumériques attendus)',
      invalid,
    });
  }

  // Écriture en batch Firestore (max 499 ops par batch)
  const BATCH_SIZE = 499;
  const now        = admin.firestore.Timestamp.now();
  const results    = { created: [], skipped: [] };

  for (let i = 0; i < normalized.length; i += BATCH_SIZE) {
    const chunk = normalized.slice(i, i + BATCH_SIZE);
    const batch = firestore.batch();
    let chunkCreated = 0;

    for (const k of chunk) {
      const docRef = firestore.collection('licences').doc(k);
      const snap   = await docRef.get();
      if (snap.exists) {
        results.skipped.push(k);
        continue;
      }
      batch.set(docRef, {
        cle_licence:      k,
        type_pack,
        statut:           'disponible',
        statut_abonnement: TYPES_ABONNEMENTS.includes(type_pack) ? 'inactif' : null,
        quantite_agents:  type_pack === 'abonnement_unite' ? quantite_agents : null,
        date_creation:    now,
        utilise_par:      null,
        date_activation:  null,
        date_expiration:  null,
      });
      results.created.push(k);
      chunkCreated++;
    }

    if (chunkCreated > 0) {
      await batch.commit();
    }
  }

  console.log(`🔑 Import licences: ${results.created.length} créées, ${results.skipped.length} ignorées`);
  res.json({
    success:      true,
    type_pack,
    created:      results.created.length,
    skipped:      results.skipped.length,
    keys_created: results.created,
    keys_skipped: results.skipped,
  });
});

// ─────────────────────────────────────────────────────────────
// ROUTE ADMIN : Générer des clés de test (usage interne / dev)
// POST /api/admin/licence/generate
// Header: x-admin-secret: <ADMIN_SECRET>
// Body: { type_pack, count: 1, quantite_agents: N (pour abonnement_unite) }
// ─────────────────────────────────────────────────────────────
app.post('/api/admin/licence/generate', requireSuperadmin, async (req, res) => {
  const { type_pack, count = 1, quantite_agents } = req.body;

  if (!TYPES_PACKS_VALIDES.includes(type_pack)) {
    return res.status(400).json({
      error: `type_pack invalide. Valeurs acceptées : ${TYPES_PACKS_VALIDES.join(', ')}`,
    });
  }
  if (type_pack === 'abonnement_unite' && (!Number.isInteger(quantite_agents) || quantite_agents < 1)) {
    return res.status(400).json({ error: 'quantite_agents (entier ≥ 1) requis pour abonnement_unite' });
  }
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return res.status(400).json({ error: 'count doit être un entier entre 1 et 100' });
  }

  try {
    const now       = admin.firestore.Timestamp.now();
    const batch     = firestore.batch();
    const generated = [];

    for (let i = 0; i < count; i++) {
      const k      = generateLicenceKey();
      const docRef = firestore.collection('licences').doc(k);
      batch.set(docRef, {
        cle_licence:      k,
        type_pack,
        statut:           'disponible',
        statut_abonnement: TYPES_ABONNEMENTS.includes(type_pack) ? 'inactif' : null,
        quantite_agents:  type_pack === 'abonnement_unite' ? quantite_agents : null,
        date_creation:    now,
        utilise_par:      null,
        date_activation:  null,
        date_expiration:  null,
      });
      generated.push(k);
    }

    await batch.commit();
    console.log(`🔑 ${count} clé(s) générée(s) (${type_pack}):`, generated);
    res.json({ success: true, type_pack, count, keys: generated });
  } catch (err) {
    console.error('generate licence error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE WEBHOOK : Chariow Pulse (catalogue unifié — détection par ID produit)
// POST /api/webhook/chariow-pulse
// Header: x-chariow-secret: <CHARIOW_WEBHOOK_SECRET>
//
// Payload (exemple) :
// {
//   "status": "paid",
//   "uid": "<firebase uid société>",
//   "product": { "id": "prd_raupzm8z" },
//   "order_id": "ORD-123",
//   "customer_email": "client@example.com"
// }
// ─────────────────────────────────────────────────────────────
async function traiterPaiementChariowParId(companyId, productId, payload) {
  const profil = await lireProfilSociete(companyId);
  const jours  = joursPourProduitChariow(productId);
  const nowISO = new Date().toISOString();
  const meta   = {
    chariow_order_id: payload.order_id || null,
    chariow_product_id: productId,
    chariow_paid_at:    nowISO,
  };

  switch (productId) {
    case CHARIOW_PRODUCTS.WIFI_MENSUEL:
    case CHARIOW_PRODUCTS.WIFI_ANNUEL: {
      const exp = prolongerExpirationMs(profil.option_tracking_wifi_expire, jours);
      await ecrireProfilSociete(companyId, {
        option_tracking_wifi_expire: exp,
        ...meta,
      });
      return { effect: 'wifi', expiration: exp };
    }

    case CHARIOW_PRODUCTS.PARTICULIER_MENSUEL:
    case CHARIOW_PRODUCTS.PARTICULIER_ANNUEL: {
      const exp = prolongerExpirationMs(profil.abonnement_particulier_expire, jours);
      await ecrireProfilSociete(companyId, {
        abonnement_particulier_expire: exp,
        user_status:                  'premium',
        ...meta,
      });
      await ecrireLicenceDual(companyId, {
        typePack:         'particulier_premium',
        abonnement_actif: true,
        date_expiration:  new Date(exp).toISOString(),
        quantite_agents:  1,
        est_illimite:     false,
      });
      return { effect: 'particulier_premium', expiration: exp, maxAgents: 1 };
    }

    case CHARIOW_PRODUCTS.ELEVE_MENSUEL:
    case CHARIOW_PRODUCTS.ELEVE_ANNUEL: {
      const exp = prolongerExpirationMs(profil.abonnement_scolaire_expire, jours);
      const quantite = parseInt(payload.quantity || payload.product?.quantity || 1, 10) || 1;
      await ecrireProfilSociete(companyId, {
        abonnement_scolaire_expire: exp,
        abonnement_scolaire_type:   'suivi_eleve',
        ...meta,
      });
      await ecrireLicenceDual(companyId, {
        typePack:          'free',
        abonnement_actif:  true,
        type_abonnement:   'suivi_eleve',
        date_expiration:   new Date(exp).toISOString(),
        quantite_agents:   quantite,
        est_illimite:      false,
      });
      return { effect: 'suivi_eleve', expiration: exp };
    }

    case CHARIOW_PRODUCTS.ETUDIANT_MENSUEL:
    case CHARIOW_PRODUCTS.ETUDIANT_ANNUEL: {
      const exp = prolongerExpirationMs(profil.abonnement_scolaire_expire, jours);
      const quantite = parseInt(payload.quantity || payload.product?.quantity || 1, 10) || 1;
      await ecrireProfilSociete(companyId, {
        abonnement_scolaire_expire: exp,
        abonnement_scolaire_type:   'suivi_etudiant',
        ...meta,
      });
      await ecrireLicenceDual(companyId, {
        typePack:          'free',
        abonnement_actif:  true,
        type_abonnement:   'suivi_etudiant',
        date_expiration:   new Date(exp).toISOString(),
        quantite_agents:   quantite,
        est_illimite:      false,
      });
      return { effect: 'suivi_etudiant', expiration: exp };
    }

    case CHARIOW_PRODUCTS.FORFAIT_FLOTTE: {
      const expLicence = prolongerExpirationMs(
        profil.licence?.date_expiration ? new Date(profil.licence.date_expiration).getTime() : 0,
        jours,
      );
      await ecrireLicenceDual(companyId, {
        typePack:          'abonnement_flotte',
        abonnement_actif:  true,
        type_abonnement:   'abonnement_flotte',
        date_expiration:   new Date(expLicence).toISOString(),
        est_illimite:      true,
        quantite_agents:   null,
        lastActivation:    nowISO,
      });
      await ecrireProfilSociete(companyId, { user_status: 'premium', ...meta });
      return { effect: 'abonnement_flotte', expiration: expLicence };
    }

    case CHARIOW_PRODUCTS.ACCES_ILLIMITE: {
      await ecrireLicenceDual(companyId, {
        typePack:         'illimite',
        est_illimite:     true,
        abonnement_actif: false,
        type_abonnement:  null,
        rapportsRestants: null,
        lastActivation:   nowISO,
      });
      await ecrireProfilSociete(companyId, { user_status: 'premium', ...meta });
      return { effect: 'acces_illimite' };
    }

    default:
      return null;
  }
}

// ── Fonction de vérification HMAC du webhook Chariow ──────────
function verifierSignatureChariow(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  const body = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const computed = hmac.digest('hex');
  
  // Comparaison timing-safe
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}

app.post('/api/webhook/chariow-pulse', async (req, res) => {
  const secret = req.headers['x-chariow-secret'];
  if (!secret || secret !== process.env.CHARIOW_WEBHOOK_SECRET) {
    console.warn('⚠️ Webhook Chariow : secret invalide');
    return res.status(403).json({ error: 'Secret webhook invalide' });
  }

  const payload = req.body;
  const signature = req.headers['x-chariow-signature'];
  const timestamp = parseInt(req.headers['x-chariow-timestamp'] || '0', 10);

  // [SÉCURITÉ] Vérifier la signature HMAC du corps
  try {
    const verified = verifierSignatureChariow(payload, signature, process.env.CHARIOW_WEBHOOK_SECRET);
    if (!verified) {
      console.warn('⚠️ Webhook Chariow : signature invalide');
      return res.status(403).json({ error: 'Signature invalide' });
    }
  } catch (err) {
    console.warn('⚠️ Webhook Chariow : erreur vérification signature', err.message);
    return res.status(403).json({ error: 'Signature invalide' });
  }

  // [SÉCURITÉ] Vérifier le timestamp (rejeter si > 5 minutes)
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes en ms
  if (timestamp && Math.abs(now - timestamp) > maxAge) {
    console.warn('⚠️ Webhook Chariow : timestamp expiré (replay attack?)', { now, timestamp });
    return res.status(403).json({ error: 'Requête expirée' });
  }

  if (payload.status !== 'paid') {
    console.log(`ℹ️ Webhook Chariow ignoré (statut: ${payload.status})`);
    return res.json({ ignored: true, reason: `statut non payé: ${payload.status}` });
  }

  const productId = extraireProductIdChariow(payload);
  if (!productId) {
    return res.status(400).json({ error: 'product.id manquant dans le payload' });
  }

  try {
    const companyId = await resoudreCompanyIdDepuisPayload(payload);
    if (!companyId) {
      console.error('❌ Webhook Chariow : UID société introuvable', payload.order_id);
      return res.status(400).json({
        error: 'UID société introuvable — ajoutez ?uid= sur le lien de paiement',
      });
    }

    // [SÉCURITÉ] Vérifier l'idempotence AVANT de traiter (évite les doublons)
    const orderId = payload.order_id || payload.orderId;
    if (orderId) {
      const profil = await lireProfilSociete(companyId);
      if (profil.chariow_order_id === orderId && profil.chariow_product_id === productId) {
        console.log(`ℹ️ Webhook Chariow : paiement ${orderId} déjà traité (idempotence)`);
        return res.json({ success: true, already_processed: true, companyId, productId });
      }
    }

    const result = await traiterPaiementChariowParId(companyId, productId, payload);
    if (!result) {
      console.warn(`⚠️ Webhook Chariow : ID produit non géré → ${productId}`);
      return res.json({ ignored: true, reason: `produit non géré: ${productId}` });
    }

    console.log(`✅ Webhook Chariow : ${productId} → société ${companyId}`, result);
    res.json({ success: true, companyId, productId, ...result });
  } catch (err) {
    console.error('webhook chariow error:', err);
    res.status(500).json({ error: 'Erreur serveur lors du traitement du webhook' });
  }
});

// ─────────────────────────────────────────────────────────────
// CRON JOB : Vérification quotidienne des abonnements expirés
// Planifié à 01h00 UTC chaque nuit (heure Congo = UTC+1 → 02h00)
// ─────────────────────────────────────────────────────────────

/**
 * Scanne tous les abonnements actifs dans Firestore dont la date
 * d'expiration est dépassée, bascule leur statut à "expire" et
 * réapplique le mode Freemium restreint sur la société concernée.
 *
 * @returns {Promise<{ traites: number, erreurs: number }>}
 */
async function verifierAbonnementsExpires() {
  console.log('🕐 Cron : vérification des abonnements expirés...');
  const maintenant = new Date();
  let traites = 0;
  let erreurs  = 0;

  // Vérifier les abonnements scolaires expirés directement dans le RTDB
  // (ils ne passent pas par le champ Firestore statut_abonnement)
  try {
    const societesSnap = await db.ref('societes').get();
    if (societesSnap.exists()) {
      for (const [companyId, societe] of Object.entries(societesSnap.val())) {
        const scolaireExpire = societe.abonnement_scolaire_expire;
        if (!scolaireExpire) continue;
        if (Number(scolaireExpire) < maintenant.getTime()) {
          try {
            await ecrireLicenceDual(companyId, {
              abonnement_actif: false,
              type_abonnement:  null,
              est_illimite:     false,
              quantite_agents:  null,
            });
            await Promise.all([
              db.ref(`societes/${companyId}`).update({ abonnement_scolaire_expire: null, abonnement_scolaire_type: null }),
              db.ref(`companies/${companyId}`).update({ abonnement_scolaire_expire: null, abonnement_scolaire_type: null }),
            ]);
            await db.ref(`companies/${companyId}/notifications`).push({
              type:      'abonnement_expire',
              typePack:  societe.abonnement_scolaire_type || 'suivi_scolaire',
              expiredAt: maintenant.toISOString(),
              message:   `Votre abonnement scolaire a expiré. Renouvelez pour continuer le suivi.`,
              lu:        false,
              createdAt: maintenant.toISOString(),
            });
            console.log(`🔒 Abonnement scolaire expiré → société ${companyId}`);
            traites++;
          } catch (errDoc) {
            console.error(`❌ Cron scolaire : erreur société ${companyId}:`, errDoc.message);
            erreurs++;
          }
        }
      }
    }
  } catch (errRtdb) {
    console.error('❌ Cron scolaire : erreur lecture RTDB:', errRtdb.message);
    erreurs++;
  }

  try {
    // Requête Firestore : abonnements actifs dont la date d'expiration est passée
    const snapshot = await firestore
      .collection('licences')
      .where('statut_abonnement', '==', 'actif')
      .where('date_expiration', '<', admin.firestore.Timestamp.fromDate(maintenant))
      .get();

    if (snapshot.empty) {
      console.log('✅ Cron Firestore : aucun abonnement expiré trouvé.');
    } else {
      console.log(`⚠️ Cron : ${snapshot.size} abonnement(s) expiré(s) à traiter.`);

      for (const doc of snapshot.docs) {
        const data      = doc.data();
        const companyId = data.utilise_par;

        try {
          await doc.ref.update({ statut_abonnement: 'expire' });

          if (companyId) {
            await appliquerFreemiumRestreint(companyId);

            await db.ref(`companies/${companyId}/notifications`).push({
              type:      'abonnement_expire',
              typePack:  data.type_pack,
              expiredAt: maintenant.toISOString(),
              message:   `Votre abonnement ${data.type_pack === 'abonnement_flotte' ? 'Forfait Flotte' : 'Tarif à l\'Unité'} a expiré. Renouvelez pour continuer à profiter de tous vos avantages.`,
              lu:        false,
              createdAt: maintenant.toISOString(),
            });

            console.log(`🔔 Notification de relance créée → société ${companyId}`);
          }

          traites++;
        } catch (errDoc) {
          console.error(`❌ Cron : erreur traitement doc ${doc.id}:`, errDoc.message);
          erreurs++;
        }
      }
    }

  } catch (err) {
    console.error('❌ Cron : erreur requête Firestore:', err.message);
    erreurs++;
  }

  console.log(`✅ Cron terminé : ${traites} traité(s), ${erreurs} erreur(s).`);
  return { traites, erreurs };
}

// Planification : tous les jours à 01h00 UTC
cron.schedule('0 1 * * *', () => {
  verifierAbonnementsExpires().catch((err) => {
    console.error('❌ Cron non géré:', err.message);
  });
}, { timezone: 'UTC' });

console.log('⏰ Cron d\'expiration des abonnements planifié (01h00 UTC quotidien)');

// ─────────────────────────────────────────────────────────────
// ROUTE ADMIN : Déclencher manuellement la vérification des expirations
// POST /api/admin/cron/check-expirations
// Header: x-admin-secret: <ADMIN_SECRET>
// Utile pour les tests ou un déclenchement forcé depuis Render
// ─────────────────────────────────────────────────────────────
app.post('/api/admin/cron/check-expirations', requireSuperadmin, async (req, res) => {

  try {
    const result = await verifierAbonnementsExpires();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('check-expirations manual error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// Module de génération PDF
// ─────────────────────────────────────────────────────────────
const { genererRapportPDF, geocoderPoints } = require('./reports/generateReport');

// ─────────────────────────────────────────────────────────────
// ROUTE : Générer un rapport PDF d'activité
// POST /api/rapport/generer
// Auth : Bearer token Firebase
//
// Body JSON :
// {
//   "agentId":    "chauffeur-01",          ← ID RTDB de l'agent
//   "dateDebut":  "2025-05-01T00:00:00Z",  ← ISO 8601
//   "dateFin":    "2025-05-17T23:59:59Z",
//   "secteur":    "moto" | "voiture" | "camion" | "scolaire"
// }
//
// Réponse : application/pdf (stream direct) ou JSON d'erreur
// ─────────────────────────────────────────────────────────────
app.post('/api/rapport/generer', requireAuth, async (req, res) => {
  const companyId = req.user.uid;
  const { agentId, dateDebut, dateFin, secteur } = req.body;

  // ── Validation des paramètres ────────────────────────────────
  if (!agentId || typeof agentId !== 'string') {
    return res.status(400).json({ error: 'agentId requis' });
  }
  if (!dateDebut || !dateFin) {
    return res.status(400).json({ error: 'dateDebut et dateFin requis (ISO 8601)' });
  }

  const tsDebut = new Date(dateDebut).getTime();
  const tsFin   = new Date(dateFin).getTime();

  if (!Number.isFinite(tsDebut) || !Number.isFinite(tsFin) || tsDebut >= tsFin) {
    return res.status(400).json({ error: 'Dates invalides ou dateDebut ≥ dateFin' });
  }

  const SECTEURS_VALIDES = ['moto', 'voiture', 'camion', 'scolaire'];
  const secteurNorm = (secteur || 'voiture').toLowerCase();
  if (!SECTEURS_VALIDES.includes(secteurNorm)) {
    return res.status(400).json({ error: `secteur invalide. Valeurs : ${SECTEURS_VALIDES.join(', ')}` });
  }

  try {
    // ── Vérifier les droits d'impression ────────────────────────
    const droits      = await resoudreDroits(companyId);
    const companySnap = await db.ref(`companies/${companyId}`).get();
    const company     = companySnap.val() || {};
    const today       = todayKey(); // format YYYY-MM-DD

    // Abonnement mensuel actif — tous types (flotte, unité, scolaire)
    const aAbonnementActif = droits.abonnementActif && (
      droits.typeAbonnement === 'abonnement_flotte' ||
      droits.typeAbonnement === 'abonnement_unite'  ||
      TYPES_SCOLAIRES.includes(droits.typeAbonnement)
    );
    const aPackIllimite     = droits.typePack === 'illimite' || droits.estIllimite;
    const rapportsIllimites = aAbonnementActif || aPackIllimite ||
      droits.rapportsIllimitesParticulier || droits.scolaireActif;

    // Pack crédits (pack_20 / pack_40) avec solde restant
    const aSoldePayant = !rapportsIllimites && (droits.rapportsRestants > 0);

    const userStatus = company.user_status || USER_STATUS.FREE_STRICT;

    if (!rapportsIllimites && !aSoldePayant) {
      // FREE_STRICT : 1 rapport/jour via dernier_rapport_date
      if (userStatus === USER_STATUS.FREE_STRICT) {
        const dernierRapport = company.dernier_rapport_date || null;
        if (dernierRapport === today) {
          return res.status(402).json({
            error:   'quota_epuise',
            message: 'Limite quotidienne atteinte. Plan gratuit : 1 seule impression par jour. Activez votre licence sur Chariow pour des rapports illimités.',
            canBuy:  true,
          });
        }
      } else if (userStatus !== USER_STATUS.FREE_BONUS) {
        // Fallback legacy freemium_quota
        const quota              = company.freemium_quota || {};
        const derniereImpression = quota.derniere_impression || null;
        const compteurJours      = quota.compteur_jours      || 0;
        const quotaActuel        = derniereImpression === today ? compteurJours : 0;

        if (quotaActuel >= FREEMIUM.FREE_REPORTS_PER_DAY) {
          return res.status(402).json({
            error:   'quota_epuise',
            message: 'Limite quotidienne atteinte. Plan gratuit : 1 seule impression par jour. Activez votre licence sur Chariow pour des rapports illimités.',
            canBuy:  true,
          });
        }
      }
    }

    // ── Validation spécifique suivi scolaire ─────────────────────
    // Si secteur = "scolaire", vérifier l'abonnement ET le lien parent/élève
    if (secteurNorm === 'scolaire') {
      if (!droits.estSuiviScolaire) {
        return res.status(403).json({
          error:   'abonnement_scolaire_requis',
          message: 'Les rapports d\'assiduité scolaire nécessitent un abonnement "Suivi Élève" (3 000 FCFA/mois) ou "Suivi Étudiant" (3 000 FCFA/mois) actif.',
          offres: [
            { label: 'Suivi Élève',    prix: '3 000 FCFA/mois',  url: `https://erpbbfef.mychariow.shop/${CHARIOW_PRODUCTS.ELEVE_MENSUEL}`    },
            { label: 'Suivi Étudiant', prix: '3 000 FCFA/mois',  url: `https://erpbbfef.mychariow.shop/${CHARIOW_PRODUCTS.ETUDIANT_MENSUEL}` },
          ],
          canBuy: true,
        });
      }
      // Vérifier que l'élève/étudiant est bien lié à ce compte parent
      const eleveSnap = await db.ref(`companies/${companyId}/eleves_lies/${agentId}`).get();
      if (!eleveSnap.exists()) {
        return res.status(403).json({
          error:   'eleve_non_lie',
          message: `L'élève/étudiant "${agentId}" n'est pas lié à votre compte. Demandez-lui de s'inscrire avec votre code.`,
        });
      }
    }

    // ── Charger les données de l'agent depuis le RTDB ────────────
    const agentSnap = await db.ref(`societes/${companyId}/agents/${agentId}`).get();
    if (!agentSnap.exists()) {
      return res.status(404).json({ error: `Agent "${agentId}" introuvable` });
    }

    const agent = agentSnap.val();

    // L'agent est directement sous la société — pas besoin de vérifier companyId
    // (le chemin societes/{companyId}/agents/{agentId} garantit l'appartenance)

    // ── Extraire les points de la période demandée ───────────────
    const history = agent.history || {};
    const points  = Object.entries(history)
      .map(([tsStr, val]) => ({
        ts:  Number(tsStr),
        lat: val.lat,
        lng: val.lng,
      }))
      .filter((p) =>
        Number.isFinite(p.ts) &&
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        p.ts >= tsDebut &&
        p.ts <= tsFin
      )
      .sort((a, b) => a.ts - b.ts);

    if (points.length === 0) {
      return res.status(404).json({
        error:   'Aucune donnée GPS pour cette période',
        message: `Aucun point enregistré pour l'agent "${agentId}" entre ${dateDebut} et ${dateFin}.`,
      });
    }

    // ── Géocoder les points clés (premier, dernier, et 1 sur 10) ─
    // Sélection : on ne géocode pas tous les points pour limiter
    // les appels Nominatim. Le module gère le cache + rate-limit.
    const pointsACoder = points.filter((_, i) =>
      i === 0 || i === points.length - 1 || i % 10 === 0
    );

    // geocoderPoints : séquentiel, 1,1 s entre chaque cache-miss,
    // fallback coordonnées brutes garanti — ne lève jamais d'exception
    const adresses = await geocoderPoints(pointsACoder);

    // ── Générer le PDF ───────────────────────────────────────────
    const pdfBuffer = await genererRapportPDF({
      companyName: company.companyName || 'Société',
      secteur:     secteurNorm,
      agentNom:    agent.name || agentId,
      agentId,
      dateDebut,
      dateFin,
      logoUrl:     company.logoUrl || null,
      points,
      adresses,
    });

    // ── Décrémenter le compteur de rapports ──────────────────────
    // Règle métier :
    //   • abonnement_flotte actif  → aucune décrémentation
    //   • abonnement_unite actif   → aucune décrémentation
    //   • pack illimité permanent  → aucune décrémentation
    //   • pack_20 / pack_40        → décrémenter rapportsRestants
    //   • freemium (solde = 0)     → incrémenter freemium_quota
    //
    // Utilise des transactions atomiques RTDB pour éviter les race conditions.
    const companyRef = db.ref(`companies/${companyId}`);
    const licenceRef = companyRef.child('licence');

    if (rapportsIllimites) {
      // Abonnement actif ou pack illimité → aucun décompte
      // On incrémente uniquement le compteur journalier (statistiques internes)
      await companyRef.child(`dailyReports/${today}`).transaction((val) => (val || 0) + 1);
      console.log(`📊 Rapport gratuit (${droits.typeAbonnement || 'illimite'}) → société ${companyId}`);

    } else if (aSoldePayant) {
      // Pack crédits (pack_20 / pack_40) → décrémenter le solde atomiquement
      let sourceUtilisee = 'pack';

      await licenceRef.transaction((licenceData) => {
        if (!licenceData) { sourceUtilisee = 'gratuit'; return licenceData; }
        const solde = licenceData.rapportsRestants || 0;
        if (solde > 0) {
          sourceUtilisee = licenceData.typePack || 'pack';
          return { ...licenceData, rapportsRestants: solde - 1 };
        }
        sourceUtilisee = 'gratuit';
        return licenceData;
      });

      await companyRef.child(`dailyReports/${today}`).transaction((val) => (val || 0) + 1);
      console.log(`📊 Rapport débité (source="${sourceUtilisee}") → société ${companyId}`);

    } else {
      const updates = {
        dernier_rapport_date: today,
      };

      if (userStatus === USER_STATUS.FREE_STRICT) {
        await companyRef.update(updates);
        await companyRef.child('freemium_quota').transaction((quota) => {
          const q = quota || {};
          const memeJour = q.derniere_impression === today;
          return {
            derniere_impression: today,
            compteur_jours:      memeJour ? (q.compteur_jours || 0) + 1 : 1,
          };
        });
      } else if (userStatus !== USER_STATUS.FREE_BONUS) {
        await companyRef.child('freemium_quota').transaction((quota) => {
          const q = quota || {};
          const memeJour = q.derniere_impression === today;
          return {
            derniere_impression: today,
            compteur_jours:      memeJour ? (q.compteur_jours || 0) + 1 : 1,
          };
        });
      }

      console.log(`📊 Impression gratuite consommée (${userStatus}) → société ${companyId}`);
    }

    // ── Enregistrer dans l'historique des rapports ───────────────
    await db.ref(`companies/${companyId}/rapportsHistory`).push({
      agentId,
      agentNom:  agent.name || agentId,
      secteur:   secteurNorm,
      dateDebut,
      dateFin,
      nbPoints:  points.length,
      genereAt:  new Date().toISOString(),
    });

    console.log(`📄 Rapport généré: ${agentId} (${secteurNorm}) → société ${companyId} [${points.length} pts]`);

    // ── Envoyer le PDF en réponse ────────────────────────────────
    const nomFichier = `rapport_${agentId}_${dateDebut.slice(0, 10)}_${dateFin.slice(0, 10)}.pdf`
      .replace(/[^a-zA-Z0-9_\-.]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('rapport generer error:', err);
    res.status(500).json({ error: 'Erreur lors de la génération du rapport', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE ADMIN : Statistiques globales
// GET /api/admin/stats
// Header: x-admin-secret: <ADMIN_SECRET>
// ─────────────────────────────────────────────────────────────
app.get('/api/admin/stats', requireSuperadmin, async (req, res) => {

  try {
    // Compter les sociétés dans le RTDB
    const companiesSnap = await db.ref('companies').get();
    const totalSocietes = companiesSnap.exists()
      ? Object.keys(companiesSnap.val()).length
      : 0;

    // Compter les abonnements actifs dans Firestore
    const [abonnementsSnap, disponiblesSnap, utilisesSnap] = await Promise.all([
      firestore.collection('licences')
        .where('statut_abonnement', '==', 'actif')
        .count().get(),
      firestore.collection('licences')
        .where('statut', '==', 'disponible')
        .count().get(),
      firestore.collection('licences')
        .where('statut', '==', 'utilise')
        .count().get(),
    ]);

    res.json({
      totalSocietes,
      abonnementsActifs: abonnementsSnap.data().count,
      clesDisponibles:   disponiblesSnap.data().count,
      clesUtilisees:     utilisesSnap.data().count,
    });
  } catch (err) {
    console.error('admin stats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE ADMIN : Notifications d'expiration (J-7, J-3, J-1)
// POST /api/admin/notifications/expiration
// Header: x-admin-secret: <ADMIN_SECRET>
//
// Crée une notification RTDB dans companies/{id}/notifications
// pour chaque société dont l'abonnement expire dans 7, 3 ou 1 jour.
// ─────────────────────────────────────────────────────────────
app.post('/api/admin/notifications/expiration', requireSuperadmin, async (req, res) => {

  const maintenant = new Date();
  const compteurs  = { j7: 0, j3: 0, j1: 0, total: 0 };

  try {
    // Récupérer tous les abonnements actifs non expirés
    const snapshot = await firestore
      .collection('licences')
      .where('statut_abonnement', '==', 'actif')
      .get();

    for (const doc of snapshot.docs) {
      const data       = doc.data();
      const companyId  = data.utilise_par;
      if (!companyId) continue;

      const dateExp = data.date_expiration?.toDate?.() || new Date(data.date_expiration);
      if (!dateExp || isNaN(dateExp.getTime())) continue;

      const diffMs   = dateExp.getTime() - maintenant.getTime();
      const diffJours = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      // Seuils : J-7, J-3, J-1
      if (![7, 3, 1].includes(diffJours)) continue;

      const packLabel = data.type_pack === 'abonnement_flotte'
        ? 'Forfait Flotte'
        : `Tarif à l'Unité (${data.quantite_agents || 1} agent(s))`;

      const dateStr = dateExp.toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric',
      });

      // Créer la notification dans le RTDB de la société
      await db.ref(`companies/${companyId}/notifications`).push({
        type:      'expiration_imminente',
        typePack:  data.type_pack,
        joursRestants: diffJours,
        expiredAt: dateExp.toISOString(),
        message:   `⚠️ Votre ${packLabel} expire dans ${diffJours} jour(s) (le ${dateStr}). Renouvelez dès maintenant pour éviter toute interruption de service.`,
        lu:        false,
        createdAt: maintenant.toISOString(),
      });

      if (diffJours === 7) compteurs.j7++;
      if (diffJours === 3) compteurs.j3++;
      if (diffJours === 1) compteurs.j1++;
      compteurs.total++;
    }

    console.log(`📧 Notifications expiration: ${compteurs.total} envoyées (J-7:${compteurs.j7}, J-3:${compteurs.j3}, J-1:${compteurs.j1})`);
    res.json({ success: true, envoyes: compteurs.total, ...compteurs });

  } catch (err) {
    console.error('notifications expiration error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Géofencing — Définir/lire les zones d'une société
// GET  /api/geofencing/:companyId        → liste des zones
// POST /api/geofencing/:companyId        → créer une zone
// DELETE /api/geofencing/:companyId/:zoneId → supprimer une zone
//
// Structure RTDB : companies/{id}/geofences/{zoneId}
//   { name, lat, lng, radiusMeters, alertOnExit, alertOnEnter, active }
// ─────────────────────────────────────────────────────────────
app.get('/api/geofencing/:companyId', requireAuth, async (req, res) => {
  const { companyId } = req.params;
  if (req.user.uid !== companyId) return res.status(403).json({ error: 'Accès refusé' });

  try {
    const snap = await db.ref(`companies/${companyId}/geofences`).get();
    const zones = snap.exists() ? snap.val() : {};
    res.json({ zones });
  } catch (err) {
    console.error('geofencing get error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/geofencing/:companyId', requireAuth, requireCongoCoordinates, async (req, res) => {
  const { companyId } = req.params;
  if (req.user.uid !== companyId) return res.status(403).json({ error: 'Accès refusé' });

  const { name, lat, lng, radiusMeters, alertOnExit = true, alertOnEnter = false } = req.body;

  if (!name || typeof lat !== 'number' || typeof lng !== 'number' || !radiusMeters) {
    return res.status(400).json({ error: 'name, lat, lng, radiusMeters requis' });
  }
  if (radiusMeters < 50 || radiusMeters > 50000) {
    return res.status(400).json({ error: 'radiusMeters doit être entre 50 m et 50 km' });
  }

  try {
    const ref = await db.ref(`companies/${companyId}/geofences`).push({
      name,
      lat,
      lng,
      radiusMeters,
      alertOnExit,
      alertOnEnter,
      active:    true,
      createdAt: new Date().toISOString(),
    });
    res.json({ success: true, zoneId: ref.key });
  } catch (err) {
    console.error('geofencing post error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/geofencing/:companyId/:zoneId', requireAuth, async (req, res) => {
  const { companyId, zoneId } = req.params;
  if (req.user.uid !== companyId) return res.status(403).json({ error: 'Accès refusé' });

  try {
    await db.ref(`companies/${companyId}/geofences/${zoneId}`).remove();
    res.json({ success: true });
  } catch (err) {
    console.error('geofencing delete error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Géofencing — Vérifier la position d'un agent
// POST /api/geofencing/:companyId/check
// Body: { agentId, lat, lng }
// Appelé par l'app Android après chaque mise à jour GPS.
// Retourne les alertes déclenchées (entrée/sortie de zone).
// ─────────────────────────────────────────────────────────────
app.post('/api/geofencing/:companyId/check', requireAuth, async (req, res) => {
  const { companyId } = req.params;
  if (req.user.uid !== companyId) return res.status(403).json({ error: 'Accès refusé' });

  const { agentId, lat, lng } = req.body;
  if (!agentId || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'agentId, lat, lng requis' });
  }

  try {
    const [zonesSnap, agentSnap] = await Promise.all([
      db.ref(`companies/${companyId}/geofences`).get(),
      db.ref(`societes/${companyId}/agents/${agentId}`).get(),
    ]);

    if (!zonesSnap.exists()) return res.json({ alertes: [] });

    const zones  = zonesSnap.val();
    const agent  = agentSnap.val() || {};
    const alertes = [];

    for (const [zoneId, zone] of Object.entries(zones)) {
      if (!zone.active) continue;

      // Distance Haversine entre la position actuelle et le centre de la zone
      const dist = distanceHaversineMetres(lat, lng, zone.lat, zone.lng);
      const estDedans = dist <= zone.radiusMeters;

      // Lire l'état précédent depuis le RTDB de l'agent
      const etatPrecedentSnap = await db.ref(`societes/${companyId}/agents/${agentId}/geofenceStates/${zoneId}`).get();
      const etaitDedans = etatPrecedentSnap.val()?.dedans ?? false;

      // Détecter la transition pour cette zone uniquement
      let alerteCourante = null;
      if (estDedans && !etaitDedans && zone.alertOnEnter) {
        alerteCourante = { zoneId, zoneName: zone.name, type: 'entree', distanceMetres: Math.round(dist) };
        alertes.push(alerteCourante);
      } else if (!estDedans && etaitDedans && zone.alertOnExit) {
        alerteCourante = { zoneId, zoneName: zone.name, type: 'sortie', distanceMetres: Math.round(dist) };
        alertes.push(alerteCourante);
      }

      // Mettre à jour l'état dans le RTDB
      await db.ref(`societes/${companyId}/agents/${agentId}/geofenceStates/${zoneId}`).set({
        dedans:    estDedans,
        updatedAt: Date.now(),
      });

      // Créer une notification RTDB uniquement si cette zone a déclenché une alerte
      if (alerteCourante) {
        await db.ref(`companies/${companyId}/notifications`).push({
          type:      `geofence_${alerteCourante.type}`,
          agentId,
          agentNom:  agent.name || agentId,
          zoneId,
          zoneName:  zone.name,
          message:   `${agent.name || agentId} ${alerteCourante.type === 'entree' ? 'est entré dans' : 'a quitté'} la zone "${zone.name}"`,
          lu:        false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    res.json({ alertes });
  } catch (err) {
    console.error('geofencing check error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * Distance Haversine en mètres entre deux points GPS.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} distance en mètres
 */
function distanceHaversineMetres(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Planification des notifications d'expiration : tous les jours à 08h00 UTC
cron.schedule('0 8 * * *', async () => {
  try {
    // Simuler un appel interne à la route de notification
    const maintenant = new Date();
    const snapshot   = await firestore
      .collection('licences')
      .where('statut_abonnement', '==', 'actif')
      .get();

    let total = 0;
    for (const doc of snapshot.docs) {
      const data      = doc.data();
      const companyId = data.utilise_par;
      if (!companyId) continue;

      const dateExp   = data.date_expiration?.toDate?.() || new Date(data.date_expiration);
      if (!dateExp || isNaN(dateExp.getTime())) continue;

      const diffJours = Math.ceil((dateExp.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24));
      if (![7, 3, 1].includes(diffJours)) continue;

      const packLabel = data.type_pack === 'abonnement_flotte'
        ? 'Forfait Flotte'
        : `Tarif à l'Unité (${data.quantite_agents || 1} agent(s))`;

      await db.ref(`companies/${companyId}/notifications`).push({
        type:          'expiration_imminente',
        typePack:      data.type_pack,
        joursRestants: diffJours,
        expiredAt:     dateExp.toISOString(),
        message:       `⚠️ Votre ${packLabel} expire dans ${diffJours} jour(s). Renouvelez dès maintenant.`,
        lu:            false,
        createdAt:     maintenant.toISOString(),
      });
      total++;
    }
    if (total > 0) console.log(`📧 Cron notifications: ${total} rappel(s) d'expiration créé(s)`);
  } catch (err) {
    console.error('❌ Cron notifications error:', err.message);
  }
}, { timezone: 'UTC' });

console.log('⏰ Cron notifications d\'expiration planifié (08h00 UTC quotidien)');

// ─────────────────────────────────────────────────────────────
// GÉOGRAPHIE — Bounding Box Congo (République du Congo)
// Coordonnées approximatives couvrant tout le territoire national
// + une marge de 0.5° pour les zones frontalières.
// ─────────────────────────────────────────────────────────────
const CONGO_BBOX = {
  latMin:  -5.1,   // Sud (frontière Angola)
  latMax:   3.8,   // Nord (frontière Cameroun / RCA)
  lngMin:  11.0,   // Ouest (frontière Gabon)
  lngMax:  18.7,   // Est (frontière RDC)
};

/**
 * Vérifie si des coordonnées GPS sont dans la bbox Congo.
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
function estDansCongo(lat, lng) {
  return (
    lat >= CONGO_BBOX.latMin && lat <= CONGO_BBOX.latMax &&
    lng >= CONGO_BBOX.lngMin && lng <= CONGO_BBOX.lngMax
  );
}

/**
 * Middleware : rejette les coordonnées GPS hors bbox Congo.
 * Utilisé sur les routes POST qui reçoivent { lat, lng }.
 */
function requireCongoCoordinates(req, res, next) {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return next(); // pas de coordonnées → laisser passer (validation en aval)
  }
  if (!estDansCongo(lat, lng)) {
    return res.status(422).json({
      error:   'coordonnees_hors_zone',
      message: `Coordonnées (${lat.toFixed(4)}, ${lng.toFixed(4)}) hors de la zone Congo autorisée.`,
      bbox:    CONGO_BBOX,
    });
  }
  next();
}

// ─────────────────────────────────────────────────────────────
// ROUTE : Vérification géographique de session
// GET /api/geo/session  (sans auth)
// Retourne { allowed: true } si l'IP semble être au Congo,
// { allowed: false } sinon. Non bloquant côté client.
// ─────────────────────────────────────────────────────────────
app.get('/api/geo/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // Sur Render, l'IP réelle est dans x-forwarded-for
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  // On retourne toujours allowed:true côté client (le contrôle réel est sur les routes GPS)
  res.json({ allowed: true, ip: ip || 'unknown', bbox: CONGO_BBOX });
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Ingestion de position GPS depuis l'app Android
// POST /api/agent/location
// Auth : Bearer token Firebase OU header x-ingest-key (clé API)
//
// Body: { agentId, lat, lng, timestamp?, speed?, accuracy? }
// ─────────────────────────────────────────────────────────────
app.post('/api/agent/location', requireCongoCoordinates, async (req, res) => {
  // Authentification : JWT Firebase ou clé d'ingestion
  const authHeader = req.headers.authorization || '';
  const ingestKey  = req.headers['x-ingest-key'] || '';

  let companyId = null;

  if (authHeader.startsWith('Bearer ')) {
    // Authentification Firebase Auth
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      companyId = decoded.uid;
    } catch {
      return res.status(401).json({ error: 'Token Firebase invalide' });
    }
  } else if (ingestKey && process.env.GPTS_LOCATION_INGEST_KEY && ingestKey === process.env.GPTS_LOCATION_INGEST_KEY) {
    // Clé d'ingestion statique (pour les appareils sans compte Firebase)
    companyId = req.body.companyId || null;
    if (!companyId) return res.status(400).json({ error: 'companyId requis avec la clé d\'ingestion' });
  } else {
    return res.status(401).json({ error: 'Authentification requise (Bearer token ou x-ingest-key)' });
  }

  const { agentId, lat, lng, timestamp, speed, accuracy } = req.body;

  if (!agentId || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'agentId, lat, lng requis' });
  }

  const ts = typeof timestamp === 'number' ? timestamp : Date.now();

  try {
    // Écriture sous societes/{companyId}/agents/{agentId}
    const prefix  = `societes/${companyId}/agents/${agentId}`;
    const updates = {
      [`${prefix}/lat`]:              lat,
      [`${prefix}/lng`]:              lng,
      [`${prefix}/lastUpdate`]:       ts,
      [`${prefix}/speed`]:            speed   ?? 0,
      [`${prefix}/accuracy`]:         accuracy ?? 0,
      [`${prefix}/history/${ts}`]:    { lat, lng, speed: speed ?? 0, accuracy: accuracy ?? 0 },
    };

    await db.ref().update(updates);
    res.json({ success: true, ts });
  } catch (err) {
    console.error('agent/location error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE : Téléchargement APK
// GET /download/GPTS-Tracker.apk
// ─────────────────────────────────────────────────────────────
app.get('/download/GPTS-Tracker.apk', (req, res) => {
  const apkPath = path.join(__dirname, 'download', 'GPTS-Tracker.apk');
  const fs = require('fs');

  if (!fs.existsSync(apkPath)) {
    return res.status(404).send(`
      <html><body style="font-family:sans-serif;background:#0f172a;color:#94a3b8;padding:40px;text-align:center">
        <h2 style="color:#38bdf8">APK non disponible</h2>
        <p>Le fichier GPTS-Tracker.apk n'a pas encore été déposé sur le serveur.</p>
        <p style="font-size:12px">Placez le fichier dans le dossier <code>download/</code> et redéployez.</p>
      </body></html>
    `);
  }

  res.setHeader('Content-Disposition', 'attachment; filename="GPTS-Tracker.apk"');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.sendFile(apkPath);
});

// ─────────────────────────────────────────────────────────────
// Health check — réveil Render + splash client
// GET /api/health  (sans auth)
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok:     true,
    uptime: process.uptime(),
    ts:     Date.now(),
  });
});

// [ADMIN SUPRÊME] — Route ping pour calculer la latence en temps réel
app.get('/api/ping', (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// [ADMIN SUPRÊME] — Route pour obtenir l'historique complet et les activations de licences
app.get('/api/admin/licences', requireSuperadmin, async (req, res) => {
  try {
    const snapshot = await firestore
      .collection('licences')
      .orderBy('date_creation', 'desc')
      .get();
      
    const licences = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      licences.push({
        ...data,
        date_creation: data.date_creation ? (data.date_creation.toDate ? data.date_creation.toDate().toISOString() : new Date(data.date_creation).toISOString()) : null,
        date_activation: data.date_activation ? (data.date_activation.toDate ? data.date_activation.toDate().toISOString() : new Date(data.date_activation).toISOString()) : null,
        date_expiration: data.date_expiration ? (data.date_expiration.toDate ? data.date_expiration.toDate().toISOString() : new Date(data.date_expiration).toISOString()) : null,
      });
    });
    
    res.json({ success: true, licences });
  } catch (err) {
    console.error('admin get licences error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des licences' });
  }
});

// [ADMIN SUPRÊME] — Route pour rechercher un compte par email, ID ou nom de société
app.get('/api/admin/accounts/search', requireSuperadmin, async (req, res) => {
  const query = (req.query.query || '').trim().toLowerCase();
  if (!query) {
    return res.status(400).json({ error: 'Paramètre "query" de recherche obligatoire' });
  }
  
  try {
    const companiesSnap = await db.ref('companies').get();
    if (!companiesSnap.exists()) {
      return res.json({ success: true, accounts: [] });
    }
    
    const accounts = [];
    const companies = companiesSnap.val();
    
    for (const uid of Object.keys(companies)) {
      const comp = companies[uid];
      const email = (comp.email || '').toLowerCase();
      const compName = (comp.companyName || comp.name || '').toLowerCase();
      
      if (uid.toLowerCase().includes(query) || email.includes(query) || compName.includes(query)) {
        accounts.push({
          uid,
          companyName: comp.companyName || comp.name || 'Sans Nom',
          email: comp.email || 'Pas d\'email',
          role: comp.role || 'company',
          validated: comp.validated || false,
          status: comp.status || 'active',
          createdAt: comp.createdAt || comp.date_creation || null,
        });
      }
    }
    
    res.json({ success: true, accounts });
  } catch (err) {
    console.error('admin search accounts error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la recherche de comptes' });
  }
});

// [ADMIN SUPRÊME] — Route pour récupérer TOUS les clients (companies)
app.get('/api/admin/clients', requireSuperadmin, async (req, res) => {
  try {
    const [companiesSnap, societesSnap] = await Promise.all([
      db.ref('companies').get(),
      db.ref('societes').get(),
    ]);

    const companies = companiesSnap.val() || {};
    const societes = societesSnap.val() || {};
    const clients = [];

    // Fusionner les données de societes (prioritaire pour email) + companies
    const allUids = new Set([...Object.keys(companies), ...Object.keys(societes)]);

    for (const uid of allUids) {
      const company = companies[uid] || {};
      const societe = societes[uid] || {};
      
      const profil = fusionnerProfilSociete(company, societe);

      clients.push({
        uid,
        companyName: profil.companyName || profil.name || 'Inconnu',
        email: profil.email || '—',
        role: profil.role || 'company',
        validated: profil.validated || false,
        typePack: profil.licence?.typePack || 'free',
        createdAt: profil.createdAt || profil.date_creation || null,
      });
    }

    res.json({ success: true, clients });
  } catch (err) {
    console.error('[ADMIN SUPRÊME] — Récupération tous les clients error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des clients' });
  }
});

// [ADMIN SUPRÊME] — Route pour valider un compte utilisateur (rôle partner / validé)
app.post('/api/admin/accounts/validate', requireSuperadmin, async (req, res) => {
  const { companyId } = req.body;
  if (!companyId) {
    return res.status(400).json({ error: 'Identifiant companyId obligatoire' });
  }
  
  try {
    const profil = await lireProfilSociete(companyId);
    if (profil.role === 'superadmin') {
      return res.status(400).json({ error: 'Impossible de modifier le rôle d\'un superadmin.' });
    }

    await Promise.all([
      db.ref(`companies/${companyId}`).update({ validated: true, role: 'partner' }),
      db.ref(`societes/${companyId}`).update({ validated: true, role: 'partner' })
    ]);
    
    console.log(`🔒 [ADMIN SUPRÊME] Compte validé : ${companyId}`);
    res.json({ success: true, message: 'Compte validé avec succès' });
  } catch (err) {
    console.error('admin validate account error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la validation' });
  }
});

// [ADMIN SUPRÊME] — Route pour révoquer la validation d'un compte utilisateur
app.post('/api/admin/accounts/revoke', requireSuperadmin, async (req, res) => {
  const { companyId } = req.body;
  if (!companyId) {
    return res.status(400).json({ error: 'Identifiant companyId obligatoire' });
  }
  
  try {
    const profil = await lireProfilSociete(companyId);
    if (profil.role === 'superadmin') {
      return res.status(400).json({ error: 'Impossible de modifier le rôle d\'un superadmin.' });
    }

    await Promise.all([
      db.ref(`companies/${companyId}`).update({ validated: false, role: 'company' }),
      db.ref(`societes/${companyId}`).update({ validated: false, role: 'company' })
    ]);
    
    console.log(`🔓 [ADMIN SUPRÊME] Validation révoquée : ${companyId}`);
    res.json({ success: true, message: 'Validation révoquée avec succès' });
  } catch (err) {
    console.error('admin revoke account error:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la révocation' });
  }
});


// ─────────────────────────────────────────────────────────────
// Fichiers statiques
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.use(express.static('.', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') && !filePath.endsWith('sw.js')) {
      // Cache court pour les fichiers JS dashboard — force le rechargement après déploiement
      if (filePath.includes('/dashboard/')) {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
    // Les fichiers HTML ne sont jamais mis en cache
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// Liens morts / routes inexistantes → page vitrine racine
app.use((req, res) => {
  res.status(404).redirect('/');
});

app.listen(PORT, () => {
  console.log(`GPS Tracker server running on port ${PORT}`);
});
