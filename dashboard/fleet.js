import { auth, db, agentsPath } from "../shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { brancherBoutonDeconnexion } from "./deconnexion.js";
import { exigerSessionDashboard } from "./auth-session.js";
import { genererListeUpsellHtml } from "./chariow-paiement.js";
import { showQuotaEpuise } from "./quota-ui.js";
// v2.1 — section appareils en attente active

export { showQuotaEpuise };
import { ref, set, onValue, remove, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Éléments DOM
const form = document.getElementById('addAgentForm');
const agentsList = document.getElementById('agentsList');
const emptyState = document.getElementById('emptyState');
const agentCount = document.getElementById('agentCount');
const errorMessage = document.getElementById('errorMessage');
const submitBtn = document.getElementById('submitBtn');
const companyNameEl = document.getElementById('companyName');
const btnSignOut = document.getElementById('btnSignOut');
const deleteModal = document.getElementById('deleteModal');
const cancelDelete = document.getElementById('cancelDelete');
const confirmDelete = document.getElementById('confirmDelete');

let currentUser = null;
let agentToDelete = null;
let agents = {};
let pendingAgents = {}; // [NOUVEAU] — Appareils en attente d'approbation
let pendingAgentToApprove = null; // [NOUVEAU] — Agent en cours d'approbation

// État limite courant (mis à jour après chaque renderAgents)
let agentLimitState = { max: 1, count: 0, allowed: true, estIllimite: false, typePack: 'free', planGratuit: true };

// Icônes des véhicules
const vehicleIcons = { moto: '🏍️', voiture: '🚗', camion: '🚚' };
const vehicleLabels = { moto: 'Moto (Livraison/Taxi-moto)', voiture: 'Voiture', camion: 'Camion' };

const IS_FLEET_PAGE = Boolean(document.getElementById('addAgentForm'));

// ─── Auth (page flotte uniquement) ────────────────────────────
if (IS_FLEET_PAGE) {
  async function demarrerPageFlotte() {
    currentUser = await exigerSessionDashboard('login.html');

    const companyRef = ref(db, `companies/${currentUser.uid}`);
    const snapshot = await get(companyRef);
    if (snapshot.exists()) {
      const company = snapshot.val();
      const name = company.companyName || 'Ma Société';
      if (companyNameEl) companyNameEl.textContent = name;
      renderWelcomeBanner(name);
    }

    // [NOUVEAU] — Afficher le Code Entreprise (= UID Firebase)
    afficherCodeEntreprise(currentUser.uid);

    listenToAgents(currentUser.uid);

    // [NOUVEAU] — Écouter les appareils en attente d'approbation
    ecouterAppareisEnAttente(currentUser.uid);

    await syncAddAgentUi();
  }

  demarrerPageFlotte().catch(() => {});

  onAuthStateChanged(auth, (user) => {
    if (!user && currentUser) window.location.href = 'login.html';
  });

  brancherBoutonDeconnexion('#btnSignOut');
  brancherBoutonDeconnexion('#btnSignOutMobile');
}

// ─── Helpers UI ───────────────────────────────────────────────
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    setTimeout(() => errorMessage.classList.add('hidden'), 5000);
}

function showSuccess(message) {
    const div = document.createElement('div');
    div.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg z-50';
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

// ─── Écouter les agents (chemin societes/{uid}/agents) ────────
function listenToAgents(companyId) {
    const agentsRef = ref(db, agentsPath(companyId));
    onValue(agentsRef, (snapshot) => {
        agents = snapshot.val() || {};
        renderAgents();
    });
}

// ─── Rendre la liste des agents ───────────────────────────────
function renderAgents() {
    const agentIds = Object.keys(agents);
    const count = agentIds.length;

    agentCount.textContent = `${count} appareil${count > 1 ? 's' : ''} suivi${count > 1 ? 's' : ''}`;

    if (count === 0) {
        emptyState.classList.remove('hidden');
        agentsList.innerHTML = '';
        syncAddAgentUi();
        return;
    }

    emptyState.classList.add('hidden');

    agentsList.innerHTML = agentIds.map(agentId => {
        const agent = agents[agentId];
        const icon = vehicleIcons[agent.vehicleType] || '🚗';
        const vehicleLabel = vehicleLabels[agent.vehicleType] || agent.vehicleType;
        const createdDate = new Date(agent.createdAt).toLocaleDateString('fr-FR');
        return `
            <div class="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-sky-500 transition-all">
                <div class="flex items-start justify-between">
                    <div class="flex items-start gap-4 flex-1">
                        <div class="w-12 h-12 rounded-full bg-slate-600 flex items-center justify-center text-2xl">${icon}</div>
                        <div class="flex-1">
                            <h4 class="font-semibold text-lg text-white mb-1">${agent.name}</h4>
                            <div class="space-y-1 text-sm">
                                <p class="text-slate-400"><span class="text-slate-500">ID:</span>
                                    <code class="bg-slate-800 px-2 py-0.5 rounded text-sky-400">${agentId}</code></p>
                                <p class="text-slate-400"><span class="text-slate-500">Véhicule:</span> ${vehicleLabel}</p>
                                ${agent.phone ? `<p class="text-slate-400"><span class="text-slate-500">Tél:</span> ${agent.phone}</p>` : ''}
                                <p class="text-slate-500 text-xs mt-2">Ajouté le ${createdDate}</p>
                            </div>
                        </div>
                    </div>
                    <button onclick="deleteAgent('${agentId}')"
                        class="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all" title="Supprimer">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>`;
    }).join('');

    syncAddAgentUi();
}

// ─── Synchroniser l'état du bouton + formulaire ───────────────
async function syncAddAgentUi() {
    if (!currentUser) return;

    try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`/api/agents/check-limit/${currentUser.uid}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        agentLimitState = await res.json();
    } catch { /* réseau — on garde l'état précédent */ }

    const count = Object.keys(agents).length;
    const atLimit = !agentLimitState.estIllimite && count >= (agentLimitState.max ?? 1);
    const inputs = form.querySelectorAll('input, select');

    if (count === 0) {
        // Aucun appareil — formulaire actif, libellé adapté
        submitBtn.textContent = 'Ajouter un appareil à suivre';
        submitBtn.disabled = false;
        submitBtn.className = submitBtn.className.replace(/bg-slate-\S+/g, '')
            + ' bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700';
        inputs.forEach(el => { el.disabled = false; });
        document.getElementById('freemiumBlock')?.remove();
        return;
    }

    if (atLimit || !agentLimitState.allowed) {
        // Limite atteinte — désactiver les champs (popup Chariow uniquement à la soumission)
        submitBtn.textContent = 'Limite atteinte — Voir les offres';
        submitBtn.disabled = false;
        inputs.forEach(el => { el.disabled = true; });
        document.getElementById('freemiumBlock')?.remove();
        return;
    }

    // Sous la limite — formulaire actif
    submitBtn.textContent = "Ajouter l'agent";
    submitBtn.disabled = false;
    inputs.forEach(el => { el.disabled = false; });
    document.getElementById('freemiumBlock')?.remove();

    // Avertissement préventif (uniquement pour les packs, pas pour le plan gratuit à 1)
    if (agentLimitState.warning && !agentLimitState.planGratuit) {
        showFreemiumWarning(agentLimitState.warning, count, agentLimitState.max);
    }
}

// ─── Soumission formulaire ────────────────────────────────────
if (IS_FLEET_PAGE) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) { showError('Vous devez être connecté'); return; }

    // Vérifier la limite en temps réel avant d'écrire
    await syncAddAgentUi();
    const count = Object.keys(agents).length;
    if (!agentLimitState.estIllimite && count >= (agentLimitState.max ?? 1)) {
        showFreemiumBlock(agentLimitState);
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Ajout en cours...';

    const name = document.getElementById('agentName').value.trim();
    const agentId = document.getElementById('agentId').value.trim();
    const vehicleType = document.getElementById('vehicleType').value;
    const phone = document.getElementById('agentPhone').value.trim();

    try {
        if (agents[agentId]) throw new Error('Cet identifiant existe déjà. Veuillez en choisir un autre.');

        // Écriture sous societes/{uid}/agents/{agentId} (aligné avec app Android)
        const agentRef = ref(db, `${agentsPath(currentUser.uid)}/${agentId}`);
        await set(agentRef, {
            name,
            vehicleType,
            phone: phone || null,
            createdAt: Date.now(),
            status: 'active',
            lat: null,
            lng: null,
            lastUpdate: null,
            history: {},
        });

        showSuccess(`Appareil "${name}" ajouté avec succès !`);
        form.reset();
    } catch (error) {
        showError(error.message || "Erreur lors de l'ajout");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Ajouter l'agent";
    }
});

// ─── Avertissement préventif (packs 8/10) ────────────────────
function showFreemiumWarning(message, count, max) {
    if (document.getElementById('freemiumWarning')) return;
    const remaining = max - count;
    const div = document.createElement('div');
    div.id = 'freemiumWarning';
    div.className = 'mb-4 bg-orange-500/10 border border-orange-500/40 rounded-lg p-4 text-sm';
    div.innerHTML = `
        <p class="text-orange-300 font-semibold mb-1">⚠️ Plus que ${remaining} place${remaining > 1 ? 's' : ''} disponible${remaining > 1 ? 's' : ''}</p>
        <p class="text-slate-300 text-xs mb-3">${message}</p>
        <a href="licence.html" class="inline-block bg-orange-500 hover:bg-orange-400 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs">🚛 Voir les abonnements</a>
        <button onclick="this.parentElement.remove()" class="ml-2 text-slate-500 hover:text-slate-300 text-xs">Ignorer</button>`;
    form.parentElement.insertBefore(div, form);
}

// ─── Blocage complet (limite atteinte) ───────────────────────
function showFreemiumBlock(limitData) {
    document.getElementById('freemiumBlock')?.remove();

    const estAbonnementUnite = limitData.typeAbonnement === 'abonnement_unite';
    const estGratuit = limitData.planGratuit || limitData.typePack === 'free';

    const upgradeHtml = estAbonnementUnite
        ? `<div class="flex flex-col gap-2 mt-3">
               <a href="licence.html" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">🚛 Forfait Flotte B2B — 25 000 FCFA/mois (agents illimités)</a>
               <a href="licence.html" class="inline-block bg-yellow-600 hover:bg-yellow-500 text-slate-900 font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">♾️ Accès Illimité — 20 000 FCFA (permanent)</a>
           </div>`
        : estGratuit
        ? `<div class="flex flex-col gap-2 mt-3">
               <a href="licence.html" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">🚛 Forfait Flotte B2B — 25 000 FCFA/mois (agents illimités)</a>
               <a href="licence.html" class="inline-block bg-yellow-600 hover:bg-yellow-500 text-slate-900 font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">♾️ Accès Illimité — 20 000 FCFA (permanent)</a>
           </div>`
        : `<div class="flex flex-col gap-2 mt-3">
               <a href="licence.html" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">🚛 Forfait Flotte B2B — 25 000 FCFA/mois (agents illimités)</a>
               <a href="licence.html" class="inline-block bg-yellow-600 hover:bg-yellow-500 text-slate-900 font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">♾️ Accès Illimité — 20 000 FCFA (permanent)</a>
           </div>`;

    const div = document.createElement('div');
    div.id = 'freemiumBlock';
    div.className = 'mt-4 bg-red-500/10 border border-red-500/40 rounded-lg p-4 text-sm';
    div.innerHTML = `<p class="text-red-300 font-semibold mb-2">🚫 ${limitData.message || 'Limite atteinte.'}</p>${upgradeHtml}`;
    form.appendChild(div);
}

// ─── Suppression ──────────────────────────────────────────────
window.deleteAgent = (agentId) => { agentToDelete = agentId; deleteModal.classList.remove('hidden'); };

if (IS_FLEET_PAGE) {
cancelDelete?.addEventListener('click', () => { deleteModal.classList.add('hidden'); agentToDelete = null; });

confirmDelete?.addEventListener('click', async () => {
    if (!agentToDelete || !currentUser) return;
    try {
        await remove(ref(db, `${agentsPath(currentUser.uid)}/${agentToDelete}`));
        showSuccess('Appareil supprimé avec succès');
        deleteModal.classList.add('hidden');
        agentToDelete = null;
    } catch (error) {
        showError('Erreur lors de la suppression');
    }
});

deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) { deleteModal.classList.add('hidden'); agentToDelete = null; }
});
}

// ─── Bandeau de bienvenue ─────────────────────────────────────
function renderWelcomeBanner(companyName) {
    const header = document.querySelector('.app-topbar__inner');
    if (!header || document.getElementById('welcomeBanner')) return;
    if (!document.getElementById('pulse-style')) {
        const style = document.createElement('style');
        style.id = 'pulse-style';
        style.textContent = `@keyframes pulse-green{0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}`;
        document.head.appendChild(style);
    }
    const banner = document.createElement('div');
    banner.id = 'welcomeBanner';
    banner.className = 'w-full flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 border border-sky-500/40 rounded-xl px-5 py-3 mt-3 gap-4';
    banner.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
            <span class="text-2xl">👋</span>
            <div class="min-w-0">
                <p class="text-xs text-slate-500 uppercase tracking-wide">Bienvenue</p>
                <p class="text-base font-bold text-slate-100 truncate">Bonjour, <span class="text-sky-400">${escapeHtml(companyName)}</span></p>
            </div>
        </div>
        <div class="flex items-center gap-2 bg-green-950 border border-green-700 rounded-full px-4 py-2 flex-shrink-0">
            <span style="width:10px;height:10px;background:#22c55e;border-radius:50%;display:inline-block;animation:pulse-green 2s infinite"></span>
            <span class="text-green-400 text-xs font-semibold whitespace-nowrap">● Connecté</span>
        </div>`;
    header.appendChild(banner);
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ══════════════════════════════════════════════════════════════
// [NOUVEAU] — Affichage du Code Entreprise (UID Firebase)
// Ce code est à communiquer aux agents pour l'onboarding Android
// ══════════════════════════════════════════════════════════════
function afficherCodeEntreprise(uid) {
  const display = document.getElementById('companyCodeDisplay');
  const btnCopy = document.getElementById('btnCopyCode');
  if (display) display.textContent = uid;

  btnCopy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(uid);
      btnCopy.textContent = '✅ Copié !';
      btnCopy.classList.replace('bg-sky-600', 'bg-green-600');
      setTimeout(() => {
        btnCopy.textContent = '📋 Copier';
        btnCopy.classList.replace('bg-green-600', 'bg-sky-600');
      }, 2000);
    } catch {
      // Fallback sélection manuelle
      display?.select?.();
      document.execCommand('copy');
    }
  });
}

// ══════════════════════════════════════════════════════════════
// [NOUVEAU] — Écoute temps réel des appareils en attente
// Lit pending/ filtré par companyId == currentUser.uid
// ══════════════════════════════════════════════════════════════
function ecouterAppareisEnAttente(companyId) {
  const pendingRef = ref(db, 'pending');
  onValue(pendingRef, (snapshot) => {
    pendingAgents = {};

    if (snapshot.exists()) {
      snapshot.forEach((child) => {
        const data = child.val();
        // Filtre : seulement les agents de cette société
        // Accepte status "pending" OU status absent (ancienne APK)
        const statusOk = !data.status || data.status === 'pending';
        if (data.companyId === companyId && statusOk) {
          pendingAgents[child.key] = data;
        }
      });
    }

    renderPendingAgents();
  });
}

// ── Rendu de la liste des appareils en attente ─────────────────
function renderPendingAgents() {
  const section    = document.getElementById('pendingSection');
  const list       = document.getElementById('pendingList');
  const badge      = document.getElementById('pendingBadge');
  if (!section || !list) return;

  const count = Object.keys(pendingAgents).length;

  badge && (badge.textContent = count);

  if (count === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  list.innerHTML = Object.entries(pendingAgents).map(([deviceId, agent]) => {
    const date = agent.registeredAt
      ? new Date(agent.registeredAt).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
      : '—';

    return `
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3
                  bg-slate-900/50 border border-slate-700/60 rounded-xl p-4 hover:border-amber-500/40 transition-colors">
        <div class="flex items-start gap-3 flex-1 min-w-0">
          <div class="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-lg">
            📱
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-semibold text-slate-100 text-sm">${escapeHtml(agent.name || 'Sans nom')}</p>
            <p class="text-slate-400 text-xs">${escapeHtml(agent.phone || 'Pas de téléphone')}</p>
            <div class="flex flex-wrap gap-2 mt-1.5">
              <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                ${escapeHtml(agent.deviceModel || deviceId)}
              </span>
              <span class="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded">
                Android ${escapeHtml(agent.androidVersion || '?')}
              </span>
              <span class="text-xs text-slate-500">${escapeHtml(date)}</span>
            </div>
          </div>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <button data-device-id="${escapeHtml(deviceId)}"
            data-agent-name="${escapeHtml(agent.name || 'Sans nom')}"
            data-agent-phone="${escapeHtml(agent.phone || '')}"
            class="btn-approve px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-lg text-xs transition-all">
            ✅ Approuver
          </button>
          <button data-device-id="${escapeHtml(deviceId)}"
            class="btn-reject px-3 py-2 bg-slate-700 hover:bg-red-600/60 text-slate-300 rounded-lg text-xs transition-all">
            ✕ Refuser
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Délégation d'événements sur les boutons
  list.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', () => {
      ouvrirModalApprobation(
        btn.dataset.deviceId,
        btn.dataset.agentName,
        btn.dataset.agentPhone
      );
    });
  });

  list.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => refuserAgent(btn.dataset.deviceId));
  });
}

// ── Ouvrir le modal d'approbation ──────────────────────────────
function ouvrirModalApprobation(deviceId, agentName, agentPhone) {
  pendingAgentToApprove = { deviceId, agentName, agentPhone };

  const modal   = document.getElementById('approveModal');
  const nameEl  = document.getElementById('approveAgentName');
  const msgEl   = document.getElementById('approveMessage');
  const selVeh  = document.getElementById('approveVehicleType');

  if (nameEl)  nameEl.textContent = `Appareil : ${agentName} ${agentPhone ? '— ' + agentPhone : ''}`;
  if (msgEl)   msgEl.classList.add('hidden');
  if (selVeh)  selVeh.value = '';
  if (modal)   modal.classList.remove('hidden');
}

// ── Approuver un agent (depuis le modal) ──────────────────────
async function approuverAgent() {
  if (!pendingAgentToApprove || !currentUser) return;

  const { deviceId, agentName, agentPhone } = pendingAgentToApprove;
  const vehicleType = document.getElementById('approveVehicleType')?.value;
  const msgEl       = document.getElementById('approveMessage');
  const btnConfirm  = document.getElementById('btnConfirmApprove');

  if (!vehicleType) {
    if (msgEl) {
      msgEl.textContent = 'Sélectionnez un type de véhicule.';
      msgEl.className   = 'rounded-lg px-3 py-2 text-sm bg-red-500/10 border border-red-500/30 text-red-300';
      msgEl.classList.remove('hidden');
    }
    return;
  }

  if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.textContent = 'Activation…'; }

  try {
    // Vérifier la limite d'agents avant d'approuver
    await syncAddAgentUi();
    const count = Object.keys(agents).length;
    if (!agentLimitState.estIllimite && count >= (agentLimitState.max ?? 1)) {
      if (msgEl) {
        msgEl.textContent = 'Limite d\'agents atteinte. Upgrader votre abonnement sur Licences.';
        msgEl.className   = 'rounded-lg px-3 py-2 text-sm bg-red-500/10 border border-red-500/30 text-red-300';
        msgEl.classList.remove('hidden');
      }
      return;
    }

    const companyId   = currentUser.uid;
    const ts          = Date.now();

    // 1. Écrire l'agent dans societes/{uid}/agents/{deviceId}
    await set(ref(db, `${agentsPath(companyId)}/${deviceId}`), {
      name:        agentName,
      phone:       agentPhone || null,
      vehicleType,
      createdAt:   ts,
      status:      'active',
      lat:         null,
      lng:         null,
      lastUpdate:  null,
      history:     {},
    });

    // 2. Écrire la config dans societes/{uid}/agents/{deviceId}/config
    //    (écoutée par MainActivity pour l'intégrité + démarrage GPS)
    await set(ref(db, `societes/${companyId}/agents/${deviceId}/config`), {
      name:        agentName,
      phone:       agentPhone || null,
      vehicleType,
      sector:      pendingAgents[deviceId]?.sector || '',
      updatedAt:   ts,
    });

    // 3. Mettre à jour pending/{deviceId} → status "active" + companyId
    //    L'app Android détecte ce changement et démarre le GPS automatiquement
    await set(ref(db, `pending/${deviceId}/status`), 'active');
    await set(ref(db, `pending/${deviceId}/companyId`), companyId);
    await set(ref(db, `pending/${deviceId}/activatedAt`), ts);

    // Fermer le modal
    document.getElementById('approveModal')?.classList.add('hidden');
    pendingAgentToApprove = null;

    showSuccess(`✅ "${agentName}" approuvé et activé ! Le tracking démarre automatiquement.`);
    await syncAddAgentUi();

  } catch (err) {
    console.error('[fleet] Erreur approbation:', err);
    if (msgEl) {
      msgEl.textContent = 'Erreur réseau. Réessayez.';
      msgEl.className   = 'rounded-lg px-3 py-2 text-sm bg-red-500/10 border border-red-500/30 text-red-300';
      msgEl.classList.remove('hidden');
    }
  } finally {
    if (btnConfirm) { btnConfirm.disabled = false; btnConfirm.textContent = '✅ Approuver & Activer'; }
  }
}

// ── Refuser / supprimer un appareil en attente ─────────────────
async function refuserAgent(deviceId) {
  if (!deviceId) return;
  try {
    await set(ref(db, `pending/${deviceId}/status`), 'rejected');
    showSuccess('Appareil refusé.');
  } catch (err) {
    console.error('[fleet] Erreur refus:', err);
  }
}

// ── Écouteurs modal approbation ────────────────────────────────
if (IS_FLEET_PAGE) {
  document.getElementById('btnConfirmApprove')?.addEventListener('click', approuverAgent);

  document.getElementById('btnCancelApprove')?.addEventListener('click', () => {
    document.getElementById('approveModal')?.classList.add('hidden');
    pendingAgentToApprove = null;
  });

  document.getElementById('approveModal')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('approveModal')) {
      document.getElementById('approveModal').classList.add('hidden');
      pendingAgentToApprove = null;
    }
  });

  // ── Aide flotte ──────────────────────────────────────────────
  document.getElementById('btnOuvrirAideFlotte')?.addEventListener('click', () => {
    document.getElementById('modalAideFlotte')?.classList.remove('hidden');
  });
  document.getElementById('btnFermerAideFlotte')?.addEventListener('click', () => {
    document.getElementById('modalAideFlotte')?.classList.add('hidden');
  });
  document.getElementById('modalAideFlotte')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modalAideFlotte')) {
      document.getElementById('modalAideFlotte').classList.add('hidden');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('approveModal')?.classList.add('hidden');
      document.getElementById('modalAideFlotte')?.classList.add('hidden');
      pendingAgentToApprove = null;
    }
  });
}

