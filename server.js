const express  = require('express');
const path     = require('path');
const admin    = require('firebase-admin');
const cron     = require('node-cron');

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
  serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

// ─────────────────────────────────────────────────────────────
// CONSTANTES FREEMIUM & ABONNEMENTS
// ─────────────────────────────────────────────────────────────
const FREEMIUM = {
  MAX_AGENTS_FREE:        10,   // blocage au-delà de 10 agents (plan gratuit)
  WARN_AGENTS_THRESHOLD:   8,   // avertissement préventif à partir de 8
  FREE_REPORTS_PER_DAY:    1,   // 1 impression gratuite/jour
  PACK_PRICES: {
    pack_20:              590,   // FCFA frais Chariow inclus (net ~490)
    pack_40:             1180,   // FCFA frais Chariow inclus (net ~1 000)
    illimite:           23550,   // FCFA frais Chariow inclus (net 20 000)
    abonnement_flotte:  26010,   // FCFA frais Chariow inclus (net 25 000 / mois)
    abonnement_unite:   31192,   // FCFA frais Chariow inclus (net 30 000 / agent / mois)
    suivi_eleve:          311,   // FCFA frais Chariow inclus (net ~200 / élève / mois)
    suivi_etudiant:      1047,   // FCFA frais Chariow inclus (net ~900 / étudiant / mois)
  },
  // Durée d'un abonnement mensuel en millisecondes
  ABONNEMENT_DUREE_MS: 30 * 24 * 60 * 60 * 1000, // 30 jours
};

// Types de packs valides (utilisés dans plusieurs routes)
const TYPES_PACKS_VALIDES = [
  'pack_20', 'pack_40', 'illimite',
  'abonnement_flotte', 'abonnement_unite',
  'suivi_eleve',      // abonnement suivi scolaire élève    — 311 FCFA/mois
  'suivi_etudiant',   // abonnement suivi scolaire étudiant — 1 047 FCFA/mois
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
 * │ typePack            │ Rapports │ Agents max   │ Notes                    │
 * ├─────────────────────┼──────────┼──────────────┼──────────────────────────┤
 * │ free                │ 1/jour   │ 10           │ Freemium                 │
 * │ pack_20 / pack_40   │ solde    │ 10           │ Crédits ponctuels        │
 * │ illimite            │ ∞        │ ∞            │ Pack permanent           │
 * │ abonnement_flotte   │ ∞        │ ∞            │ Mensuel B2B              │
 * │ abonnement_unite    │ ∞        │ quantite     │ Mensuel B2B par agent    │
 * │ suivi_eleve         │ ∞        │ quantite     │ 311 FCFA/mois — élève    │
 * │ suivi_etudiant      │ ∞        │ quantite     │ 1 047 FCFA/mois — étud.  │
 * └─────────────────────┴──────────┴──────────────┴──────────────────────────┘
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
  const snap    = await db.ref(`companies/${companyId}/licence`).get();
  const licence = snap.val() || {};

  const typePack         = licence.typePack         || 'free';
  const estIllimite      = licence.est_illimite === true || typePack === 'illimite';
  const abonnementActif  = licence.abonnement_actif === true;
  const typeAbonnement   = licence.type_abonnement  || null;
  const dateExpiration   = licence.date_expiration  || null;
  const quantiteAgents   = licence.quantite_agents  || 1;
  const rapportsRestants = licence.rapportsRestants ?? 0;

  // Vérifier la validité temporelle de l'abonnement
  let abonnementValide = false;
  if (abonnementActif && dateExpiration) {
    abonnementValide = new Date(dateExpiration).getTime() > Date.now();
  }

  // ── Suivi scolaire ──────────────────────────────────────────
  // Un compte parent avec suivi_eleve ou suivi_etudiant actif peut
  // générer des rapports d'assiduité pour les élèves/étudiants liés.
  const estSuiviScolaire = abonnementValide && TYPES_SCOLAIRES.includes(typeAbonnement);

  // Charger les élèves liés (uniquement si suivi scolaire actif)
  let elevesLies = [];
  if (estSuiviScolaire) {
    const elevesSnap = await db.ref(`companies/${companyId}/eleves_lies`).get();
    if (elevesSnap.exists()) {
      elevesLies = Object.keys(elevesSnap.val());
    }
  }

  // ── Calcul de la limite d'agents effective ──────────────────
  let maxAgents = FREEMIUM.MAX_AGENTS_FREE; // défaut freemium : 10

  if (estIllimite || (abonnementValide && typeAbonnement === 'abonnement_flotte')) {
    maxAgents = Infinity;
  } else if (abonnementValide && typeAbonnement === 'abonnement_unite') {
    maxAgents = quantiteAgents;
  } else if (estSuiviScolaire) {
    // Le compte parent peut suivre autant d'élèves/étudiants que sa quantite_agents
    maxAgents = quantiteAgents;
  }

  return {
    typePack,
    estIllimite:      estIllimite || (abonnementValide && typeAbonnement === 'abonnement_flotte'),
    abonnementActif:  abonnementValide,
    typeAbonnement,
    maxAgents,
    rapportsRestants,
    dateExpiration,
    quantiteAgents,
    estSuiviScolaire,
    elevesLies,
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
  await db.ref(`companies/${companyId}/licence`).update({
    abonnement_actif: false,
    type_abonnement:  null,
    est_illimite:     false,
    quantite_agents:  null,
    // Conserver les crédits payants restants (pack_20 / pack_40)
    // Ne PAS modifier : eleves_lies, rapportsRestants
  });
  console.log(`🔒 Freemium restreint appliqué → société ${companyId}`);
}

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
    const quota              = company.freemium_quota || {};
    const derniereImpression = quota.derniere_impression || null;
    const compteurJours      = quota.compteur_jours      || 0;
    // Réinitialisation automatique si nouveau jour
    const quotaActuel        = derniereImpression === today ? compteurJours : 0;
    const freeRemaining      = Math.max(0, FREEMIUM.FREE_REPORTS_PER_DAY - quotaActuel);
    const agentCount = agentsSnap.exists() ? Object.keys(agentsSnap.val()).length : 0;

    // Rapports disponibles : illimité si abonnement flotte ou pack illimité
    const rapportsIllimites = droits.estIllimite ||
      (droits.abonnementActif && droits.typeAbonnement === 'abonnement_flotte') ||
      (droits.abonnementActif && droits.typeAbonnement === 'abonnement_unite');

    res.json({
      typePack:               droits.typePack,
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
      canPrint: rapportsIllimites || droits.rapportsRestants > 0 || freeRemaining > 0,
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

  try {
    const licenceRef = firestore.collection('licences').doc(key);

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
    const companyRef     = db.ref(`companies/${companyId}/licence`);
    const companySnap    = await companyRef.get();
    const currentLicence = companySnap.val() || {};

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

    // Écriture RTDB + historique en parallèle
    await Promise.all([
      companyRef.update(updateRTDB),
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
    res.status(500).json({ error: 'Erreur serveur lors de l\'activation' });
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
    const [droits, agentsSnap] = await Promise.all([
      resoudreDroits(companyId),
      db.ref(`societes/${companyId}/agents`).get(),
    ]);

    const count = agentsSnap.exists() ? Object.keys(agentsSnap.val()).length : 0;

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

    const maxAgents = droits.maxAgents; // dynamique selon le type de droits

    // ── Étape B : Limite atteinte ──────────────────────────────
    if (count >= maxAgents) {
      // Message exact selon le type de restriction (textes officiels)
      let message;
      if (droits.abonnementActif && droits.typeAbonnement === 'abonnement_unite') {
        // Abonnement à l'unité : injecter la quantité dynamique
        message = `Limite atteinte. Vous avez atteint le nombre maximal d'agents inclus dans votre abonnement actuel (${droits.quantiteAgents} agents). Veuillez ajuster votre quantité sur Chariow ou passer au Forfait Flotte Illimitée pour ajouter de nouveaux agents.`;
      } else {
        // Plan gratuit (freemium)
        message = `Limite atteinte. La version gratuite est limitée à 10 agents maximum. Veuillez passer à nos offres d'abonnements pour gérer plus d'agents (Tarif à l'Unité ou Forfait Flotte).`;
      }
      return res.json({
        allowed:         false,
        count,
        max:             maxAgents,
        typePack:        droits.typePack,
        typeAbonnement:  droits.typeAbonnement,
        quantiteAgents:  droits.quantiteAgents,
        abonnementActif: droits.abonnementActif,
        message,
        upgradeUrl:      '/dashboard/licence.html',
      });
    }

    // ── Étape C : Avertissement préventif ─────────────────────
    // Seuil à 80% de la limite ou à partir de 8 pour le freemium
    const seuilAvertissement = maxAgents <= FREEMIUM.MAX_AGENTS_FREE
      ? FREEMIUM.WARN_AGENTS_THRESHOLD
      : Math.floor(maxAgents * 0.8);

    const warning = count >= seuilAvertissement
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
app.post('/api/admin/licence/import', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

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
    }

    if (results.created.length > 0) {
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
app.post('/api/admin/licence/generate', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

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
// ROUTE WEBHOOK : Chariow Pulse (automatisation post-paiement)
// POST /api/webhook/chariow-pulse
// Header: x-chariow-secret: <CHARIOW_WEBHOOK_SECRET>
//
// Payload Chariow attendu (exemple) :
// {
//   "order_id": "ORD-123",
//   "customer_email": "client@example.com",
//   "product": { "name": "Forfait Flotte GPS", "id": "prd_xxx" },
//   "quantity": 14,          ← nombre d'agents pour abonnement_unite
//   "licence_key": "ABCD-EFGH-IJKL-MNOP",
//   "status": "paid"
// }
// ─────────────────────────────────────────────────────────────
app.post('/api/webhook/chariow-pulse', async (req, res) => {
  // Vérification du secret webhook Chariow
  const secret = req.headers['x-chariow-secret'];
  if (!secret || secret !== process.env.CHARIOW_WEBHOOK_SECRET) {
    console.warn('⚠️ Webhook Chariow : secret invalide');
    return res.status(403).json({ error: 'Secret webhook invalide' });
  }

  const payload = req.body;

  // Vérifier que le paiement est bien confirmé
  if (payload.status !== 'paid') {
    console.log(`ℹ️ Webhook Chariow ignoré (statut: ${payload.status})`);
    return res.json({ ignored: true, reason: `statut non payé: ${payload.status}` });
  }

  // ── Détecter le type de produit à partir du nom ────────────
  const productName = (payload.product?.name || payload.product_name || '').toLowerCase();
  let type_pack;
  let quantite_agents = 1;

  if (productName.includes('flotte')) {
    // Forfait Flotte : illimité total
    type_pack = 'abonnement_flotte';

  } else if (productName.includes('scolaire') || productName.includes('eleve') || productName.includes('élève')) {
    // Suivi élève scolaire — 311 FCFA/mois
    type_pack       = 'suivi_eleve';
    quantite_agents = parseInt(payload.quantity || payload.product?.quantity || 1, 10);
    if (!Number.isFinite(quantite_agents) || quantite_agents < 1) quantite_agents = 1;

  } else if (productName.includes('etudiant') || productName.includes('étudiant') || productName.includes('universite') || productName.includes('université')) {
    // Suivi étudiant — 1 047 FCFA/mois
    type_pack       = 'suivi_etudiant';
    quantite_agents = parseInt(payload.quantity || payload.product?.quantity || 1, 10);
    if (!Number.isFinite(quantite_agents) || quantite_agents < 1) quantite_agents = 1;

  } else if (productName.includes('agent') || productName.includes('unité') || productName.includes('unite')) {
    // Tarif à l'Unité : quantité extraite du payload
    type_pack       = 'abonnement_unite';
    quantite_agents = parseInt(payload.quantity || payload.product?.quantity || 1, 10);
    if (!Number.isFinite(quantite_agents) || quantite_agents < 1) quantite_agents = 1;

  } else if (productName.includes('illimité') || productName.includes('illimite')) {
    type_pack = 'illimite';

  } else if (productName.includes('pro') || productName.includes('40')) {
    type_pack = 'pack_40';

  } else if (productName.includes('starter') || productName.includes('20')) {
    type_pack = 'pack_20';

  } else {
    // Produit non reconnu — on log et on répond 200 pour éviter les retries Chariow
    console.warn(`⚠️ Webhook Chariow : produit non reconnu → "${productName}"`);
    return res.json({ ignored: true, reason: `produit non reconnu: ${productName}` });
  }

  // ── Normaliser la clé de licence fournie par Chariow ──────
  const rawKey    = payload.licence_key || payload.licenceKey || '';
  const alphaOnly = rawKey.toUpperCase().replace(/[\s-]/g, '');

  if (alphaOnly.length !== 16 || !/^[A-Z0-9]{16}$/.test(alphaOnly)) {
    console.error(`❌ Webhook Chariow : clé invalide → "${rawKey}"`);
    return res.status(400).json({ error: 'Clé de licence invalide dans le payload' });
  }

  const key = (alphaOnly.match(/.{1,4}/g) || []).join('-');

  try {
    // Vérifier si la clé existe déjà (idempotence — Chariow peut renvoyer le webhook)
    const docRef = firestore.collection('licences').doc(key);
    const snap   = await docRef.get();

    if (snap.exists) {
      console.log(`ℹ️ Webhook Chariow : clé ${key} déjà enregistrée — ignorée`);
      return res.json({ success: true, key, already_exists: true });
    }

    // Créer le document de licence dans Firestore
    const now = admin.firestore.Timestamp.now();
    await docRef.set({
      cle_licence:       key,
      type_pack,
      statut:            'disponible',
      statut_abonnement: TYPES_ABONNEMENTS.includes(type_pack) ? 'inactif' : null,
      quantite_agents:   type_pack === 'abonnement_unite' ? quantite_agents : null,
      date_creation:     now,
      utilise_par:       null,
      date_activation:   null,
      date_expiration:   null,
      // Métadonnées Chariow pour traçabilité
      chariow_order_id:  payload.order_id    || null,
      customer_email:    payload.customer_email || null,
    });

    console.log(`✅ Webhook Chariow : clé ${key} créée (${type_pack}, ${quantite_agents} agent(s))`);
    res.json({ success: true, key, type_pack, quantite_agents });

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

  try {
    // Requête Firestore : abonnements actifs dont la date d'expiration est passée
    const snapshot = await firestore
      .collection('licences')
      .where('statut_abonnement', '==', 'actif')
      .where('date_expiration', '<', admin.firestore.Timestamp.fromDate(maintenant))
      .get();

    if (snapshot.empty) {
      console.log('✅ Cron : aucun abonnement expiré trouvé.');
      return { traites: 0, erreurs: 0 };
    }

    console.log(`⚠️ Cron : ${snapshot.size} abonnement(s) expiré(s) à traiter.`);

    // Traiter chaque abonnement expiré
    for (const doc of snapshot.docs) {
      const data      = doc.data();
      const companyId = data.utilise_par;

      try {
        // 1. Marquer l'abonnement comme expiré dans Firestore
        await doc.ref.update({ statut_abonnement: 'expire' });

        // 2. Réappliquer le mode Freemium restreint dans le RTDB
        if (companyId) {
          await appliquerFreemiumRestreint(companyId);

          // 3. Enregistrer une notification de relance dans le RTDB
          //    (le dashboard peut lire ce nœud pour afficher une bannière)
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
app.post('/api/admin/cron/check-expirations', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

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

    // Abonnement mensuel actif (flotte ou unité) ou pack illimité permanent
    const aAbonnementActif = droits.abonnementActif &&
      (droits.typeAbonnement === 'abonnement_flotte' ||
       droits.typeAbonnement === 'abonnement_unite');
    const aPackIllimite = droits.typePack === 'illimite' || droits.estIllimite;
    const rapportsIllimites = aAbonnementActif || aPackIllimite;

    // Pack crédits (pack_20 / pack_40) avec solde restant
    const aSoldePayant = !rapportsIllimites && (droits.rapportsRestants > 0);

    if (!rapportsIllimites && !aSoldePayant) {
      // ── Quota freemium : 1 impression gratuite par jour ─────────
      // Stocké dans companies/{id}/freemium_quota :
      //   derniere_impression : "YYYY-MM-DD"
      //   compteur_jours      : number
      const quota              = company.freemium_quota || {};
      const derniereImpression = quota.derniere_impression || null;
      const compteurJours      = quota.compteur_jours      || 0;

      // Réinitialisation automatique si nouveau jour
      const quotaActuel = derniereImpression === today ? compteurJours : 0;

      if (quotaActuel >= FREEMIUM.FREE_REPORTS_PER_DAY) {
        // Quota épuisé → message exact avec tarifs Chariow officiels
        return res.status(402).json({
          error:    'quota_epuise',
          message:  [
            'Vous avez épuisé votre impression gratuite pour aujourd\'hui.',
            'Pour débloquer ce rapport immédiatement ou faire évoluer votre compte,',
            'choisissez l\'une de nos offres via Mobile Money :',
            '• Pack 20 rapports : 590 FCFA (Paiement unique)',
            '• Pack 40 rapports : 1 180 FCFA (Paiement unique)',
            '• Abonnement par Agent : 31 192 FCFA / mois par agent (Suivi dédié)',
            '• Forfait Flotte Illimitée : 26 010 FCFA / mois (Rapports & Agents illimités)',
          ].join('\n'),
          // Données structurées pour l'affichage HTML côté client
          offres: [
            { label: 'Pack 20 rapports',          prix: '590 FCFA',        type: 'pack_20',            url: 'https://erpbbfef.mychariow.shop/prd_59udmg' },
            { label: 'Pack 40 rapports',          prix: '1 180 FCFA',      type: 'pack_40',            url: 'https://erpbbfef.mychariow.shop/prd_ia4imm' },
            { label: 'Abonnement par Agent',      prix: '31 192 FCFA/mois', type: 'abonnement_unite',  url: 'https://erpbbfef.mychariow.shop/prd_unite'  },
            { label: 'Forfait Flotte Illimitée',  prix: '26 010 FCFA/mois', type: 'abonnement_flotte', url: 'https://erpbbfef.mychariow.shop/prd_flotte' },
          ],
          canBuy: true,
        });
      }
      // Quota disponible → on laisse passer, la consommation se fera après génération
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
      // Freemium : consommer l'impression gratuite du jour
      // Mise à jour atomique de freemium_quota (derniere_impression + compteur_jours)
      await companyRef.child('freemium_quota').transaction((quota) => {
        const q = quota || {};
        const memeJour = q.derniere_impression === today;
        return {
          derniere_impression: today,
          compteur_jours:      memeJour ? (q.compteur_jours || 0) + 1 : 1,
        };
      });
      console.log(`📊 Impression gratuite consommée → société ${companyId}`);
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
app.get('/api/admin/stats', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

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
app.post('/api/admin/notifications/expiration', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

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

app.post('/api/geofencing/:companyId', requireAuth, async (req, res) => {
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

      // Détecter les transitions
      if (estDedans && !etaitDedans && zone.alertOnEnter) {
        alertes.push({ zoneId, zoneName: zone.name, type: 'entree', distanceMetres: Math.round(dist) });
      } else if (!estDedans && etaitDedans && zone.alertOnExit) {
        alertes.push({ zoneId, zoneName: zone.name, type: 'sortie', distanceMetres: Math.round(dist) });
      }

      // Mettre à jour l'état dans le RTDB
      await db.ref(`societes/${companyId}/agents/${agentId}/geofenceStates/${zoneId}`).set({
        dedans:    estDedans,
        updatedAt: Date.now(),
      });

      // Créer une notification RTDB si alerte
      if (alertes.length > 0) {
        const derniere = alertes[alertes.length - 1];
        await db.ref(`companies/${companyId}/notifications`).push({
          type:      `geofence_${derniere.type}`,
          agentId,
          agentNom:  agent.name || agentId,
          zoneId,
          zoneName:  zone.name,
          message:   `${agent.name || agentId} ${derniere.type === 'entree' ? 'est entré dans' : 'a quitté'} la zone "${zone.name}"`,
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
// Fichiers statiques
// ─────────────────────────────────────────────────────────────
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

app.use(express.static('.', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') && !filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

app.listen(PORT, () => {
  console.log(`GPS Tracker server running on port ${PORT}`);
});
