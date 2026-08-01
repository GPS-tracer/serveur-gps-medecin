/**
 * notifications/brevo.js
 *
 * Module d'alertes antivol via Brevo (ex-Sendinblue).
 * Utilisé par le listener Firebase uninstall_alerts pour notifier
 * le propriétaire d'une tentative de désinstallation forcée.
 *
 * Variables d'environnement requises :
 *   BREVO_API_KEY        — clé API Brevo (obligatoire)
 *   BREVO_SENDER_EMAIL   — email expéditeur vérifié dans Brevo (ex: noreply@gpstracker.com)
 *   BREVO_SENDER_NAME    — nom affiché (ex: GPS Tracker)
 *   BREVO_SMS_SENDER     — nom expéditeur SMS, max 11 chars alphanum (ex: GPSTracker)
 *
 * Fonctions exportées :
 *   envoyerEmailAntivol(destinataire, alerte)
 *   envoyerSMSAntivol(telephone, alerte)
 *   envoyerAlertesAntivol(profilSociete, alerte)  ← point d'entrée principal
 */

'use strict';

const brevo = require('@getbrevo/brevo');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration client Brevo
// ─────────────────────────────────────────────────────────────────────────────

function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY non définie dans les variables d\'environnement.');
  }
  const client = brevo.ApiClient.instance;
  client.authentications['api-key'].apiKey = apiKey;
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formate un timestamp en date/heure lisible.
 * @param {number} ts — timestamp Unix en ms
 */
function formatterDate(ts) {
  if (!ts) return 'heure inconnue';
  return new Date(ts).toLocaleString('fr-FR', {
    timeZone: 'Africa/Brazzaville',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

/**
 * Génère le lien vers le dashboard admin (section antivol).
 */
function lienDashboard() {
  const base = process.env.APP_URL || 'https://serveur-gps-medecin.onrender.com';
  return `${base}/dashboard/admin.html`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envoie un email d'alerte antivol au propriétaire.
 *
 * @param {string} destinataire   — adresse email du propriétaire
 * @param {string} nomDestinataire — nom d'affichage
 * @param {Object} alerte         — données de l'alerte Firebase
 * @param {string} alerte.agentId
 * @param {number} alerte.timestamp
 * @param {string} [alerte.message]
 * @param {Object} [alerte.deviceInfo]
 */
async function envoyerEmailAntivol(destinataire, nomDestinataire, alerte) {
  if (!destinataire) {
    console.warn('[Brevo] Email ignoré : destinataire manquant');
    return { success: false, reason: 'destinataire manquant' };
  }

  try {
    getBrevoClient(); // valide la clé API

    const transacApi = new brevo.TransactionalEmailsApi();

    const dateHeure    = formatterDate(alerte.timestamp);
    const agentId      = alerte.agentId || 'Inconnu';
    const deviceModel  = alerte.deviceInfo?.model || 'Appareil inconnu';
    const deviceBrand  = alerte.deviceInfo?.brand || '';
    const urlDashboard = lienDashboard();

    const sendSmtpEmail = new brevo.SendSmtpEmail();

    sendSmtpEmail.to          = [{ email: destinataire, name: nomDestinataire || destinataire }];
    sendSmtpEmail.sender      = {
      email: process.env.BREVO_SENDER_EMAIL || 'noreply@gpstracker.app',
      name:  process.env.BREVO_SENDER_NAME  || 'GPS Tracker',
    };
    sendSmtpEmail.subject     = '🚨 Alerte antivol — Tentative de désinstallation détectée';
    sendSmtpEmail.htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">

        <!-- En-tête -->
        <tr>
          <td style="background:#dc2626;padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:32px;">🚨</p>
            <h1 style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:700;">
              Alerte Antivol GPS Tracker
            </h1>
          </td>
        </tr>

        <!-- Corps -->
        <tr>
          <td style="padding:32px;">
            <p style="color:#94a3b8;margin:0 0 16px;font-size:15px;">
              Bonjour <strong style="color:#e2e8f0;">${escapeHtml(nomDestinataire || 'Propriétaire')}</strong>,
            </p>
            <p style="color:#e2e8f0;font-size:15px;margin:0 0 24px;line-height:1.6;">
              Une <strong>tentative de désinstallation forcée</strong> a été détectée
              sur l'un de vos appareils surveillés.
            </p>

            <!-- Détails alerte -->
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px;">
              <tr>
                <td style="padding:6px 0;">
                  <span style="color:#64748b;font-size:13px;">Appareil</span><br>
                  <strong style="color:#f1f5f9;font-size:14px;">
                    ${escapeHtml(deviceBrand)} ${escapeHtml(deviceModel)}
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;border-top:1px solid #1e293b;">
                  <span style="color:#64748b;font-size:13px;">Identifiant agent</span><br>
                  <strong style="color:#f1f5f9;font-size:13px;font-family:monospace;">
                    ${escapeHtml(agentId)}
                  </strong>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;border-top:1px solid #1e293b;">
                  <span style="color:#64748b;font-size:13px;">Date et heure</span><br>
                  <strong style="color:#f1f5f9;font-size:14px;">${escapeHtml(dateHeure)}</strong>
                </td>
              </tr>
            </table>

            <!-- CTA -->
            <p style="text-align:center;margin-bottom:24px;">
              <a href="${urlDashboard}"
                style="display:inline-block;background:#dc2626;color:#fff;font-weight:700;
                       font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">
                🔒 Accéder au panneau antivol
              </a>
            </p>
            <p style="text-align:center;margin-bottom:24px;">
              <a href="${urlDashboard}"
                style="display:inline-block;background:#1e3a5f;color:#93c5fd;font-weight:600;
                       font-size:13px;padding:10px 24px;border-radius:8px;text-decoration:none;">
                💣 Lancer la destruction à distance
              </a>
            </p>

            <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;">
              Si vous ne reconnaissez pas cet événement, connectez-vous immédiatement
              à votre tableau de bord et utilisez la commande de destruction à distance
              pour effacer les données de l'appareil.
            </p>
          </td>
        </tr>

        <!-- Pied de page -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #334155;text-align:center;">
            <p style="color:#475569;font-size:11px;margin:0;">
              GPS Tracker — Alerte automatique de sécurité<br>
              Ne pas répondre à cet email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const result = await transacApi.sendTransacEmail(sendSmtpEmail);
    console.log(`[Brevo] ✅ Email antivol envoyé → ${destinataire} (messageId: ${result?.body?.messageId || '?'})`);
    return { success: true, messageId: result?.body?.messageId };

  } catch (err) {
    console.error('[Brevo] ❌ Erreur envoi email antivol :', err?.response?.body || err.message);
    return { success: false, error: err?.response?.body || err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envoie un SMS d'alerte antivol au propriétaire.
 * Option payante — activée uniquement si alerts_sms === true dans le profil.
 *
 * @param {string} telephone — numéro au format international sans +  (ex: 242064123456)
 * @param {Object} alerte
 */
async function envoyerSMSAntivol(telephone, alerte) {
  if (!telephone) {
    console.warn('[Brevo] SMS ignoré : numéro manquant');
    return { success: false, reason: 'telephone manquant' };
  }

  // Normaliser le numéro : retirer espaces, tirets, parenthèses, garder chiffres et +
  const numeroNet = telephone.replace(/[\s\-().]/g, '');

  try {
    getBrevoClient();

    const smsApi   = new brevo.TransactionalSMSApi();
    const agentId  = alerte.agentId || 'inconnu';
    const dateHeure = formatterDate(alerte.timestamp);

    const sendTransacSms        = new brevo.SendTransacSms();
    sendTransacSms.sender       = (process.env.BREVO_SMS_SENDER || 'GPSTracker').slice(0, 11);
    sendTransacSms.recipient    = numeroNet;
    sendTransacSms.content      = `🚨 GPS Tracker : tentative desinstallation detectee sur agent ${agentId} le ${dateHeure}. Connectez-vous pour agir : ${lienDashboard()}`;
    sendTransacSms.type         = 'transactional';

    const result = await smsApi.sendTransacSms(sendTransacSms);
    console.log(`[Brevo] ✅ SMS antivol envoyé → ${numeroNet}`);
    return { success: true, result };

  } catch (err) {
    console.error('[Brevo] ❌ Erreur envoi SMS antivol :', err?.response?.body || err.message);
    return { success: false, error: err?.response?.body || err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal — Email + SMS selon préférences du propriétaire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Envoie les alertes antivol (email gratuit + SMS optionnel payant).
 *
 * @param {Object} profilSociete — profil Firebase du propriétaire (companies/{uid})
 * @param {Object} alerte        — données de l'alerte Firebase
 */
async function envoyerAlertesAntivol(profilSociete, alerte) {
  const resultats = { email: null, sms: null };

  // ── Email (gratuit, toujours envoyé si email disponible) ─────────────────
  const emailDestinataire = profilSociete.email;
  const nomDestinataire   = profilSociete.companyName || profilSociete.nom || '';

  if (emailDestinataire) {
    resultats.email = await envoyerEmailAntivol(emailDestinataire, nomDestinataire, alerte);
  } else {
    console.warn('[Brevo] Email propriétaire non trouvé dans le profil société.');
    resultats.email = { success: false, reason: 'email propriétaire introuvable' };
  }

  // ── SMS (payant, activé uniquement si alerts_sms === true dans le profil) ─
  if (profilSociete.alerts_sms === true) {
    const telephone = profilSociete.phone || profilSociete.telephone;
    if (telephone) {
      resultats.sms = await envoyerSMSAntivol(telephone, alerte);
    } else {
      console.warn('[Brevo] SMS demandé mais numéro propriétaire introuvable.');
      resultats.sms = { success: false, reason: 'numéro propriétaire introuvable' };
    }
  } else {
    resultats.sms = { success: false, reason: 'SMS non activé pour ce compte' };
  }

  return resultats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaire local — échapper HTML pour le template email
// ─────────────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  envoyerEmailAntivol,
  envoyerSMSAntivol,
  envoyerAlertesAntivol,
};
