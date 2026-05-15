const express = require('express');
const path    = require('path');
const admin   = require('firebase-admin');

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

const db = admin.database();

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
// CONSTANTES FREEMIUM
// ─────────────────────────────────────────────────────────────
const FREEMIUM = {
  MAX_AGENTS_FREE:        10,   // blocage au-delà de 10 agents
  WARN_AGENTS_THRESHOLD:   8,   // avertissement préventif à partir de 8
  FREE_REPORTS_PER_DAY:    1,   // 1 impression gratuite/jour
  PACK_PRICES: {
    '20':       590,    // FCFA (frais Chariow inclus)
    '40':       1180,   // FCFA (frais Chariow inclus)
    'illimite': 23550,  // FCFA (frais Chariow inclus)
  },
};

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
    const snap = await db.ref(`companies/${companyId}`).get();
    const company = snap.val() || {};

    const licence      = company.licence      || {};
    const typePack     = licence.typePack     || 'free';
    const rapportsRestants = licence.rapportsRestants ?? 0;
    const isIllimite   = typePack === 'illimite';

    // Compter les agents actifs
    const agentsSnap = await db.ref('agents').orderByChild('companyId').equalTo(companyId).get();
    const agentCount = agentsSnap.exists() ? Object.keys(agentsSnap.val()).length : 0;

    // Vérifier les impressions gratuites du jour
    const today          = todayKey();
    const dailyUsage     = company.dailyReports?.[today] || 0;
    const freeRemaining  = Math.max(0, FREEMIUM.FREE_REPORTS_PER_DAY - dailyUsage);

    res.json({
      typePack,
      isIllimite,
      rapportsRestants: isIllimite ? Infinity : rapportsRestants,
      agentCount,
      agentLimitReached: !isIllimite && agentCount >= FREEMIUM.MAX_AGENTS_FREE,
      maxAgentsFree: FREEMIUM.MAX_AGENTS_FREE,
      freeReportsRemainingToday: freeRemaining,
      canPrint: isIllimite || rapportsRestants > 0 || freeRemaining > 0,
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
// ─────────────────────────────────────────────────────────────
app.post('/api/licence/activate', requireAuth, async (req, res) => {
  const companyId  = req.user.uid;
  const { licenceKey } = req.body;

  if (!licenceKey || typeof licenceKey !== 'string') {
    return res.status(400).json({ error: 'Clé de licence requise' });
  }

  // Normaliser : majuscules, retirer espaces
  const key = licenceKey.toUpperCase().replace(/\s/g, '');

  try {
    const licenceRef  = db.ref(`licences_gps/${key}`);
    const licenceSnap = await licenceRef.get();

    // 1. La clé existe-t-elle ?
    if (!licenceSnap.exists()) {
      return res.status(404).json({ error: 'Clé de licence invalide' });
    }

    const licence = licenceSnap.val();

    // 2. Déjà utilisée ? (vérification rapide avant transaction)
    if (licence.statut === 'utilisé') {
      return res.status(409).json({
        error: 'Cette clé a déjà été utilisée',
        dateActivation: licence.dateActivation,
      });
    }

    // 3. Verrouillage anti-double-usage via transaction Firebase
    //    On marque la clé "utilisé" EN PREMIER de façon atomique.
    //    Si deux requêtes arrivent simultanément, une seule réussira.
    let alreadyUsed = false;
    await licenceRef.transaction((current) => {
      if (!current) return current; // nœud supprimé entre-temps
      if (current.statut === 'utilisé') {
        alreadyUsed = true;
        return; // abort la transaction (retourne undefined)
      }
      // Marquer immédiatement comme utilisé
      return { ...current, statut: 'utilisé', dateActivation: new Date().toISOString(), activatedBy: companyId };
    });

    if (alreadyUsed) {
      return res.status(409).json({
        error: 'Cette clé a déjà été utilisée (double soumission détectée)',
      });
    }

    // 4. Créditer le compte (la clé est déjà verrouillée)
    const typePack = licence.typePack; // '20', '40', 'illimite'
    const companyRef = db.ref(`companies/${companyId}/licence`);
    const companySnap = await companyRef.get();
    const currentLicence = companySnap.val() || {};

    let newRapportsRestants;
    let newTypePack;

    if (typePack === 'illimite') {
      newTypePack          = 'illimite';
      newRapportsRestants  = null; // illimité
    } else {
      const credits = parseInt(typePack, 10); // 20 ou 40
      const existing = currentLicence.rapportsRestants || 0;
      newRapportsRestants = existing + credits;
      // Conserver illimité si déjà illimité
      newTypePack = currentLicence.typePack === 'illimite' ? 'illimite' : typePack;
    }

    const now = new Date().toISOString();

    // Créditer la société + historique (la clé est déjà marquée par la transaction)
    await Promise.all([
      companyRef.update({
        typePack:           newTypePack,
        rapportsRestants:   newRapportsRestants,
        lastActivation:     now,
        lastLicenceKey:     key,
      }),
      db.ref(`companies/${companyId}/licenceHistory`).push({
        key,
        typePack,
        activatedAt: now,
        credits: typePack === 'illimite' ? 'illimite' : parseInt(typePack, 10),
      }),
    ]);

    console.log(`✅ Licence activée: ${key} → société ${companyId} (+${typePack} rapports)`);

    res.json({
      success:           true,
      typePack,
      rapportsCredites:  typePack === 'illimite' ? 'illimite' : parseInt(typePack, 10),
      rapportsRestants:  newRapportsRestants,
      message:           typePack === 'illimite'
        ? 'Pack illimité activé avec succès !'
        : `${typePack} rapports crédités sur votre compte.`,
    });

  } catch (err) {
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
    const companyRef  = db.ref(`companies/${companyId}`);
    const companySnap = await companyRef.get();
    const company     = companySnap.val() || {};
    const licence     = company.licence || {};
    const typePack    = licence.typePack || 'free';
    const today       = todayKey();
    const dailyUsage  = company.dailyReports?.[today] || 0;

    // Pack illimité → toujours OK
    if (typePack === 'illimite') {
      await companyRef.child(`dailyReports/${today}`).set(dailyUsage + 1);
      return res.json({ success: true, source: 'illimite' });
    }

    // Rapports payants restants ?
    const rapportsRestants = licence.rapportsRestants || 0;
    if (rapportsRestants > 0) {
      await Promise.all([
        companyRef.child('licence/rapportsRestants').set(rapportsRestants - 1),
        companyRef.child(`dailyReports/${today}`).set(dailyUsage + 1),
      ]);
      return res.json({
        success:           true,
        source:            'pack',
        rapportsRestants:  rapportsRestants - 1,
      });
    }

    // Impression gratuite du jour ?
    if (dailyUsage < FREEMIUM.FREE_REPORTS_PER_DAY) {
      await companyRef.child(`dailyReports/${today}`).set(dailyUsage + 1);
      return res.json({
        success:                    true,
        source:                     'gratuit',
        freeReportsRemainingToday:  0,
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
// ─────────────────────────────────────────────────────────────
app.get('/api/agents/check-limit/:companyId', requireAuth, async (req, res) => {
  const { companyId } = req.params;
  if (req.user.uid !== companyId) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  try {
    const companySnap = await db.ref(`companies/${companyId}/licence`).get();
    const licence     = companySnap.val() || {};
    const typePack    = licence.typePack || 'free';

    // Pack illimité → pas de limite
    if (typePack === 'illimite') {
      return res.json({ allowed: true, typePack });
    }

    // Compter les agents
    const agentsSnap = await db.ref('agents').orderByChild('companyId').equalTo(companyId).get();
    const count      = agentsSnap.exists() ? Object.keys(agentsSnap.val()).length : 0;

    if (count >= FREEMIUM.MAX_AGENTS_FREE) {
      return res.json({
        allowed:    false,
        count,
        max:        FREEMIUM.MAX_AGENTS_FREE,
        message:    `Limite de ${FREEMIUM.MAX_AGENTS_FREE} agents atteinte. Passez au pack illimité (23 550 FCFA).`,
        upgradeUrl: '/dashboard/licence.html',
      });
    }

    // Avertissement préventif (8 ou 9 agents)
    const warning = count >= FREEMIUM.WARN_AGENTS_THRESHOLD
      ? `⚠️ Il ne vous reste que ${FREEMIUM.MAX_AGENTS_FREE - count} place(s) gratuite(s). Passez à l'illimité avant d'être bloqué.`
      : null;

    res.json({ allowed: true, count, max: FREEMIUM.MAX_AGENTS_FREE, typePack, warning });
  } catch (err) {
    console.error('check-limit error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE ADMIN : Créer une clé de licence (usage interne)
// POST /api/admin/licence/create
// Header: x-admin-secret: <ADMIN_SECRET>
// Body: { typePack: "20" | "40" | "illimite" }
// ─────────────────────────────────────────────────────────────
app.post('/api/admin/licence/create', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const { typePack } = req.body;
  if (!['20', '40', 'illimite'].includes(typePack)) {
    return res.status(400).json({ error: 'typePack invalide (20, 40 ou illimite)' });
  }

  try {
    const key = generateLicenceKey();
    await db.ref(`licences_gps/${key}`).set({
      cle_licence:    key,
      typePack,
      statut:         'disponible',
      dateCreation:   new Date().toISOString(),
      dateActivation: null,
      activatedBy:    null,
      prix_fcfa:      FREEMIUM.PACK_PRICES[typePack],
    });

    console.log(`🔑 Clé créée: ${key} (${typePack})`);
    res.json({ success: true, key, typePack, prix_fcfa: FREEMIUM.PACK_PRICES[typePack] });
  } catch (err) {
    console.error('create licence error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

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
