import { auth, db, agentsPath } from "../shared/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { brancherBoutonDeconnexion, deconnecter } from "./deconnexion.js";
import { construireUrlChariow } from "./chariow-paiement.js";
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

// État limite courant (mis à jour après chaque renderAgents)
let agentLimitState = { max: 1, count: 0, allowed: true, estIllimite: false, typePack: 'free', planGratuit: true };

// Icônes des véhicules
const vehicleIcons = { moto: '🏍️', voiture: '🚗', camion: '🚚' };
const vehicleLabels = { moto: 'Moto (Livraison/Taxi-moto)', voiture: 'Voiture', camion: 'Camion' };

// ─── Auth ─────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = 'login.html'; return; }
    if (!user.emailVerified) { await deconnecter('login.html'); return; }

    currentUser = user;

    const companyRef = ref(db, `companies/${user.uid}`);
    const snapshot = await get(companyRef);
    if (snapshot.exists()) {
        const company = snapshot.val();
        const name = company.companyName || 'Ma Société';
        if (companyNameEl) companyNameEl.textContent = name;
        renderWelcomeBanner(name);
    }

    listenToAgents(user.uid);
    await syncAddAgentUi();
});

brancherBoutonDeconnexion('#btnSignOut');

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
form.addEventListener('submit', async (e) => {
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
               <a href="licence.html" class="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">👤 Ajuster mon abonnement sur Chariow</a>
               <a href="licence.html" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">🚛 Forfait Flotte Illimitée — 26 010 FCFA/mois</a>
           </div>`
        : estGratuit
        ? `<div class="flex flex-col gap-2 mt-3">
               <a href="licence.html" class="inline-block bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">📄 Pack 20 rapports — 590 FCFA (jusqu'à 10 appareils)</a>
               <a href="licence.html" class="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">👤 Tarif à l'Unité — 31 192 FCFA/mois</a>
               <a href="licence.html" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">🚛 Forfait Flotte Illimitée — 26 010 FCFA/mois</a>
           </div>`
        : `<div class="flex flex-col gap-2 mt-3">
               <a href="licence.html" class="inline-block bg-violet-600 hover:bg-violet-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">👤 Tarif à l'Unité — 31 192 FCFA/mois par agent</a>
               <a href="licence.html" class="inline-block bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-4 py-2 rounded-lg transition-all text-xs text-center">🚛 Forfait Flotte Illimitée — 26 010 FCFA/mois</a>
           </div>`;

    const div = document.createElement('div');
    div.id = 'freemiumBlock';
    div.className = 'mt-4 bg-red-500/10 border border-red-500/40 rounded-lg p-4 text-sm';
    div.innerHTML = `<p class="text-red-300 font-semibold mb-2">🚫 ${limitData.message || 'Limite atteinte.'}</p>${upgradeHtml}`;
    form.appendChild(div);
}

// ─── Suppression ──────────────────────────────────────────────
window.deleteAgent = (agentId) => { agentToDelete = agentId; deleteModal.classList.remove('hidden'); };

cancelDelete.addEventListener('click', () => { deleteModal.classList.add('hidden'); agentToDelete = null; });

confirmDelete.addEventListener('click', async () => {
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

deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) { deleteModal.classList.add('hidden'); agentToDelete = null; }
});

// ─── Bandeau de bienvenue ─────────────────────────────────────
function renderWelcomeBanner(companyName) {
    const header = document.querySelector('header .container');
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

// ─── showQuotaEpuise (export pour licence.js) ─────────────────
export function showQuotaEpuise(errData, ancre = null) {
    document.getElementById('quotaEpuiseBlock')?.remove();
    const uid = currentUser?.uid;
    const offres = errData.offres || (uid ? [
        { label: 'Particulier Premium',  prix: '10 000 FCFA/mois', url: construireUrlChariow('particulier', 'mensuel', uid) },
        { label: 'Forfait Flotte',       prix: 'B2B',              url: construireUrlChariow('flotte', 'mensuel', uid) },
        { label: 'Accès Illimité',       prix: 'Premium',          url: construireUrlChariow('illimite', 'mensuel', uid) },
    ] : [
        { label: 'Voir les offres', prix: 'Licences', url: 'licence.html' },
    ]);
    const offresHtml = offres.map(o => `
        <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener"
           class="flex items-center justify-between bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-sky-500 rounded-lg px-3 py-2 transition-all group">
            <span class="text-slate-200 text-xs font-medium group-hover:text-white">${escapeHtml(o.label)}</span>
            <span class="text-sky-400 text-xs font-bold whitespace-nowrap ml-3">${escapeHtml(o.prix)}</span>
        </a>`).join('');
    const div = document.createElement('div');
    div.id = 'quotaEpuiseBlock';
    div.className = 'my-4 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-sm';
    div.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-3">
            <p class="text-amber-300 font-semibold leading-snug">⏳ Vous avez épuisé votre impression gratuite pour aujourd'hui.</p>
            <button onclick="document.getElementById('quotaEpuiseBlock').remove()" class="text-slate-500 hover:text-slate-300 text-lg leading-none flex-shrink-0">✕</button>
        </div>
        <p class="text-slate-400 text-xs mb-3">Pour débloquer ce rapport, choisissez une offre via Mobile Money :</p>
        <div class="flex flex-col gap-2">${offresHtml}</div>
        <p class="text-slate-500 text-xs mt-3 text-center">Après paiement, activez votre clé dans <a href="licence.html" class="text-sky-400 hover:underline">Licences & Packs</a>.</p>`;
    if (ancre?.parentNode) ancre.parentNode.insertBefore(div, ancre.nextSibling);
    else (document.querySelector('.container') || document.body).prepend(div);
}
