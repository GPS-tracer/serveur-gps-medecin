/**
 * notifications/paiement.js — Alertes temps réel SuperAdmin après paiement Chariow
 *
 * Canaux supportés :
 *  - Telegram Bot (recommandé — simple, gratuit, instantané)
 *  - Email via Brevo (fallback)
 *
 * Variables d'environnement requises :
 *  - TELEGRAM_BOT_TOKEN   : token du bot (obtenu via @BotFather)
 *  - TELEGRAM_CHAT_ID     : ID du chat/groupe SuperAdmin (obtenu via @userinfobot)
 *  - SUPERADMIN_EMAIL     : email de secours si Telegram échoue
 */

const https = require('https');

// ─── Labels lisibles pour les produits Chariow ───────────────
const LABELS_PRODUITS = {
  'prd_ggudpxa3': '📶 Anti-vol Réseau Mensuel',
  'prd_ldq33m9h': '📶 Anti-vol Réseau Annuel',
  'prd_v0bqhx4i': '🛰️ Vue Satellite 24h',
  'prd_raupzm8z': '👤 Particulier Mensuel',
  'prd_3iklqt66': '👤 Particulier Annuel',
  'prd_aotwqf':   '🎒 Suivi Élève Mensuel',
  'prd_tv5t2h':   '🎓 Suivi Étudiant Mensuel',
  'prd_zvj2cv':   '🚛 Forfait Flotte B2B',
  'prd_7hj1hc':   '♾️ Accès Illimité',
};

/**
 * Envoie un message Telegram au SuperAdmin.
 * @param {string} texte — message en Markdown
 * @returns {Promise<boolean>}
 */
async function envoyerTelegram(texte) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[paiement] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID manquant — notification ignorée');
    return false;
  }

  const body = JSON.stringify({
    chat_id:    chatId,
    text:       texte,
    parse_mode: 'Markdown',
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.ok) {
          console.log('[paiement] ✅ Notification Telegram envoyée');
          resolve(true);
        } else {
          console.warn('[paiement] ❌ Telegram erreur:', json.description);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[paiement] ❌ Telegram réseau:', err.message);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Notifie le SuperAdmin d'un nouveau paiement validé.
 *
 * @param {object} params
 * @param {string} params.companyId    — UID Firebase du client
 * @param {string} params.productId    — ID produit Chariow
 * @param {string} [params.companyName] — Nom du client (optionnel)
 * @param {string} [params.email]       — Email du client (optionnel)
 * @param {string} [params.orderId]     — ID commande Chariow
 * @param {number} [params.montant]     — Montant en FCFA
 */
async function notifierNouveauPaiement({ companyId, productId, companyName, email, orderId, montant }) {
  const now     = new Date().toLocaleString('fr-FR', {
    timeZone: 'Africa/Brazzaville',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const labelProduit = LABELS_PRODUITS[productId] || `Produit ${productId}`;
  const nomClient    = companyName || email || companyId.slice(0, 8) + '…';
  const montantStr   = montant ? `${montant.toLocaleString('fr-FR')} FCFA` : '—';

  const message = [
    `💰 *Nouveau paiement GPS Tracker*`,
    ``,
    `🕐 ${now}`,
    `👤 Client : ${nomClient}`,
    `📦 Offre : ${labelProduit}`,
    `💵 Montant : ${montantStr}`,
    `🔑 UID : \`${companyId}\``,
    orderId ? `📋 Commande : \`${orderId}\`` : null,
    ``,
    `✅ Licence activée automatiquement`,
  ].filter(Boolean).join('\n');

  // Envoyer sur Telegram
  const telegramOk = await envoyerTelegram(message);

  // Fallback email si Telegram échoue
  if (!telegramOk) {
    await envoyerEmailPaiement({ companyId, companyName, email, labelProduit, montantStr, orderId, now });
  }
}

/**
 * Fallback email via Brevo si Telegram n'est pas configuré.
 */
async function envoyerEmailPaiement({ companyId, companyName, email, labelProduit, montantStr, orderId, now }) {
  const superadminEmail = process.env.SUPERADMIN_EMAIL;
  if (!superadminEmail) return;

  try {
    const { envoyerEmailBrevo } = require('./brevo');
    await envoyerEmailBrevo({
      to:      superadminEmail,
      subject: `💰 Nouveau paiement GPS Tracker — ${labelProduit}`,
      html: `
        <h2>Nouveau paiement validé</h2>
        <table>
          <tr><td><b>Date</b></td><td>${now}</td></tr>
          <tr><td><b>Client</b></td><td>${companyName || email || companyId}</td></tr>
          <tr><td><b>Offre</b></td><td>${labelProduit}</td></tr>
          <tr><td><b>Montant</b></td><td>${montantStr}</td></tr>
          ${orderId ? `<tr><td><b>Commande</b></td><td>${orderId}</td></tr>` : ''}
        </table>
        <p>✅ La licence a été activée automatiquement.</p>
      `,
    });
    console.log('[paiement] ✅ Email fallback envoyé à SuperAdmin');
  } catch (err) {
    console.warn('[paiement] ❌ Email fallback échoué:', err.message);
  }
}

module.exports = { notifierNouveauPaiement };
