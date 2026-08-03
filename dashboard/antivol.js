/**
 * antivol.js — Génération du QR Code MDM antivol personnalisé (R5)
 *
 * Produit un QR Code Android Device Owner conforme à la spec NFC/QR
 * de Google (android.app.extra.PROVISIONING_*).
 *
 * Ce QR Code est scanné sur un téléphone Android VIERGE (setup wizard)
 * pour enrôler l'appareil en mode Device Owner sans aucune saisie manuelle.
 *
 * Dépendance : qrcode.min.js (déjà présent dans le dossier dashboard)
 */

/**
 * Construit le payload JSON du QR Code MDM.
 * @param {string} uid  — UID Firebase du compte Particulier
 * @param {string} apkUrl — URL de téléchargement de l'APK
 * @param {string} apkChecksum — SHA-256 du fichier APK (base64)
 * @returns {string} JSON stringifié prêt pour le QR
 */
export function construirePayloadQrCode(uid, apkUrl, apkChecksum) {
  const payload = {
    // Package de l'application Device Owner
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
      "com.gpstracker.agent/com.gpstracker.agent.AdminReceiver",

    // URL de téléchargement de l'APK
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": apkUrl,

    // Checksum SHA-256 de l'APK (base64 encodé) — obligatoire pour la sécurité
    "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": apkChecksum,

    // Données supplémentaires transmises à AdminReceiver.onProfileProvisioningComplete()
    "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
      uid,
      account_type: "particulier",
    },

    // Désactiver l'écran de chiffrement (déjà chiffré par défaut sur Android 6+)
    "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": false,

    // Fuseau horaire Congo (UTC+1)
    "android.app.extra.PROVISIONING_TIME_ZONE": "Africa/Brazzaville",

    // Localisation française
    "android.app.extra.PROVISIONING_LOCALE": "fr_CG",
  };

  return JSON.stringify(payload);
}

/**
 * Génère et affiche le QR Code dans un élément canvas/div.
 * @param {string} uid        — UID Firebase du client
 * @param {string} containerId — ID de l'élément DOM cible
 * @param {object} options    — options optionnelles { apkUrl, apkChecksum }
 */
export function genererQrCodeAntivol(uid, containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(`[antivol] Conteneur introuvable: #${containerId}`);
    return;
  }

  const apkUrl      = options.apkUrl      || 'https://serveur-gps-medecin.onrender.com/download/GPTS-Tracker.apk';
  const apkChecksum = options.apkChecksum || 'ku3ZjOApiHncrtU2ok5LrXf-n-28fFSO6u5QbOY30S4';

  const payload = construirePayloadQrCode(uid, apkUrl, apkChecksum);

  // Vider le conteneur
  container.innerHTML = '';

  // Utiliser QRCode.js (bibliothèque déjà chargée via qrcode.min.js)
  if (typeof QRCode === 'undefined') {
    container.innerHTML = `
      <p class="text-red-400 text-xs text-center">
        ⚠️ Bibliothèque QR Code non chargée. Rechargez la page.
      </p>`;
    return;
  }

  try {
    new QRCode(container, {
      text:          payload,
      width:         240,
      height:        240,
      colorDark:     '#0f172a',
      colorLight:    '#ffffff',
      correctLevel:  QRCode.CorrectLevel.M,
    });
  } catch (err) {
    console.error('[antivol] Erreur génération QR Code:', err);
    container.innerHTML = `<p class="text-red-400 text-xs text-center">Erreur génération QR Code.</p>`;
  }
}

/**
 * Télécharge le QR Code en PNG.
 * @param {string} containerId — ID du conteneur avec le QR Code
 * @param {string} uid         — UID pour nommer le fichier
 */
export function telechargerQrCode(containerId, uid) {
  const canvas = document.querySelector(`#${containerId} canvas`);
  if (!canvas) {
    alert('Générez d\'abord le QR Code.');
    return;
  }

  const link = document.createElement('a');
  link.download = `qr-antivol-${uid.slice(0, 8)}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();
}
