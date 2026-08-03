/**
 * licence.js — Gestion des licences et packs d'impression
 *
 * Flux :
 * 1. Affiche le statut freemium actuel (rapports restants, agents, pack)
 * 2. Permet d'activer une clé de licence reçue par email (Chariow)
 * 3. Affiche l'historique des activations
 */

import { auth, db } from '../shared/firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { brancherBoutonDeconnexion } from './deconnexion.js';
import { exigerSessionDashboard } from './auth-session.js';
import { ref, onValue, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { consommerIntentAchat, aIntentAchatEnAttente, PAGE_ACHAT_AUTH } from './intent-achat.js';
import { rendreCatalogueLicence, surlignerOffreIntentee } from './chariow-paiement.js';
import { genererQrCodeAntivol, telechargerQrCode } from './antivol.js';
import { getProfile, patchProfile } from './profile-cache.js';

function pageLoginSiDeconnecte() {
  return aIntentAchatEnAttente() ? PAGE_ACHAT_AUTH : 'login.html';
}

// ─── Éléments DOM ───────────────────────────────────────────
const statusContent   = document.getElementById('statusContent');
const licenceForm     = document.getElementById('licenceForm');
const licenceKeyInput = document.getElementById('licenceKey');
const licenceMessage  = document.getElementById('licenceMessage');
const btnActivate     = document.getElementById('btnActivate');
const btnPaste        = document.getElementById('btnPaste');
const licenceHistory  = document.getElementById('licenceHistory');
const historyList     = document.getElementById('historyList');
const btnSignOut      = document.getElementById('btnSignOut');

let currentUser = null;

// Catalogue visible immédiatement (liens boutique ; UID ajouté après auth)
rendreCatalogueLicence(null);

async function demarrerPageLicence() {
  currentUser = await exigerSessionDashboard(pageLoginSiDeconnecte());
  const intentAchat = consommerIntentAchat();
  rendreCatalogueLicence(currentUser.uid, intentAchat);
  surlignerOffreIntentee(intentAchat);
  loadFreemiumStatus();
  listenLicenceHistory();
  initialiserBlocAntivol(currentUser.uid);
}

demarrerPageLicence().catch((err) => {
  if (err?.message === 'AUTH_REQUIRED' || err?.message === 'EMAIL_NOT_VERIFIED') return;
  const el = document.getElementById('catalogueOffres');
  if (el) {
    el.insertAdjacentHTML(
      'afterbegin',
      '<p class="text-amber-300 text-sm text-center py-2 col-span-full">Connexion requise pour lier le paiement à votre compte. Les liens ci-dessous ouvrent la boutique Chariow.</p>',
    );
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user && currentUser) {
    window.location.replace(pageLoginSiDeconnecte());
  }
});

brancherBoutonDeconnexion('#btnSignOut');
brancherBoutonDeconnexion('#btnSignOutMobile');

// ─── Auto-formatage : XXXX-XXXX-XXXX-XXXX ───────────────────
// Force majuscules, supprime espaces, insère tirets automatiquement

function formatKey(raw) {
  // Trim + majuscules + garder uniquement alphanumérique
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Groupes de 4 séparés par tirets
  return (clean.match(/.{1,4}/g) || []).join('-').slice(0, 19);
}

licenceKeyInput?.addEventListener('input', (e) => {
  const pos    = e.target.selectionStart;
  const before = e.target.value.length;
  e.target.value = formatKey(e.target.value);
  // Repositionner le curseur proprement
  const diff = e.target.value.length - before;
  e.target.setSelectionRange(pos + diff, pos + diff);
});

// Forcer le trim/majuscules aussi au blur (copier-coller sans frappe)
licenceKeyInput.addEventListener('blur', (e) => {
  e.target.value = formatKey(e.target.value);
});

// ─── Bouton Coller ───────────────────────────────────────────
btnPaste?.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    licenceKeyInput.value = formatKey(text);
    licenceKeyInput.focus();
    showMessage('✅ Clé collée depuis le presse-papiers', 'success');
    setTimeout(hideMessage, 2000);
  } catch {
    // Fallback si l'API clipboard n'est pas disponible
    licenceKeyInput.focus();
    document.execCommand('paste');
    licenceKeyInput.value = formatKey(licenceKeyInput.value);
    showMessage('Collez manuellement avec Ctrl+V / ⌘+V', 'info');
  }
});

// ─── Copier le code parent dans le presse-papiers ────────────
window.copierCodeParent = function copierCodeParent() {
  if (!currentUser) return;
  navigator.clipboard.writeText(currentUser.uid).then(() => {
    const btn = document.getElementById('btnCopierCodeParent');
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = '✅ Copié !';
    setTimeout(() => { btn.textContent = original; }, 2000);
  }).catch(() => {
    showMessage('Impossible de copier automatiquement. Sélectionnez le code manuellement.', 'error');
  });
};

// ─── Charger le statut freemium depuis l'API ─────────────────
async function loadFreemiumStatus() {
  try {
    const token = await currentUser.getIdToken();
    const res   = await fetch(`/api/freemium/${currentUser.uid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Erreur');

    renderStatus(data);
  } catch (err) {
    statusContent.innerHTML = `<p class="text-red-400 text-sm">Erreur chargement: ${err.message}</p>`;
  }
}

function renderStatus(data) {
  // ── Labels des packs (alignés sur les 10 produits Chariow) ──
  const packLabel = {
    free:                '🆓 Plan gratuit',
    wifi:                '📶 Option Wi-Fi suivi',
    particulier:         '⭐ Particulier Premium',
    particulier_premium: '⭐ Particulier Premium',
    eleve:               '🎒 Suivi Élève',
    suivi_eleve:         '🎒 Suivi Élève',
    etudiant:            '🎓 Suivi Étudiant',
    suivi_etudiant:      '🎓 Suivi Étudiant',
    abonnement_flotte:   '🚛 Forfait Flotte B2B',
    illimite:            '♾️ Accès Illimité',
  }[data.typePack] || data.typePack;

  // ── Rapports ──────────────────────────────────────────────
  const rapportsHtml = data.rapportsIllimites
    ? `<span class="text-green-400 font-bold">Illimité</span>`
    : data.rapportsRestants > 0
      ? `<span class="text-sky-400 font-bold">${data.rapportsRestants}</span> rapport(s) restant(s)`
      : `<span class="text-red-400 font-bold">0</span> rapport(s) restant(s)`;

  // ── Agents ────────────────────────────────────────────────
  const maxLabel = data.isIllimite ? '∞' : (data.maxAgents ?? data.maxAgentsFree);
  const agentLimitHtml = data.agentLimitReached
    ? `<span class="text-red-400">⚠️ Limite atteinte (${data.agentCount}/${maxLabel})</span>`
    : `<span class="text-green-400">${data.agentCount} / ${maxLabel} agents</span>`;

  // ── Bandeau abonnement actif ──────────────────────────────
  let abonnementBannerHtml = '';
  if (data.abonnementActif && data.dateExpiration) {
    const expDate  = new Date(data.dateExpiration);
    const diffMs   = expDate.getTime() - Date.now();
    const diffJours = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dateStr  = expDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    const urgence  = diffJours <= 5;

    abonnementBannerHtml = `
      <div class="mt-4 ${urgence
        ? 'bg-orange-500/10 border border-orange-500/30'
        : 'bg-emerald-500/10 border border-emerald-500/30'
      } rounded-lg p-3 flex items-center justify-between gap-3 text-sm">
        <div>
          <span class="${urgence ? 'text-orange-300' : 'text-emerald-300'} font-semibold">
            ${urgence ? '⚠️' : '✅'} Abonnement actif
          </span>
          <span class="text-slate-400 ml-2">— expire le <strong class="text-white">${dateStr}</strong></span>
        </div>
        <span class="${urgence ? 'text-orange-400' : 'text-emerald-400'} font-bold text-xs whitespace-nowrap">
          J-${diffJours}
        </span>
      </div>
      ${urgence ? `
        <div class="mt-2 bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 text-xs text-orange-300">
          ⚠️ Votre abonnement expire dans ${diffJours} jour(s). Renouvelez dès maintenant pour éviter l'interruption.
        </div>
      ` : ''}
    `;
  }

  if (data.particulierActif) {
    abonnementBannerHtml += `
      <div class="mt-4 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-200">
        ⭐ Particulier Premium actif — 1 appareil, rapports illimités.
      </div>`;
  }

  // ── Code parent (à partager avec l'élève/étudiant) ────────
  // Affiché si abonnement scolaire actif OU si abonnement_scolaire_expire > maintenant
  const estSuiviScolaire = (data.scolaireActif &&
    ['suivi_eleve', 'suivi_etudiant'].includes(data.typeAbonnement)) ||
    (data.abonnement_scolaire_expire && data.abonnement_scolaire_expire > Date.now());

  const typeLabel = data.typeAbonnement === 'suivi_etudiant' ? 'étudiant' : 'élève';
  const codeParentHtml = estSuiviScolaire ? `
    <div class="mt-4 bg-sky-500/10 border border-sky-500/30 rounded-lg p-4">
      <p class="text-sky-300 font-semibold text-sm mb-1">🔑 Mon code parent</p>
      <p class="text-slate-400 text-xs mb-3">
        Donnez ce code à votre ${typeLabel} pour qu'il le saisisse lors du premier lancement de l'application GPS Tracker. Il liera automatiquement son compte au vôtre.
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 bg-slate-900/60 rounded-lg px-3 py-2 text-sm text-white font-mono tracking-wide break-all">${currentUser.uid}</code>
        <button id="btnCopierCodeParent" type="button" onclick="window.copierCodeParent()"
          class="px-3 py-2 bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
          📋 Copier
        </button>
      </div>
    </div>
  ` : '';

  statusContent.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-slate-700/50 rounded-lg p-4">
        <p class="text-slate-400 text-xs mb-1">Pack actuel</p>
        <p class="font-semibold">${packLabel}</p>
        ${data.quantiteAgents && data.quantiteAgents > 1
          ? `<p class="text-sky-400 text-xs mt-1">${data.quantiteAgents} agent(s) inclus</p>`
          : ''}
      </div>
      <div class="bg-slate-700/50 rounded-lg p-4">
        <p class="text-slate-400 text-xs mb-1">Rapports</p>
        <p class="font-semibold">${rapportsHtml}</p>
        ${data.rapportsIllimites
          ? ''
          : `<p class="text-slate-500 text-xs mt-1">${data.freeReportsRemainingToday ?? 0} gratuit(s) aujourd'hui</p>`
        }
      </div>
      <div class="bg-slate-700/50 rounded-lg p-4">
        <p class="text-slate-400 text-xs mb-1">Agents</p>
        <p class="font-semibold">${agentLimitHtml}</p>
      </div>
    </div>
    ${abonnementBannerHtml}
    ${codeParentHtml}
    ${data.agentLimitReached ? `
      <div class="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
        ⚠️ Vous avez atteint votre limite d'agents.
        ${data.abonnementActif
          ? 'Renouvelez avec une quantité supérieure ou passez au <strong>Forfait Flotte</strong>.'
          : 'Passez au <strong>Forfait Flotte</strong> (25 000 FCFA/mois) pour des agents illimités.'}
      </div>
    ` : ''}
  `;
}

// ─── Écouter l'historique des licences en temps réel ─────────
function listenLicenceHistory() {
  const histRef = ref(db, `companies/${currentUser.uid}/licenceHistory`);
  onValue(histRef, (snapshot) => {
    if (!snapshot.exists()) {
      licenceHistory.classList.add('hidden');
      return;
    }

    const entries = [];
    snapshot.forEach((child) => {
      entries.push({ id: child.key, ...child.val() });
    });
    entries.sort((a, b) => new Date(b.activatedAt) - new Date(a.activatedAt));

    licenceHistory.classList.remove('hidden');
    historyList.innerHTML = entries.map((e) => {
      const date = new Date(e.activatedAt).toLocaleString('fr-FR', {
        dateStyle: 'short', timeStyle: 'short',
      });
      // Labels alignés sur les 10 produits Chariow
      const packLabels = {
        wifi:              'Option Wi-Fi suivi',
        particulier:       'Particulier Premium',
        eleve:             'Suivi Élève',
        suivi_eleve:       'Suivi Élève',
        etudiant:          'Suivi Étudiant',
        suivi_etudiant:    'Suivi Étudiant',
        abonnement_flotte: 'Forfait Flotte B2B',
        illimite:          'Accès Illimité',
      };
      const creditsLabel = e.credits === 'illimite'
        ? 'Accès Illimité'
        : packLabels[e.typePack] || (e.credits ? `+${e.credits} crédits` : e.typePack || '—');

      // Badge expiration pour les abonnements
      const expBadge = e.dateExpiration
        ? `<span class="text-xs text-slate-500 ml-1">→ exp. ${new Date(e.dateExpiration).toLocaleDateString('fr-FR')}</span>`
        : '';

      return `
        <div class="flex items-center justify-between bg-slate-700/30 rounded-lg px-4 py-2 text-sm">
          <div class="min-w-0">
            <code class="text-sky-400 font-mono">${e.key}</code>
            <span class="text-slate-400 ml-2">${creditsLabel}</span>
            ${expBadge}
          </div>
          <span class="text-slate-500 text-xs ml-2 whitespace-nowrap">${date}</span>
        </div>
      `;
    }).join('');
  });
}

// ─── Activation de la clé ────────────────────────────────────
licenceForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const key = licenceKeyInput.value.trim();
  if (!key || key.length < 16) {
    showMessage('Veuillez saisir une clé valide (16 caractères)', 'error');
    return;
  }

  btnActivate.disabled = true;
  btnActivate.textContent = 'Activation en cours...';
  hideMessage();

  try {
    const token = await currentUser.getIdToken();
    const res   = await fetch('/api/licence/activate', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ licenceKey: key }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMessage(data.error || 'Erreur lors de l\'activation', 'error');
      return;
    }

    // Succès
    showMessage(`✅ ${data.message}`, 'success');
    licenceKeyInput.value = '';

    // Recharger le statut
    await loadFreemiumStatus();

  } catch (err) {
    showMessage('Erreur réseau. Vérifiez votre connexion.', 'error');
  } finally {
    btnActivate.disabled = false;
    btnActivate.textContent = 'Activer la clé';
  }
});

// ─── Helpers UI ──────────────────────────────────────────────
function showMessage(text, type) {
  licenceMessage.textContent = text;
  const styles = {
    success: 'bg-green-500/10 border border-green-500/30 text-green-300',
    error:   'bg-red-500/10 border border-red-500/30 text-red-300',
    info:    'bg-sky-500/10 border border-sky-500/30 text-sky-300',
  };
  licenceMessage.className = `px-4 py-3 rounded-lg text-sm font-medium ${styles[type] || styles.info}`;
  licenceMessage.classList.remove('hidden');
}

function hideMessage() {
  licenceMessage.classList.add('hidden');
}

// ──────────────────────────────────────────────────────────────
// BLOC ANTIVOL — QR Code + Badge Protection (R5 / R7)
// Visible uniquement pour les comptes Particulier
// ──────────────────────────────────────────────────────────────

/**
 * Initialise le bloc antivol pour les comptes Particulier.
 * - Écoute companies/{uid} pour détecter le type de compte et isDeviceOwner
 * - Affiche le badge de protection adapté
 * - Branche les boutons QR Code
 * @param {string} uid
 */
function initialiserBlocAntivol(uid) {
  const blocAntivol          = document.getElementById('blocAntivol');
  const badgeProtection      = document.getElementById('badgeProtection');
  const blocNiveauProtection = document.getElementById('blocNiveauProtection');
  const iconeProtection      = document.getElementById('iconeProtection');
  const titreProtection      = document.getElementById('titreProtection');
  const descProtection       = document.getElementById('descProtection');
  const lienPasser           = document.getElementById('lienPasserProtectionTotale');
  const btnGenerer           = document.getElementById('btnGenererQrCode');
  const btnTelecharger       = document.getElementById('btnTelechargerQrCode');

  if (!blocAntivol) return;

  // Écoute temps réel du profil pour détecter le type de compte et isDeviceOwner
  onValue(ref(db, `companies/${uid}`), (snap) => {
    if (!snap.exists()) return;
    const data = snap.val();

    // Mettre à jour le cache avec les données fraîches
    patchProfile(uid, data);

    // Afficher le bloc uniquement pour les comptes Particulier
    const estParticulier = data.role === 'particulier'
      || data.accountType === 'particulier'
      || data.typePack === 'particulier'
      || data.typePack === 'particulier_premium';

    if (!estParticulier) {
      blocAntivol.classList.add('hidden');
      return;
    }

    blocAntivol.classList.remove('hidden');

    // ── Badge et indicateur de protection (R7) ──────────────
    const isDeviceOwner = data.isDeviceOwner === true;
    if (badgeProtection) {
      badgeProtection.innerHTML = isDeviceOwner
        ? `<span class="px-3 py-1.5 rounded-full text-xs font-bold border bg-emerald-500/15 text-emerald-400 border-emerald-500/40">🟢 Protection totale</span>`
        : `<span class="px-3 py-1.5 rounded-full text-xs font-bold border bg-amber-500/15 text-amber-400 border-amber-500/40">🟡 Protection standard</span>`;
    }

    if (blocNiveauProtection) {
      blocNiveauProtection.classList.remove('hidden');
      // Masquer le skeleton
      document.getElementById('skeletonProtection')?.remove();

      if (isDeviceOwner) {
        blocNiveauProtection.className = 'mb-5 rounded-xl p-4 border bg-emerald-500/10 border-emerald-500/30';
        if (iconeProtection)  iconeProtection.textContent  = '🟢';
        if (titreProtection)  titreProtection.textContent  = 'Protection totale — Device Owner actif';
        if (descProtection)   descProtection.textContent   = 'Réinitialisation usine bloquée, désinstallation impossible, destruction à distance disponible.';
        if (lienPasser)       lienPasser.classList.add('hidden');
      } else {
        blocNiveauProtection.className = 'mb-5 rounded-xl p-4 border bg-amber-500/10 border-amber-500/30';
        if (iconeProtection)  iconeProtection.textContent  = '🟡';
        if (titreProtection)  titreProtection.textContent  = 'Protection standard — Installation APK';
        if (descProtection)   descProtection.textContent   = 'Suivi GPS actif, alertes antivol email. Le téléphone peut être réinitialisé en usine.';
        if (lienPasser)       lienPasser.classList.remove('hidden');
      }
    }
  });

  // ── Bouton Générer le QR Code (R5) ──────────────────────────
  btnGenerer?.addEventListener('click', () => {
    btnGenerer.disabled    = true;
    btnGenerer.textContent = '⏳ Génération…';

    try {
      genererQrCodeAntivol(uid, 'qrCodeContainer');
      btnTelecharger?.classList.remove('hidden');
      btnGenerer.textContent = '✅ QR Code généré';
      setTimeout(() => {
        btnGenerer.disabled    = false;
        btnGenerer.textContent = '🔄 Régénérer';
      }, 2000);
    } catch (err) {
      console.error('[antivol] Erreur génération:', err);
      btnGenerer.disabled    = false;
      btnGenerer.textContent = '🔄 Générer mon QR Code';
    }
  });

  // ── Bouton Télécharger le QR Code ──────────────────────────
  btnTelecharger?.addEventListener('click', () => {
    telechargerQrCode('qrCodeContainer', uid);
  });
}
