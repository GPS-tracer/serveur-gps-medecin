import { auth, db } from "../shared/firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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

// Icônes des véhicules
const vehicleIcons = {
    moto: '🏍️',
    voiture: '🚗',
    camion: '🚚'
};

const vehicleLabels = {
    moto: 'Moto (Livraison/Taxi-moto)',
    voiture: 'Voiture',
    camion: 'Camion'
};

// Vérifier l'authentification
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'login.html';
        return;
    }
    
    // Vérifier si l'email est vérifié
    if (!user.emailVerified) {
        await auth.signOut();
        window.location.href = 'login.html';
        return;
    }
    
    currentUser = user;
    
    // Charger les infos de la société
    const companyRef = ref(db, `companies/${user.uid}`);
    const snapshot = await get(companyRef);
    if (snapshot.exists()) {
        const company = snapshot.val();
        companyNameEl.textContent = company.companyName || 'Ma Société';
    }
    
    // Écouter les changements d'agents
    listenToAgents(user.uid);
});

// Déconnexion
btnSignOut.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.href = 'login.html';
    });
});

// Afficher erreur
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    setTimeout(() => {
        errorMessage.classList.add('hidden');
    }, 5000);
}

// Afficher succès
function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-4 rounded-lg shadow-lg z-50';
    successDiv.textContent = message;
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

// Écouter les agents en temps réel
function listenToAgents(companyId) {
    const agentsRef = ref(db, `agents`);
    
    onValue(agentsRef, (snapshot) => {
        const allAgents = snapshot.val() || {};
        
        // Filtrer uniquement les agents de cette société
        agents = {};
        Object.keys(allAgents).forEach(agentId => {
            const agent = allAgents[agentId];
            if (agent.companyId === companyId) {
                agents[agentId] = agent;
            }
        });
        
        renderAgents();
    });
}

// Rendre la liste des agents
function renderAgents() {
    const agentIds = Object.keys(agents);
    const count = agentIds.length;
    
    agentCount.textContent = `${count} agent${count > 1 ? 's' : ''}`;
    
    if (count === 0) {
        emptyState.classList.remove('hidden');
        agentsList.innerHTML = '';
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
                        <div class="w-12 h-12 rounded-full bg-slate-600 flex items-center justify-center text-2xl">
                            ${icon}
                        </div>
                        <div class="flex-1">
                            <h4 class="font-semibold text-lg text-white mb-1">${agent.name}</h4>
                            <div class="space-y-1 text-sm">
                                <p class="text-slate-400">
                                    <span class="text-slate-500">ID:</span> 
                                    <code class="bg-slate-800 px-2 py-0.5 rounded text-sky-400">${agentId}</code>
                                </p>
                                <p class="text-slate-400">
                                    <span class="text-slate-500">Véhicule:</span> ${vehicleLabel}
                                </p>
                                ${agent.phone ? `
                                    <p class="text-slate-400">
                                        <span class="text-slate-500">Tél:</span> ${agent.phone}
                                    </p>
                                ` : ''}
                                <p class="text-slate-500 text-xs mt-2">Ajouté le ${createdDate}</p>
                            </div>
                        </div>
                    </div>
                    <button 
                        onclick="deleteAgent('${agentId}')" 
                        class="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                        title="Supprimer">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Ajouter un agent
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!currentUser) {
        showError('Vous devez être connecté');
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Vérification...';
    
    const name = document.getElementById('agentName').value.trim();
    const agentId = document.getElementById('agentId').value.trim();
    const vehicleType = document.getElementById('vehicleType').value;
    const phone = document.getElementById('agentPhone').value.trim();
    
    try {
        // ── Vérifier la limite freemium avant d'ajouter ──────────
        const token    = await currentUser.getIdToken();
        const limitRes = await fetch(`/api/agents/check-limit/${currentUser.uid}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const limitData = await limitRes.json();

        if (!limitData.allowed) {
            showFreemiumBlock(limitData.message);
            return;
        }

        submitBtn.textContent = 'Ajout en cours...';

        // Vérifier si l'ID existe déjà
        if (agents[agentId]) {
            throw new Error('Cet identifiant existe déjà. Veuillez en choisir un autre.');
        }
        
        // Créer l'agent dans Firebase (structure compatible avec l'app Android)
        const agentRef = ref(db, `agents/${agentId}`);
        await set(agentRef, {
            name,
            vehicleType,
            phone: phone || null,
            createdAt: Date.now(),
            status: 'active',
            companyId: currentUser.uid,
            lat: null,
            lng: null,
            lastUpdate: null,
            history: {}
        });
        
        showSuccess(`Agent ${name} ajouté avec succès!`);
        form.reset();
        
    } catch (error) {
        console.error('Erreur ajout agent:', error);
        showError(error.message || 'Erreur lors de l\'ajout de l\'agent');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Ajouter l\'agent';
    }
});

// Afficher le blocage freemium avec lien vers la page licences
function showFreemiumBlock(message) {
    const existing = document.getElementById('freemiumBlock');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'freemiumBlock';
    div.className = 'mt-4 bg-yellow-500/10 border border-yellow-500/40 rounded-lg p-4 text-sm';
    div.innerHTML = `
        <p class="text-yellow-300 font-semibold mb-2">⚠️ Limite atteinte</p>
        <p class="text-slate-300 mb-3">${message}</p>
        <a href="licence.html"
           class="inline-block bg-yellow-500 hover:bg-yellow-600 text-slate-900 font-semibold px-4 py-2 rounded-lg transition-all text-xs">
            🔑 Acheter un pack
        </a>
    `;
    form.appendChild(div);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Ajouter l\'agent';
}

// Supprimer un agent
window.deleteAgent = (agentId) => {
    agentToDelete = agentId;
    deleteModal.classList.remove('hidden');
};

cancelDelete.addEventListener('click', () => {
    deleteModal.classList.add('hidden');
    agentToDelete = null;
});

confirmDelete.addEventListener('click', async () => {
    if (!agentToDelete || !currentUser) return;
    
    try {
        const agentRef = ref(db, `agents/${agentToDelete}`);
        await remove(agentRef);
        
        showSuccess('Agent supprimé avec succès');
        deleteModal.classList.add('hidden');
        agentToDelete = null;
        
    } catch (error) {
        console.error('Erreur suppression:', error);
        showError('Erreur lors de la suppression');
    }
});

// Fermer le modal en cliquant à l'extérieur
deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) {
        deleteModal.classList.add('hidden');
        agentToDelete = null;
    }
});
