/**
 * licence.js — Gestion des licences et packs d'impression
 *
 * Flux :
 * 1. Affiche le statut freemium actuel (rapports restants, agents, pack)
 * 2. Permet d'activer une clé de licence reçue par email (Chariow)
 * 3. Affiche l'historique des activations
 */

import { auth, db } from '../shared/firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ─── Éléments DOM ───────────────────────────────────────────
const statusContent   = document.getElementById('statusContent');
const licenceForm     = document.getElementById('licenceForm');
const licenceKeyInput = document.getElementById('licenceKey');
const licenceMessage  = document.getElementById('licenceMessage');
const btnActivate     = document.getElementById('btnActivate');
const licenceHistory  = document.getElementById('licenceHistory');
const historyList     = document.getElementById('historyList');
const btnSignOut      = document.getElementById('btnSignOut');

let currentUser = null;

// ─── Auth ────────────────────────────────────────────────────
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  loadFreemiumStatus();
  listenLicenceHistory();
});

btnSignOut?.addEventListener('click', () => {
  signOut(auth).then(() => { window.location.href = 'login.html'; });
});

// ─── Formater la clé en XXXX-XXXX-XXXX-XXXX ─────────────────
licenceKeyInput.addEventListener('input', (e) => {
  let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Insérer les tirets automatiquement
  val = val.match(/.{1,4}/g)?.join('-') || val;
  e.target.value = val.slice(0, 19);
});

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
  const packLabel = {
    free:      '🆓 Plan gratuit',
    '20':      '📄 Pack Starter (20 rapports)',
    '40':      '📋 Pack Pro (40 rapports)',
    illimite:  '♾️ Pack Illimité',
  }[data.typePack] || data.typePack;

  const rapportsHtml = data.isIllimite
    ? `<span class="text-green-400 font-bold">Illimité</span>`
    : `<span class="${data.rapportsRestants > 0 ? 'text-sky-400' : 'text-red-400'} font-bold">${data.rapportsRestants}</span> rapport(s) restant(s)`;

  const agentLimitHtml = data.agentLimitReached
    ? `<span class="text-red-400">⚠️ Limite atteinte (${data.agentCount}/${data.maxAgentsFree})</span>`
    : `<span class="text-green-400">${data.agentCount} / ${data.isIllimite ? '∞' : data.maxAgentsFree} agents</span>`;

  statusContent.innerHTML = `
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-slate-700/50 rounded-lg p-4">
        <p class="text-slate-400 text-xs mb-1">Pack actuel</p>
        <p class="font-semibold">${packLabel}</p>
      </div>
      <div class="bg-slate-700/50 rounded-lg p-4">
        <p class="text-slate-400 text-xs mb-1">Rapports</p>
        <p class="font-semibold">${rapportsHtml}</p>
        <p class="text-slate-500 text-xs mt-1">${data.freeReportsRemainingToday} gratuit(s) aujourd'hui</p>
      </div>
      <div class="bg-slate-700/50 rounded-lg p-4">
        <p class="text-slate-400 text-xs mb-1">Agents</p>
        <p class="font-semibold">${agentLimitHtml}</p>
      </div>
    </div>
    ${data.agentLimitReached ? `
      <div class="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
        ⚠️ Vous avez atteint la limite de ${data.maxAgentsFree} agents du plan gratuit.
        Passez au <strong>Pack Illimité</strong> pour ajouter plus d'agents.
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
      const creditsLabel = e.credits === 'illimite' ? 'Illimité' : `+${e.credits} rapports`;
      return `
        <div class="flex items-center justify-between bg-slate-700/30 rounded-lg px-4 py-2 text-sm">
          <div>
            <code class="text-sky-400 font-mono">${e.key}</code>
            <span class="text-slate-400 ml-2">${creditsLabel}</span>
          </div>
          <span class="text-slate-500 text-xs">${date}</span>
        </div>
      `;
    }).join('');
  });
}

// ─── Activation de la clé ────────────────────────────────────
licenceForm.addEventListener('submit', async (e) => {
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
  licenceMessage.className = `px-4 py-3 rounded-lg text-sm font-medium ${
    type === 'success'
      ? 'bg-green-500/10 border border-green-500/30 text-green-300'
      : 'bg-red-500/10 border border-red-500/30 text-red-300'
  }`;
  licenceMessage.classList.remove('hidden');
}

function hideMessage() {
  licenceMessage.classList.add('hidden');
}
