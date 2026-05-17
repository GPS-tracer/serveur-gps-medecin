/**
 * generateReport.js — Générateur de rapport d'activité PDF (A4, style corporate)
 *
 * Utilise PDFKit pour produire un document professionnel sans dépendance
 * à un navigateur headless (pas de Puppeteer, compatible Render Free Tier).
 *
 * Structure du document :
 *   1. En-tête  : logo société + informations générales
 *   2. Résumé   : tableau de statistiques (distance, vitesse, CO2 / assiduité)
 *   3. Tracé    : liste chronologique des points de passage
 *   4. Pied     : numérotation des pages (Page X sur Y)
 *
 * @module generateReport
 */

'use strict';

const PDFDocument = require('pdfkit');
const axios       = require('axios');

// ─────────────────────────────────────────────────────────────
// PALETTE CORPORATE (bleu nuit / gris)
// ─────────────────────────────────────────────────────────────
const C = {
  BLEU_NUIT:   '#0D1B2A',
  BLEU_MOYEN:  '#1B3A5C',
  BLEU_CLAIR:  '#2E6DA4',
  GRIS_FONCE:  '#4A4A4A',
  GRIS_MOYEN:  '#7A7A7A',
  GRIS_CLAIR:  '#E8ECF0',
  BLANC:       '#FFFFFF',
  VERT:        '#2E7D32',
  ORANGE:      '#E65100',
};

// ─────────────────────────────────────────────────────────────
// CONSTANTES CO2 (g/km selon type de véhicule)
// ─────────────────────────────────────────────────────────────
const CO2_PAR_KM = {
  moto:     72,
  voiture:  120,
  camion:   210,
  scolaire:   0,
};

// ─────────────────────────────────────────────────────────────
// CACHE GÉOCODAGE NOMINATIM
//
// Clé  : "lat4,lng4"  (coordonnées arrondies à 4 décimales,
//         ~11 m de précision — suffisant pour une adresse)
// Valeur : string adresse ou coordonnées brutes en fallback
//
// Le cache est en mémoire (Map) et persiste pendant toute la
// durée de vie du processus Node.js. Pour un usage intensif,
// remplacer par un cache Redis ou un fichier JSON.
// ─────────────────────────────────────────────────────────────
const _geocodeCache = new Map();

/**
 * Retourne la clé de cache normalisée pour une paire lat/lng.
 * Arrondir à 4 décimales évite les doublons pour des points
 * quasi-identiques (ex: 2 pings à 1 mètre d'écart).
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function _cacheKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Attendre N millisecondes (utilisé pour le rate-limiting).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// GÉOCODAGE INVERSE — avec cache + rate-limit + fallback
//
// Politique Nominatim (openstreetmap.org) :
//   - Max 1 requête/seconde
//   - User-Agent obligatoire et identifiable
//   - Pas d'usage commercial intensif sans hébergement propre
//
// Stratégie appliquée ici :
//   1. Vérifier le cache en mémoire → retour immédiat si hit
//   2. Attendre le délai inter-requêtes (NOMINATIM_DELAY_MS)
//   3. Appeler l'API avec timeout court (4 s)
//   4. En cas d'erreur (réseau, timeout, 429, 5xx) :
//      → retourner les coordonnées brutes "lat, lng"
//      → NE PAS lever d'exception (le rapport continue)
// ─────────────────────────────────────────────────────────────
const NOMINATIM_DELAY_MS = 1100; // 1,1 s entre chaque requête (marge de sécurité)
const NOMINATIM_TIMEOUT  = 4000; // timeout par requête
const NOMINATIM_UA       = 'GPS-Tracker-Report/1.0 (contact@gpstracker.app)';

/**
 * Géocode inverse un point GPS en adresse lisible.
 * Garanti de ne jamais lever d'exception : retourne toujours
 * une string (adresse ou coordonnées brutes en fallback).
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string>}
 */
async function geocodeInverse(lat, lng) {
  const coordsBrutes = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const key          = _cacheKey(lat, lng);

  // ── 1. Cache hit → retour immédiat, pas de requête réseau ──
  if (_geocodeCache.has(key)) {
    return _geocodeCache.get(key);
  }

  // ── 2. Appel Nominatim avec timeout et fallback ─────────────
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse` +
                 `?lat=${lat}&lon=${lng}&format=json&accept-language=fr`;

    const resp = await axios.get(url, {
      timeout: NOMINATIM_TIMEOUT,
      headers: { 'User-Agent': NOMINATIM_UA },
      // Pas de retry automatique — on gère le fallback nous-mêmes
      validateStatus: (status) => status === 200, // rejeter tout sauf 200
    });

    const a     = resp.data?.address || {};
    const parts = [
      a.neighbourhood || a.suburb || a.quarter || a.village || a.hamlet,
      a.city          || a.town   || a.municipality || a.county,
    ].filter(Boolean);

    const adresse = parts.length
      ? parts.join(', ')
      : (resp.data?.display_name?.split(',').slice(0, 2).join(',').trim() || coordsBrutes);

    // ── 3. Mettre en cache avant de retourner ──────────────────
    _geocodeCache.set(key, adresse);
    return adresse;

  } catch (err) {
    // Erreur réseau, timeout, 429 rate-limit, 5xx serveur…
    // → fallback silencieux sur les coordonnées brutes
    const raison = err.response?.status
      ? `HTTP ${err.response.status}`
      : err.code || err.message;
    console.warn(`⚠️ Nominatim échec (${coordsBrutes}): ${raison} — coordonnées brutes utilisées`);

    // Mettre en cache le fallback pour éviter de retenter
    // le même point défaillant dans le même rapport
    _geocodeCache.set(key, coordsBrutes);
    return coordsBrutes;
  }
}

/**
 * Géocode une liste de points en séquence avec délai entre chaque
 * requête (respect de la politique Nominatim 1 req/s).
 *
 * Les points déjà en cache sont retournés immédiatement sans délai.
 * Seuls les cache-miss déclenchent un appel réseau + délai.
 * Garanti de ne jamais lever d'exception.
 *
 * @param {Array<{ts: number, lat: number, lng: number}>} points
 * @returns {Promise<Array<{ts: number, adresse: string}>>}
 */
async function geocoderPoints(points) {
  const resultats = [];

  for (const pt of points) {
    const key      = _cacheKey(pt.lat, pt.lng);
    const estCache = _geocodeCache.has(key);

    // Délai uniquement si on va faire une vraie requête réseau
    if (!estCache) {
      await _sleep(NOMINATIM_DELAY_MS);
    }

    // geocodeInverse ne lève jamais d'exception — fallback intégré
    const adresse = await geocodeInverse(pt.lat, pt.lng);
    resultats.push({ ts: pt.ts, adresse });
  }

  return resultats;
}
/**
 * @param {string|null} url  URL publique ou signée Firebase Storage
 * @returns {Promise<Buffer|null>}
 */
async function telechargerImage(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout:      8000,
      headers:      { 'User-Agent': NOMINATIM_UA },
      validateStatus: (s) => s === 200,
    });
    return Buffer.from(response.data);
  } catch (err) {
    console.warn(`⚠️ Logo non chargé (${url}): ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// HELPER : Calculer les statistiques depuis l'historique RTDB
// ─────────────────────────────────────────────────────────────
/**
 * Calcule distance totale (km), vitesse moyenne (km/h) et
 * nombre de points à partir des entrées history triées.
 *
 * @param {Array<{ts: number, lat: number, lng: number}>} points
 * @returns {{ distanceKm: number, vitesseMoyenne: number, nbPoints: number }}
 */
function calculerStatistiques(points) {
  if (points.length < 2) {
    return { distanceKm: 0, vitesseMoyenne: 0, nbPoints: points.length };
  }

  let distanceTotaleM = 0;

  for (let i = 1; i < points.length; i++) {
    distanceTotaleM += distanceHaversine(
      points[i - 1].lat, points[i - 1].lng,
      points[i].lat,     points[i].lng
    );
  }

  const distanceKm   = distanceTotaleM / 1000;
  const dureeHeures  = (points[points.length - 1].ts - points[0].ts) / 3_600_000;
  const vitesseMoyenne = dureeHeures > 0 ? distanceKm / dureeHeures : 0;

  return {
    distanceKm:      Math.round(distanceKm * 10) / 10,
    vitesseMoyenne:  Math.round(vitesseMoyenne * 10) / 10,
    nbPoints:        points.length,
  };
}

/**
 * Formule de Haversine — distance en mètres entre deux coordonnées GPS.
 */
function distanceHaversine(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000; // rayon Terre en mètres
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─────────────────────────────────────────────────────────────
// HELPER : Formater un timestamp en heure lisible (HH:MM:SS)
// ─────────────────────────────────────────────────────────────
function formatHeure(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Africa/Brazzaville',
  });
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('fr-FR', {
    day:   '2-digit',
    month: 'long',
    year:  'numeric',
    timeZone: 'Africa/Brazzaville',
  });
}

// ─────────────────────────────────────────────────────────────
// HELPER : Dessiner une ligne de tableau
// ─────────────────────────────────────────────────────────────
function ligneTableau(doc, y, cols, isHeader = false, isAlternate = false) {
  const HAUTEUR_LIGNE = 22;
  const PADDING_X     = 8;

  // Fond de ligne
  if (isHeader) {
    doc.rect(cols[0].x, y, cols[cols.length - 1].x + cols[cols.length - 1].w - cols[0].x, HAUTEUR_LIGNE)
       .fill(C.BLEU_MOYEN);
  } else if (isAlternate) {
    doc.rect(cols[0].x, y, cols[cols.length - 1].x + cols[cols.length - 1].w - cols[0].x, HAUTEUR_LIGNE)
       .fill(C.GRIS_CLAIR);
  }

  // Texte de chaque cellule
  cols.forEach((col) => {
    doc
      .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(isHeader ? 9 : 9)
      .fillColor(isHeader ? C.BLANC : C.GRIS_FONCE)
      .text(String(col.value ?? ''), col.x + PADDING_X, y + 6, {
        width:  col.w - PADDING_X * 2,
        align:  col.align || 'left',
        lineBreak: false,
      });
  });

  return y + HAUTEUR_LIGNE;
}

// ─────────────────────────────────────────────────────────────
// HELPER : Ajouter un pied de page sur toutes les pages
// ─────────────────────────────────────────────────────────────
function ajouterPiedDePage(doc, totalPages) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);

    const pageNum = i + 1;
    const y       = doc.page.height - 35;

    // Ligne de séparation
    doc.moveTo(50, y - 8).lineTo(doc.page.width - 50, y - 8)
       .strokeColor(C.GRIS_CLAIR).lineWidth(0.5).stroke();

    // Texte gauche : nom du rapport
    doc.font('Helvetica').fontSize(7).fillColor(C.GRIS_MOYEN)
       .text('Rapport d\'activité GPS Tracker — Document confidentiel', 50, y, {
         width: 300, align: 'left',
       });

    // Texte droite : numérotation
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.BLEU_MOYEN)
       .text(`Page ${pageNum} sur ${totalPages}`, doc.page.width - 150, y, {
         width: 100, align: 'right',
       });
  }
}

// ─────────────────────────────────────────────────────────────
// FONCTION PRINCIPALE : genererRapportPDF
// ─────────────────────────────────────────────────────────────
/**
 * Génère un rapport PDF A4 et le retourne sous forme de Buffer.
 *
 * @param {object} params
 * @param {string}   params.companyName       Nom de la société
 * @param {string}   params.secteur           'moto' | 'voiture' | 'camion' | 'scolaire'
 * @param {string}   params.agentNom          Nom de l'agent ou de l'élève
 * @param {string}   params.agentId           Identifiant technique de l'agent
 * @param {string}   params.dateDebut         ISO string — début de la période
 * @param {string}   params.dateFin           ISO string — fin de la période
 * @param {string|null} params.logoUrl        URL du logo (Firebase Storage)
 * @param {Array<{ts:number, lat:number, lng:number}>} params.points
 *   Points de passage triés chronologiquement
 * @param {Array<{ts:number, adresse:string}>} [params.adresses]
 *   Adresses géocodées correspondant aux points (optionnel)
 *
 * @returns {Promise<Buffer>}  Buffer du PDF généré
 */
async function genererRapportPDF(params) {
  const {
    companyName  = 'Société',
    secteur      = 'voiture',
    agentNom     = 'Agent',
    agentId      = '',
    dateDebut,
    dateFin,
    logoUrl      = null,
    points       = [],
    adresses     = [],
  } = params;

  // ── 1. Pré-calculs ──────────────────────────────────────────
  const stats      = calculerStatistiques(points);
  const secteurKey = secteur.toLowerCase();
  const estScolaire = secteurKey === 'scolaire';

  // CO2 total en kg
  const co2Grammes = stats.distanceKm * (CO2_PAR_KM[secteurKey] || CO2_PAR_KM.voiture);
  const co2Kg      = (co2Grammes / 1000).toFixed(2);

  // Indicateur assiduité scolaire (% de présence sur la période)
  // Logique : 1 point = 1 présence enregistrée
  const nbJoursPeriode = Math.max(1, Math.ceil(
    (new Date(dateFin) - new Date(dateDebut)) / 86_400_000
  ));
  const tauxAssiduite = Math.min(100, Math.round((stats.nbPoints / nbJoursPeriode) * 100));

  // ── 2. Télécharger le logo ──────────────────────────────────
  const logoBuffer = await telechargerImage(logoUrl);

  // ── 3. Créer le document PDFKit ─────────────────────────────
  const doc = new PDFDocument({
    size:          'A4',
    margins:       { top: 0, bottom: 40, left: 0, right: 0 },
    bufferPages:   true,   // nécessaire pour la numérotation finale
    info: {
      Title:    `Rapport d'activité — ${agentNom}`,
      Author:   companyName,
      Subject:  `Période : ${formatDate(new Date(dateDebut))} → ${formatDate(new Date(dateFin))}`,
      Creator:  'GPS Tracker v1.0',
    },
  });

  // Collecter les chunks dans un Buffer
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  // ── 4. EN-TÊTE ──────────────────────────────────────────────
  const PAGE_W  = doc.page.width;   // 595.28 pt
  const MARGE   = 50;
  const CONTENU = PAGE_W - MARGE * 2;

  // Bande de fond bleu nuit
  doc.rect(0, 0, PAGE_W, 110).fill(C.BLEU_NUIT);

  // Logo (haut gauche, dans la bande)
  let logoX = MARGE;
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, logoX, 18, { height: 60, fit: [120, 60] });
      logoX += 135;
    } catch {
      // Logo corrompu → on ignore silencieusement
    }
  }

  // Nom de la société
  doc.font('Helvetica-Bold').fontSize(18).fillColor(C.BLANC)
     .text(companyName, logoX, 22, { width: PAGE_W - logoX - MARGE });

  // Sous-titre : type de rapport
  const secteurLabel = {
    moto:     '🏍  Rapport Moto / Livraison',
    voiture:  '🚗  Rapport Véhicule',
    camion:   '🚚  Rapport Utilitaire',
    scolaire: '🎓  Rapport Scolaire — Suivi d\'assiduité',
  }[secteurKey] || `Rapport — ${secteur}`;

  doc.font('Helvetica').fontSize(10).fillColor('#A8C4E0')
     .text(secteurLabel, logoX, 48, { width: PAGE_W - logoX - MARGE });

  // Date de génération (haut droite)
  doc.font('Helvetica').fontSize(8).fillColor('#A8C4E0')
     .text(`Généré le ${formatDate(Date.now())}`, MARGE, 90, {
       width: CONTENU, align: 'right',
     });

  // ── 5. BLOC INFORMATIONS GÉNÉRALES ──────────────────────────
  let curY = 130;

  // Titre de section
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.BLEU_NUIT)
     .text('INFORMATIONS GÉNÉRALES', MARGE, curY);

  // Ligne de séparation colorée
  curY += 16;
  doc.rect(MARGE, curY, CONTENU, 2).fill(C.BLEU_CLAIR);
  curY += 10;

  // Grille 2 colonnes
  const COL1_X = MARGE;
  const COL2_X = MARGE + CONTENU / 2 + 10;
  const COL_W  = CONTENU / 2 - 10;

  const infoItems = [
    { label: 'Agent / Élève suivi',  value: `${agentNom}${agentId ? ` (${agentId})` : ''}` },
    { label: 'Secteur d\'activité',  value: secteurLabel.replace(/^[^\s]+\s+/, '') },
    { label: 'Période — Début',      value: formatDate(new Date(dateDebut)) },
    { label: 'Période — Fin',        value: formatDate(new Date(dateFin)) },
  ];

  infoItems.forEach((item, idx) => {
    const x = idx % 2 === 0 ? COL1_X : COL2_X;
    const y = curY + Math.floor(idx / 2) * 32;

    doc.font('Helvetica').fontSize(8).fillColor(C.GRIS_MOYEN)
       .text(item.label.toUpperCase(), x, y);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.GRIS_FONCE)
       .text(item.value, x, y + 11, { width: COL_W });
  });

  curY += Math.ceil(infoItems.length / 2) * 32 + 20;

  // ── 6. TABLEAU STATISTIQUES ──────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.BLEU_NUIT)
     .text('RÉSUMÉ DES STATISTIQUES', MARGE, curY);

  curY += 16;
  doc.rect(MARGE, curY, CONTENU, 2).fill(C.BLEU_CLAIR);
  curY += 10;

  // Définition des colonnes du tableau
  const COLS_STATS = [
    { x: MARGE,       w: 220, label: 'Indicateur',  key: 'indicateur', align: 'left'  },
    { x: MARGE + 220, w: 130, label: 'Valeur',      key: 'valeur',     align: 'center' },
    { x: MARGE + 350, w: 145, label: 'Détail',      key: 'detail',     align: 'left'  },
  ];

  // En-tête du tableau
  curY = ligneTableau(doc, curY,
    COLS_STATS.map((c) => ({ ...c, value: c.label })),
    true
  );

  // Données statistiques
  const lignesStats = [
    {
      indicateur: 'Distance totale parcourue',
      valeur:     `${stats.distanceKm} km`,
      detail:     `${stats.nbPoints} points GPS enregistrés`,
    },
    {
      indicateur: 'Vitesse moyenne',
      valeur:     `${stats.vitesseMoyenne} km/h`,
      detail:     stats.vitesseMoyenne > 0
        ? (stats.vitesseMoyenne > 80 ? '⚠ Vitesse élevée' : 'Vitesse normale')
        : 'Données insuffisantes',
    },
    estScolaire
      ? {
          indicateur: 'Assiduité aux cours',
          valeur:     `${tauxAssiduite} %`,
          detail:     `${stats.nbPoints} présence(s) sur ${nbJoursPeriode} jour(s)`,
        }
      : {
          indicateur: `Bilan CO₂ (${secteurKey})`,
          valeur:     `${co2Kg} kg CO₂`,
          detail:     `${CO2_PAR_KM[secteurKey] || 120} g/km × ${stats.distanceKm} km`,
        },
  ];

  lignesStats.forEach((ligne, idx) => {
    curY = ligneTableau(doc, curY,
      COLS_STATS.map((c) => ({ ...c, value: ligne[c.key] })),
      false,
      idx % 2 === 1
    );
  });

  curY += 25;

  // ── 7. SECTION TRACÉ — POINTS DE PASSAGE ────────────────────
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.BLEU_NUIT)
     .text('TRACÉ CHRONOLOGIQUE DES POINTS DE PASSAGE', MARGE, curY);

  curY += 16;
  doc.rect(MARGE, curY, CONTENU, 2).fill(C.BLEU_CLAIR);
  curY += 10;

  if (points.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(C.GRIS_MOYEN)
       .text('Aucun point de passage enregistré pour cette période.', MARGE, curY);
    curY += 20;
  } else {
    // Colonnes du tableau de tracé
    const COLS_TRACE = [
      { x: MARGE,       w: 30,  label: '#',          key: 'num',      align: 'center' },
      { x: MARGE + 30,  w: 75,  label: 'Heure',      key: 'heure',    align: 'center' },
      { x: MARGE + 105, w: 175, label: 'Coordonnées', key: 'coords',  align: 'left'   },
      { x: MARGE + 280, w: 215, label: 'Lieu / Adresse', key: 'lieu', align: 'left'   },
    ];

    // En-tête
    curY = ligneTableau(doc, curY,
      COLS_TRACE.map((c) => ({ ...c, value: c.label })),
      true
    );

    // Construire un index adresses par timestamp pour lookup O(1)
    const adresseIndex = new Map(adresses.map((a) => [a.ts, a.adresse]));

    // Afficher tous les points (avec saut de page automatique)
    for (let i = 0; i < points.length; i++) {
      const pt     = points[i];
      const adresse = adresseIndex.get(pt.ts) || `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;

      // Saut de page si nécessaire (marge basse = 60pt)
      if (curY > doc.page.height - 60) {
        doc.addPage();
        curY = 50;

        // Répéter l'en-tête du tableau sur la nouvelle page
        curY = ligneTableau(doc, curY,
          COLS_TRACE.map((c) => ({ ...c, value: c.label })),
          true
        );
      }

      curY = ligneTableau(doc, curY,
        COLS_TRACE.map((c) => ({
          ...c,
          value: {
            num:    i + 1,
            heure:  formatHeure(pt.ts),
            coords: `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`,
            lieu:   adresse,
          }[c.key],
        })),
        false,
        i % 2 === 1
      );
    }
  }

  curY += 30;

  // ── 8. BLOC SIGNATURE / CERTIFICATION ───────────────────────
  // Vérifier si on a assez de place, sinon nouvelle page
  if (curY > doc.page.height - 120) {
    doc.addPage();
    curY = 50;
  }

  doc.rect(MARGE, curY, CONTENU, 80).fill(C.GRIS_CLAIR).stroke();

  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.BLEU_NUIT)
     .text('CERTIFICATION', MARGE + 15, curY + 12);

  doc.font('Helvetica').fontSize(8).fillColor(C.GRIS_FONCE)
     .text(
       `Ce document certifie que les données de localisation de ${agentNom} ont été enregistrées ` +
       `automatiquement par le système GPS Tracker de ${companyName} du ${formatDate(new Date(dateDebut))} ` +
       `au ${formatDate(new Date(dateFin))}. Ce rapport constitue une preuve de travail officielle.`,
       MARGE + 15, curY + 26,
       { width: CONTENU - 30 }
     );

  // Zone signature
  doc.font('Helvetica').fontSize(8).fillColor(C.GRIS_MOYEN)
     .text('Signature & Cachet :', MARGE + CONTENU - 160, curY + 12, { width: 145, align: 'left' });
  doc.rect(MARGE + CONTENU - 160, curY + 24, 145, 45).stroke(C.GRIS_MOYEN);

  // ── 9. PIED DE PAGE (toutes les pages) ──────────────────────
  doc.flushPages();
  const totalPages = doc.bufferedPageRange().count;
  ajouterPiedDePage(doc, totalPages);

  // ── 10. Finaliser et retourner le Buffer ─────────────────────
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

module.exports = { genererRapportPDF, geocoderPoints };
