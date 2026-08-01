/**
 * notifications/brevo.js
 *
 * Module d'alertes antivol via Brevo (nouvelle API @getbrevo/brevo).
 *
 * Variables d'environnement requises :
 *   BREVO_API_KEY        — clé API Brevo
 *   BREVO_SENDER_EMAIL   — email expéditeur vérifié dans Brevo
 *   BREVO_SENDER_NAME    — nom affiché (ex: GPS Tracker)
 *   BREVO_SMS_SENDER     — nom expéditeur SMS, max 11 chars (ex: GPSTracker)
 */

'use strict';

const { BrevoClient } = require('@getbrevo/brevo');

// ─────────────────────────────────────────────────────────────────────────────
// Client Brevo
// ─────────────────────────────────────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY non définie.');
  return new BrevoClient({ apiKey });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatterDate(ts) {
  if (!ts) return 'heure inconnue';
  return new Date(ts).toLocaleString('fr-FR', {
    timeZone: 'Africa/Brazzaville',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function lienDashboard() {
  const base = process.env.APP_URL || 'https://serveur-gps-medecin.onrender.com';
  return `${base}/dashboard/admin.html`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────────────────────────────────────

async function envoyerEmailAntivol(destinataire, nomDestinataire, alerte) {
  if (!destinataire) {
    console.warn('[Brevo] Email ignoré : destinataire manquant');
    return { success: false, reason: 'destinataire manquant' };
  }

  try {
    const client     = getClient();
    const dateHeure  = formatterDate(alerte.timestamp);
    const agentId    = alerte.agentId || 'Inconnu';
    const deviceModel = alerte.deviceInfo?.model || 'Appareil inconnu';
    const deviceBrand = alerte.deviceInfo?.brand || '';
    const urlDashboard = lienDashboard();

    const result = await client.transactionalEmails.sendTransacEmail({
      to:      [{ email: destinataire, name: nomDestinataire || destinataire }],
      sender:  {
        email: process.env.BREVO_SENDER_EMAIL || 'noreply@gpstracker.app',
        name:  process.env.BREVO_SENDER_NAME  || 'GPS Tracker',
      },
      subject: '🚨 Alerte antivol — Tentative de désinstallation détectée',
      htmlContent: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
        style="background:#1e293b;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:#dc2626;padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:32px;">🚨</p>
            <h1 style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:700;">
              Alerte Antivol GPS Tracker
            </h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="color:#94a3b8;margin:0 0 16px;font-size:15px;">
              Bonjour <strong style="color:#e2e8f0;">${escapeHtml(nomDestinataire || 'Propriétaire')}</strong>,
            </p>
            <p style="color:#e2e8f0;font-size:15px;margin:0 0 24px;line-height:1.6;">
              Une <strong>tentative de désinstallation forcée</strong> a été détectée sur un de vos appareils.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px;">
              <tr><td style="padding:6px 0;">
                <span style="color:#64748b;font-size:13px;">Appareil</span><br>
                <strong style="color:#f1f5f9;font-size:14px;">${escapeHtml(deviceBrand)} ${escapeHtml(deviceModel)}</strong>
              </td></tr>
              <tr><td style="padding:6px 0;border-top:1px solid #1e293b;">
                <span style="color:#64748b;font-size:13px;">Identifiant agent</span><br>
                <strong style="color:#f1f5f9;font-size:13px;font-family:monospace;">${escapeHtml(agentId)}</strong>
              </td></tr>
              <tr><td style="padding:6px 0;border-top:1px solid #1e293b;">
                <span style="color:#64748b;font-size:13px;">Date et heure</span><br>
                <strong style="color:#f1f5f9;font-size:14px;">${escapeHtml(dateHeure)}</strong>
              </td></tr>
            </table>
            <p style="text-align:center;margin-bottom:16px;">
              <a href="${urlDashboard}"
                style="display:inline-block;background:#dc2626;color:#fff;font-weight:700;
                       font-size:15px;padding:14px 32px;border-radius:8px;text-decoration:none;">
                🔒 Accéder au panneau antivol
              </a>
            </p>
            <p style="color:#475569;font-size:12px;line-height:1.6;margin:0;">
              Connectez-vous immédiatement et utilisez la commande de destruction à distance
              pour effacer les données de l'appareil.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #334155;text-align:center;">
            <p style="color:#475569;font-size:11px;margin:0;">
              GPS Tracker — Alerte automatique de sécurité · Ne pas répondre à cet email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    console.log(`[Brevo] ✅ Email antivol envoyé → ${destinataire}`);
    return { success: true, messageId: result?.data?.messageId || result?.messageId };

  } catch (err) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error('[Brevo] ❌ Erreur email antivol :', detail);
    return { success: false, error: detail };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────────────────────────

async function envoyerSMSAntivol(telephone, alerte) {
  if (!telephone) {
    console.warn('[Brevo] SMS ignoré : numéro manquant');
    return { success: false, reason: 'telephone manquant' };
  }

  const numeroNet = '+' + String(telephone).replace(/[\s\-().+]/g, '');

  try {
    const client    = getClient();
    const agentId   = alerte.agentId || 'inconnu';
    const dateHeure = formatterDate(alerte.timestamp);
    const url       = lienDashboard();

    const result = await client.transactionalSms.sendTransacSms({
      sender:    (process.env.BREVO_SMS_SENDER || 'GPSTracker').slice(0, 11),
      recipient: numeroNet,
      content:   `🚨 GPS Tracker : tentative desinstallation detectee sur agent ${agentId} le ${dateHeure}. Connectez-vous : ${url}`,
      type:      'transactional',
    });

    console.log(`[Brevo] ✅ SMS antivol envoyé → ${numeroNet}`);
    return { success: true, result: result?.data || result };

  } catch (err) {
    const detail = err?.response?.data || err?.message || String(err);
    console.error('[Brevo] ❌ Erreur SMS antivol :', detail);
    return { success: false, error: detail };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Point d'entrée principal
// ─────────────────────────────────────────────────────────────────────────────

async function envoyerAlertesAntivol(profilSociete, alerte) {
  const resultats = { email: null, sms: null };

  // Email — toujours envoyé si email disponible
  const emailDestinataire = profilSociete.email;
  const nomDestinataire   = profilSociete.companyName || profilSociete.nom || '';

  if (emailDestinataire) {
    resultats.email = await envoyerEmailAntivol(emailDestinataire, nomDestinataire, alerte);
  } else {
    resultats.email = { success: false, reason: 'email propriétaire introuvable' };
  }

  // SMS — uniquement si alerts_sms === true
  if (profilSociete.alerts_sms === true) {
    const telephone = profilSociete.phone || profilSociete.telephone;
    if (telephone) {
      resultats.sms = await envoyerSMSAntivol(telephone, alerte);
    } else {
      resultats.sms = { success: false, reason: 'numéro propriétaire introuvable' };
    }
  } else {
    resultats.sms = { success: false, reason: 'SMS non activé pour ce compte' };
  }

  return resultats;
}

module.exports = {
  envoyerEmailAntivol,
  envoyerSMSAntivol,
  envoyerAlertesAntivol,
};
