/**
 * rapport.js — Interface de génération de rapports PDF
 *
 * Fonctionnalités :
 *  - Chargement des agents de la société connectée
 *  - Vérification du quota d'impression avant soumission
 *  - Appel POST /api/rapport/generer → téléchargement direct du PDF
 *  - Affichage du message de quota épuisé avec offres Chariow
 *  - Historique des rapports générés (RTDB companies/{id}/rapportsHistory)
 */

import { auth, db } from '../shared/firebase.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { ref, onValue, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ─── Éléments DOM ────────────────────────────────────────────
const dashRoot      = document.getElementById('dashboard-root');
const authLoading   = document.getElementById('auth-loading');
const reportForm    = document.getElementById('reportForm');
const agentSelect   = document.getElementById('agentSelect');
const secteurSelect = document.getElementById('secteurSelect');
const dateDebutEl   = document.getElementById('dateDebut');
const dateFinEl     = document.getElementById('dateFin');
const formMessage   = document.getElementById('formMessage');
const offresBlock   = document.getElementById('offresBlock');
const btnGenerer    = document.getElementById('btnGenerer');
const btnIcon       = document.getElementById('btnIcon');
const btnLabel      = document.getElementById('btnLabel');
const quotaLabel    = document.getElementById('quotaLabel');
const historyList   = document.getElementById('historyList');
const btnSignOut    = document.getElementById('btnSignOut');

let currentUser = null;

// ─── Initialisation des dates par défaut ─────────────────────
// Début = 1er du mois courant, Fin = aujourd'hui
(function initDates() {
  const now   = new Date();
  const today = now.toISOString().slice(0, 10);
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  dateDebutEl.value = first;
  dateFinEl.value   = today;
  dateFinEl.max     = today;
  dateDebutEl.max   = today;
})();

// ─── Auth ─────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user || !user.emailVerified) {
    window.location.replace('login.html');
    return;
  }
  currentUser = user;
  authLoading.hidden = true;
  dashRoot.hidden    = false;

  await Promise.all([
    chargerAgents(),
    chargerQuota(),
    ecouterHistorique(),
  ]);
});

btnSignOut?.addEventListener('click', () => {
  signOut(auth).then(() => window.location.replace('login.html'));
});

// ─── Charger les agents de la société ────────────────────────
async function chargerAgents() {
  try {
    const snap = await get(ref(db, 'agents'));
    if (!snap.exists()) return;

    const all = snap.val();
    const mesAgents = Object.entries(all)
      .filter(([, a]) => a.companyId === currentUser.uid)
      .sort(([, a], [, b]) => (a.name || '').localeCompare(b.name || ''));

    agentSelect.innerHTML = '<option value="">— Sélectionnez un agent —</option>';
    mesAgents.forEach(([id, agent]) => {
      const opt = document.createElement('option');
      opt.value       = id;
      opt.textContent = `${agent.name || id} (${id})`;
      // Pré-sélectionner le secteur selon le type de véhicule
      opt.dataset.vehicleType = agent.vehicleType || 'voiture';
      agentSelect.appendChild(opt);
    });

    if (mesAgents.length === 0) {
      agentSelect.innerHTML = '<option value="">Aucun agent dans votre flotte</option>';
    }
  } catch (err) {
    console.error('Erreur chargement agents:', err);
  }
}

// Pré-sélectionner le secteur quand on change d'agent
agentSelect.addEventListener('change', () => {
  const opt = agentSelect.selectedOptions[0];
  if (opt?.dataset.vehicleType) {
    secteurSelect.value = opt.dataset.vehicleType;
  }
});

// ─── Charger le quota d'impression ───────────────────────────
async function chargerQuota() {
  try {
    const token = await currentUser.getIdToken();
    const res   = await fetch(`/api/freemium/${currentUser.uid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.rapportsIllimites) {
      quotaLabel.textContent = '♾️ Illimité (abonnement actif)';
      quotaLabel.className   = 'text-lg font-bold text-emerald-400';
    } else if (data.rapportsRestants > 0) {
      quotaLabel.textContent = `${data.rapportsRestants} rapport(s) payant(s) restant(s)`;
      quotaLabel.className   = 'text-lg font-bold text-sky-400';
    } else if (data.userStatus === 'FREE_BONUS') {
      const credits = data.creditsFreemium ?? '—';
      quotaLabel.textContent = `🎁 Bonus actif — ${credits} visite(s) restante(s), impressions illimitées`;
      quotaLabel.className   = 'text-lg font-bold text-amber-400';
    } else if (data.freeReportsRemainingToday > 0) {
      quotaLabel.textContent = `${data.freeReportsRemainingToday} impression(s) gratuite(s) aujourd'hui`;
      quotaLabel.className   = 'text-lg font-bold text-amber-400';
    } else {
      quotaLabel.textContent = '⛔ Quota épuisé pour aujourd\'hui (plan gratuit)';
      quotaLabel.className   = 'text-lg font-bold text-red-400';
    }
  } catch (err) {
    quotaLabel.textContent = 'Erreur chargement quota';
    quotaLabel.className   = 'text-lg font-bold text-red-400';
  }
}

// ─── Écouter l'historique des rapports en temps réel ─────────
function ecouterHistorique() {
  const histRef = ref(db, `companies/${currentUser.uid}/rapportsHistory`);
  onValue(histRef, (snap) => {
    if (!snap.exists()) {
      historyList.innerHTML = '<p class="text-slate-500 text-sm">Aucun rapport généré pour le moment.</p>';
      return;
    }

    const entries = [];
    snap.forEach((child) => entries.push({ id: child.key, ...child.val() }));
    entries.sort((a, b) => new Date(b.genereAt) - new Date(a.genereAt));

    const secteurIcons = { moto: '🏍️', voiture: '🚗', camion: '🚚', scolaire: '🎓' };

    historyList.innerHTML = entries.slice(0, 20).map((e) => {
      const date    = new Date(e.genereAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      const debut   = e.dateDebut?.slice(0, 10) || '—';
      const fin     = e.dateFin?.slice(0, 10)   || '—';
      const icon    = secteurIcons[e.secteur]    || '📄';
      return `
        <div class="flex items-center justify-between bg-slate-700/30 rounded-lg px-4 py-3 text-sm gap-3">
          <div class="min-w-0">
            <span class="mr-1">${icon}</span>
            <span class="font-medium text-white">${escapeHtml(e.agentNom || e.agentId)}</span>
            <span class="text-slate-400 ml-2 text-xs">${debut} → ${fin}</span>
            <span class="text-slate-500 text-xs ml-2">(${e.nbPoints || 0} pts GPS)</span>
          </div>
          <span class="text-slate-500 text-xs whitespace-nowrap">${date}</span>
        </div>
      `;
    }).join('');
  });
}

// ─── Soumission du formulaire ─────────────────────────────────
reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessage();
  offresBlock.classList.add('hidden');

  const agentId   = agentSelect.value;
  const secteur   = secteurSelect.value;
  const dateDebut = dateDebutEl.value;
  const dateFin   = dateFinEl.value;

  if (!agentId) {
    showMessage('Veuillez sélectionner un agent.', 'error');
    return;
  }
  if (!dateDebut || !dateFin) {
    showMessage('Veuillez renseigner les deux dates.', 'error');
    return;
  }
  if (new Date(dateDebut) > new Date(dateFin)) {
    showMessage('La date de début doit être antérieure à la date de fin.', 'error');
    return;
  }

  // État chargement
  btnGenerer.disabled = true;
  btnIcon.textContent  = '⏳';
  btnLabel.textContent = 'Génération en cours…';

  try {
    const token = await currentUser.getIdToken();
    const res   = await fetch('/api/rapport/generer', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        agentId,
        secteur,
        dateDebut: new Date(dateDebut + 'T00:00:00').toISOString(),
        dateFin:   new Date(dateFin   + 'T23:59:59').toISOString(),
      }),
    });

    if (res.ok) {
      // Téléchargement direct du PDF
      const blob        = await res.blob();
      const url         = URL.createObjectURL(blob);
      const disposition = res.headers.get('Content-Disposition') || '';
      const match       = disposition.match(/filename="([^"]+)"/);
      const filename    = match ? match[1] : `rapport_${agentId}_${dateDebut}.pdf`;

      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showMessage('✅ Rapport généré et téléchargé avec succès.', 'success');
      // Rafraîchir le quota affiché
      await chargerQuota();

    } else {
      const data = await res.json();

      if (data.error === 'quota_epuise') {
        showMessage(data.message || 'Limite quotidienne atteinte.', 'error');
        afficherOffres(data);
      } else {
        showMessage(data.error || data.message || 'Erreur lors de la génération.', 'error');
      }
    }

  } catch (err) {
    showMessage('Erreur réseau. Vérifiez votre connexion.', 'error');
    console.error(err);
  } finally {
    btnGenerer.disabled = false;
    btnIcon.textContent  = '📄';
    btnLabel.textContent = 'Générer le rapport PDF';
  }
});

// ─── Afficher le bloc d'offres Chariow ───────────────────────
function afficherOffres(data) {
  const offres = data.offres || [
    { label: 'Pack 20 rapports',         prix: '590 FCFA',         url: 'https://erpbbfef.mychariow.shop/prd_59udmg' },
    { label: 'Pack 40 rapports',         prix: '1 180 FCFA',       url: 'https://erpbbfef.mychariow.shop/prd_ia4imm' },
    { label: 'Abonnement par Agent',     prix: '31 192 FCFA/mois', url: 'https://erpbbfef.mychariow.shop/prd_unite'  },
    { label: 'Forfait Flotte Illimitée', prix: '26 010 FCFA/mois', url: 'https://erpbbfef.mychariow.shop/prd_flotte' },
  ];

  const titre = data.message
    ? escapeHtml(data.message)
    : '⏳ Limite quotidienne atteinte. Plan gratuit : 1 seule impression par jour.';

  offresBlock.innerHTML = `
    <div class="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4">
      <p class="text-amber-300 font-semibold mb-1">${titre}</p>
      <p class="text-slate-400 text-xs mb-3">
        Activez votre licence sur Chariow pour des rapports illimités :
      </p>
      <div class="flex flex-col gap-2">
        ${offres.map((o) => `
          <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener"
             class="flex items-center justify-between bg-slate-700/60 hover:bg-slate-700 border border-slate-600 hover:border-sky-500 rounded-lg px-3 py-2 transition-all group">
            <span class="text-slate-200 text-xs font-medium group-hover:text-white">${escapeHtml(o.label)}</span>
            <span class="text-sky-400 text-xs font-bold whitespace-nowrap ml-3">${escapeHtml(o.prix)}</span>
          </a>
        `).join('')}
      </div>
      <p class="text-slate-500 text-xs mt-3 text-center">
        Après paiement, activez votre clé dans
        <a href="licence.html" class="text-sky-400 hover:underline">Licences & Packs</a>.
      </p>
    </div>
  `;
  offresBlock.classList.remove('hidden');
}

// ─── Helpers UI ───────────────────────────────────────────────
function showMessage(text, type) {
  const styles = {
    success: 'bg-green-500/10 border border-green-500/30 text-green-300',
    error:   'bg-red-500/10 border border-red-500/30 text-red-300',
    info:    'bg-sky-500/10 border border-sky-500/30 text-sky-300',
  };
  formMessage.textContent = text;
  formMessage.className   = `rounded-lg px-4 py-3 text-sm font-medium ${styles[type] || styles.info}`;
  formMessage.classList.remove('hidden');
}

function hideMessage() {
  formMessage.classList.add('hidden');
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
