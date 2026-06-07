/**
 * admin.js — Panneau d'administration GPS Tracker
 *
 * [ADMIN SUPRÊME] — Version ultra-sécurisée avec :
 *  - Splash GPS-Tracker + waitForServerWake (plus d'affichage brut Render)
 *  - Vérification stricte du rôle superadmin dans Firebase RTDB
 *  - Vue globale de tous les clients de la plateforme
 *  - Fonctionnalité "Destruction à distance" (payante, sur alerte désinstallation)
 *  - Bearer token Firebase pour toutes les requêtes backend
 *  - Supervision serveur Render en temps réel
 */

// [ADMIN SUPRÊME] — Importations Firebase SDK modulaire
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref, onValue, set, push, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { genererTableauAdminChariowHtml } from './chariow-paiement.js';

// [ADMIN SUPRÊME] — Import du module de réveil serveur (évite l'affichage brut Render)
import { waitForServerWake } from './splash-wake.js';

// ── Éléments DOM — Splash ──────────────────────────────────────────────
const splashAdmin       = document.getElementById('splash-admin');
const splashAdminStatus = document.getElementById('splash-admin-status');

// ── Éléments DOM — Catalogue & Panel ──────────────────────────────────
const adminCatalogueChariow = document.getElementById('adminCatalogueChariow');

// ── Éléments DOM — Stats globales ──────────────────────────────────────
const statSocietes        = document.getElementById('statSocietes');
const statAbonnements     = document.getElementById('statAbonnements');
const statClesDisponibles = document.getElementById('statClesDisponibles');
const statClesUtilisees   = document.getElementById('statClesUtilisees');

// ── Éléments DOM — Import de clés ──────────────────────────────────────
const importTypePack       = document.getElementById('importTypePack');
const importKeys           = document.getElementById('importKeys');
const importMessage        = document.getElementById('importMessage');
const btnImport            = document.getElementById('btnImport');
const quantiteAgentsRow    = document.getElementById('quantiteAgentsRow');
const importQuantiteAgents = document.getElementById('importQuantiteAgents');

// ── Éléments DOM — Génération de clés ──────────────────────────────────
const genTypePack       = document.getElementById('genTypePack');
const genCount          = document.getElementById('genCount');
const genMessage        = document.getElementById('genMessage');
const genResult         = document.getElementById('genResult');
const btnGenerate       = document.getElementById('btnGenerate');
const genQuantiteRow    = document.getElementById('genQuantiteRow');
const genQuantiteAgents = document.getElementById('genQuantiteAgents');

// ── Éléments DOM — Cron & Notifs ────────────────────────────────────────
const cronMessage  = document.getElementById('cronMessage');
const btnCron      = document.getElementById('btnCron');
const notifMessage = document.getElementById('notifMessage');
const btnNotif     = document.getElementById('btnNotif');

// ── Éléments DOM — Supervision & Sécurité ──────────────────────────────
const pingStatus           = document.getElementById('pingStatus');
const accountSearchInput   = document.getElementById('accountSearchInput');
const btnSearchAccount     = document.getElementById('btnSearchAccount');
const searchMessage        = document.getElementById('searchMessage');
const accountSearchResults = document.getElementById('accountSearchResults');
const accountResultsBody   = document.getElementById('accountResultsBody');
const licenceFilterInput   = document.getElementById('licenceFilterInput');
const btnRefreshLicences   = document.getElementById('btnRefreshLicences');
const licencesTableBody    = document.getElementById('licencesTableBody');

// [ADMIN SUPRÊME] — Éléments DOM — Vue globale clients
const allClientsTableBody = document.getElementById('allClientsTableBody');
const clientsFilterInput  = document.getElementById('clientsFilterInput');
const btnRefreshClients   = document.getElementById('btnRefreshClients');
const clientsCount        = document.getElementById('clientsCount');

// [ADMIN SUPRÊME] — Éléments DOM — Destruction à distance
const uninstallAlertsContainer = document.getElementById('uninstallAlertsContainer');
const uninstallAlertBadge      = document.getElementById('uninstallAlertBadge');
const destructionTargetId      = document.getElementById('destructionTargetId');
const destructionRaison        = document.getElementById('destructionRaison');
const btnDestructionManuelle   = document.getElementById('btnDestructionManuelle');
const destructionMessage       = document.getElementById('destructionMessage');
const modalDestructionConfirm  = document.getElementById('modalDestructionConfirm');
const destructionTargetLabel   = document.getElementById('destructionTargetLabel');
const btnAnnulerDestruction    = document.getElementById('btnAnnulerDestruction');
const btnConfirmerDestruction  = document.getElementById('btnConfirmerDestruction');
// [NOUVEAU] — Champ de confirmation par frappe + indice d'erreur
const destructionConfirmInput  = document.getElementById('destructionConfirmInput');
const destructionConfirmHint   = document.getElementById('destructionConfirmHint');

// ── Éléments DOM — Aide administrateur
const btnOuvrirAideAdmin = document.getElementById('btnOuvrirAideAdmin');
const modalAideAdmin     = document.getElementById('modalAideAdmin');
const btnFermerAide      = document.getElementById('btnFermerAide');

// ── Variables d'état globales ───────────────────────────────────────────
let adminToken   = null;
let allLicences  = [];
let allClients   = [];
let pendingDestructionTarget = null;
let pendingDestructionRaison = null;

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — ÉTAPE 1 : Réveil du serveur Render avant toute auth
// Affiche le logo GPS-Tracker pendant le cold-start du serveur Render
// (plus d'affichage du texte brut "Render" au chargement de la page)
// ══════════════════════════════════════════════════════════════════════════
(async () => {
  // Mise à jour du statut dans le splash GPS-Tracker
  const setStatus = (msg) => {
    if (splashAdminStatus) splashAdminStatus.textContent = msg;
  };

  setStatus("Réveil du serveur sécurisé… Veuillez patienter.");

  await waitForServerWake({
    onStatus: setStatus,
    maxAttempts: 25,
    intervalMs: 2000,
    requestTimeoutMs: 12000,
  });

  setStatus("Serveur prêt. Vérification de votre session admin…");

  // [ADMIN SUPRÊME] — ÉTAPE 2 : Vérification Firebase Auth + rôle superadmin
  // Exécuté APRÈS le réveil serveur pour garantir que les appels API fonctionnent
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      console.log("[ADMIN SUPRÊME] — Non connecté → redirection login.");
      window.location.replace('login.html?redirect=admin.html');
      return;
    }

    if (!user.emailVerified) {
      console.log("[ADMIN SUPRÊME] — Email non vérifié → déconnexion.");
      const { deconnecter } = await import("./deconnexion.js");
      await deconnecter("login.html");
      return;
    }

    try {
      setStatus("Vérification des privilèges administrateur…");

      const [socSnap, compSnap] = await Promise.all([
        get(ref(db, `societes/${user.uid}`)),
        get(ref(db, `companies/${user.uid}`)),
      ]);
      const { fusionnerProfil } = await import("./roles.js");
      const companyData = fusionnerProfil(compSnap.val() || {}, socSnap.val() || {});

      if (!socSnap.exists() && !compSnap.exists()) {
        console.log("[ADMIN SUPRÊME] — Profil introuvable. Accès refusé.");
        window.location.replace('index.html');
        return;
      }

      if (companyData.role !== 'superadmin') {
        console.log(`[ADMIN SUPRÊME] — Rôle insuffisant (${companyData.role || 'aucun'}). Accès refusé.`);
        window.location.replace('index.html');
        return;
      }

      // Récupération du token pour les appels API sécurisés
      adminToken = await user.getIdToken();
      console.log("[ADMIN SUPRÊME] — Accès autorisé.");

      // Retrait en douceur du splash GPS-Tracker
      if (splashAdmin) {
        splashAdmin.classList.add('fade-out');
        setTimeout(() => splashAdmin.classList.add('hidden'), 500);
      }

      // Initialisation complète du panneau admin
      initialiserPanneauAdmin();

    } catch (err) {
      console.error("[ADMIN SUPRÊME] — Erreur de validation :", err);
      window.location.replace('index.html');
    }
  });
})();

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Initialisation centrale du panneau
// ══════════════════════════════════════════════════════════════════════════
function initialiserPanneauAdmin() {
  // Injection du catalogue Chariow
  if (adminCatalogueChariow) {
    adminCatalogueChariow.innerHTML = genererTableauAdminChariowHtml();
  }

  // Chargement des données
  chargerStats();
  chargerLicences();
  chargerTousLesClients();

  // Écoute temps réel des alertes de désinstallation forcée
  ecouterAlertesDesinstallation();

  // Association des écouteurs d'événements
  configurerEcouteurs();

  // Surveillance serveur Render (ping toutes les 15 secondes)
  demarrerSupervisionServeur();
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Supervision serveur Render (ping /api/ping)
// ══════════════════════════════════════════════════════════════════════════
function demarrerSupervisionServeur() {
  async function executerPing() {
    const debut = performance.now();
    try {
      const res = await fetch('/api/ping');
      const fin = performance.now();
      const latence = Math.round(fin - debut);

      if (res.ok) {
        if (pingStatus) {
          pingStatus.innerHTML = `
            <span class="inline-block h-3.5 w-3.5 bg-emerald-500 rounded-full"></span>
            Serveur Connecté (${latence}ms)
          `;
        }
      } else {
        if (pingStatus) {
          pingStatus.innerHTML = `
            <span class="inline-block h-3.5 w-3.5 bg-yellow-500 rounded-full animate-pulse"></span>
            Réponse serveur anormale (${res.status})
          `;
        }
      }
    } catch {
      if (pingStatus) {
        pingStatus.innerHTML = `
          <span class="inline-block h-3.5 w-3.5 bg-red-500 rounded-full animate-pulse"></span>
          Serveur Inaccessible
        `;
      }
    }
  }

  executerPing();
  setInterval(executerPing, 15000);
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Statistiques globales Firebase
// ══════════════════════════════════════════════════════════════════════════
async function chargerStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) return;
    const data = await res.json();

    if (statSocietes)        statSocietes.textContent        = data.totalSocietes     ?? '—';
    if (statAbonnements)     statAbonnements.textContent     = data.abonnementsActifs ?? '—';
    if (statClesDisponibles) statClesDisponibles.textContent = data.clesDisponibles   ?? '—';
    if (statClesUtilisees)   statClesUtilisees.textContent   = data.clesUtilisees     ?? '—';
  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Statistiques :", err);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Historique global des licences
// ══════════════════════════════════════════════════════════════════════════
async function chargerLicences() {
  if (licencesTableBody) {
    licencesTableBody.innerHTML = `
      <tr><td colspan="6" class="p-6 text-center text-slate-500">Chargement des licences...</td></tr>
    `;
  }

  try {
    const res = await fetch('/api/admin/licences', {
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
    const data = await res.json();

    if (data.success && Array.isArray(data.licences)) {
      allLicences = data.licences;
      renderLicencesTable(allLicences);
    } else {
      throw new Error("Format de réponse invalide");
    }
  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Licences :", err);
    if (licencesTableBody) {
      licencesTableBody.innerHTML = `
        <tr><td colspan="6" class="p-6 text-center text-red-400">⚠️ Erreur lors du chargement des licences</td></tr>
      `;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Vue globale de TOUS les clients de l'application
// Lit directement depuis Firebase RTDB le nœud "companies"
// ══════════════════════════════════════════════════════════════════════════
async function chargerTousLesClients() {
  if (allClientsTableBody) {
    allClientsTableBody.innerHTML = `
      <tr><td colspan="6" class="p-6 text-center text-slate-500">Chargement des clients...</td></tr>
    `;
  }

  try {
    // ✅ Appel via API backend (seule méthode fiable pour les règles RTDB restrictives)
    if (!adminToken) {
      throw new Error('Token administrateur non disponible. Rechargez la page.');
    }

    const res = await fetch('/api/admin/clients', {
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
    });

    // Vérifier les erreurs HTTP
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'Erreur serveur' }));
      throw new Error(errorData.error || `Erreur HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.success || !Array.isArray(data.clients)) {
      throw new Error('Format de réponse invalide du serveur');
    }

    allClients = data.clients;
    
    if (allClients.length === 0) {
      allClientsTableBody.innerHTML = `
        <tr><td colspan="6" class="p-6 text-center text-slate-400">Aucun client enregistré.</td></tr>
      `;
      return;
    }

    renderAllClientsTable(allClients);

  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Clients :", err);
    if (allClientsTableBody) {
      const errorMsg = err.message || 'Erreur lors du chargement des clients';
      allClientsTableBody.innerHTML = `
        <tr><td colspan="6" class="p-6 text-center">
          <div class="text-red-400">⚠️ ${errorMsg}</div>
          <div class="text-slate-500 text-xs mt-2">
            Vérifiez que le serveur est actif et que vous êtes connecté en tant que superadmin.
          </div>
        </td></tr>
      `;
    }
  }
}

// ── Rendu du tableau de tous les clients ───────────────────────────────
function renderAllClientsTable(clients) {
  if (!allClientsTableBody) return;

  if (clientsCount) clientsCount.textContent = clients.length;

  if (clients.length === 0) {
    allClientsTableBody.innerHTML = `
      <tr><td colspan="6" class="p-6 text-center text-slate-400">Aucun client enregistré.</td></tr>
    `;
    return;
  }

  const packColors = {
    illimite:         'bg-emerald-500/20 text-emerald-400',
    abonnement_flotte:'bg-sky-500/20 text-sky-400',
    suivi_eleve:      'bg-cyan-500/20 text-cyan-400',
    suivi_etudiant:   'bg-indigo-500/20 text-indigo-400',
    free:             'bg-slate-700 text-slate-400',
  };
  const roleColors = {
    superadmin: 'bg-red-500/20 text-red-400',
    partner:    'bg-indigo-500/20 text-indigo-400',
    school:     'bg-cyan-500/20 text-cyan-400',
    company:    'bg-slate-700 text-slate-300',
  };

  allClientsTableBody.innerHTML = clients.map(c => {
    const packCls = packColors[c.typePack] || packColors.free;
    const roleCls = roleColors[c.role]     || roleColors.company;
    const dateInsc = c.createdAt ? formatterDate(c.createdAt) : '—';

    return `
      <tr class="hover:bg-slate-800/40 border-b border-slate-800/60 transition-colors">
        <td class="p-3">
          <div class="font-semibold text-slate-100 text-xs">${escapeHtml(c.companyName)}</div>
          <div class="text-slate-500 text-xs">${escapeHtml(c.email)}</div>
        </td>
        <td class="p-3 font-mono text-slate-500 text-xs select-all">${escapeHtml(c.uid)}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold ${roleCls}">${escapeHtml((c.role || 'company').toUpperCase())}</span>
        </td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold ${packCls}">${escapeHtml(c.typePack || 'free')}</span>
        </td>
        <td class="p-3 text-slate-400 text-xs">${escapeHtml(dateInsc)}</td>
        <td class="p-3 text-right">
          <div class="flex justify-end gap-1">
            <button data-uid="${escapeHtml(c.uid)}" data-action="destruct-client"
              title="Envoyer commande destruction à cet agent"
              class="px-2 py-1 bg-rose-700/60 hover:bg-rose-700 text-white rounded text-xs font-semibold transition-colors">
              💣
            </button>
            ${!c.validated ? `
              <button data-uid="${escapeHtml(c.uid)}" class="btn-validate px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors">
                ✓ Valider
              </button>
            ` : `
              <button data-uid="${escapeHtml(c.uid)}" class="btn-revoke px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition-colors">
                ✕ Révoquer
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Écoute temps réel des alertes de désinstallation forcée
// L'agent Android écrit dans RTDB : uninstall_alerts/{agentId}
// quand il détecte une tentative de désinstallation forcée
// ══════════════════════════════════════════════════════════════════════════
function ecouterAlertesDesinstallation() {
  onValue(ref(db, 'uninstall_alerts'), (snap) => {
    if (!snap.exists()) {
      if (uninstallAlertsContainer) {
        uninstallAlertsContainer.innerHTML = `
          <p class="text-slate-500 text-xs italic p-3 bg-slate-900/30 rounded-lg">
            Aucune alerte de désinstallation forcée en cours.
          </p>
        `;
      }
      if (uninstallAlertBadge) uninstallAlertBadge.classList.add('hidden');
      return;
    }

    const alertes = [];
    snap.forEach((child) => {
      alertes.push({ id: child.key, ...child.val() });
    });

    // Filtre uniquement les alertes non traitées
    const actives = alertes.filter(a => a.status !== 'treated');

    if (uninstallAlertBadge) {
      if (actives.length > 0) {
        uninstallAlertBadge.textContent = actives.length;
        uninstallAlertBadge.classList.remove('hidden');
      } else {
        uninstallAlertBadge.classList.add('hidden');
      }
    }

    if (!uninstallAlertsContainer) return;

    if (actives.length === 0) {
      uninstallAlertsContainer.innerHTML = `
        <p class="text-slate-500 text-xs italic p-3 bg-slate-900/30 rounded-lg">
          Aucune alerte active. Toutes les alertes ont été traitées.
        </p>
      `;
      return;
    }

    uninstallAlertsContainer.innerHTML = actives.map(a => `
      <div class="flex items-start justify-between gap-3 p-3 bg-rose-950/40 border border-rose-800/40 rounded-lg">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-rose-400 text-xs font-bold">🚨 DÉSINSTALLATION FORCÉE</span>
            <span class="text-slate-500 text-xs">${escapeHtml(formatterDate(a.timestamp || a.ts || Date.now()))}</span>
          </div>
          <p class="text-slate-200 text-xs font-mono truncate">Agent : ${escapeHtml(a.agentId || a.deviceId || a.id || '—')}</p>
          <p class="text-slate-400 text-xs">Propriétaire : ${escapeHtml(a.ownerId || a.companyId || '—')}</p>
          ${a.message ? `<p class="text-slate-500 text-xs italic mt-1">${escapeHtml(a.message)}</p>` : ''}
        </div>
        <div class="flex flex-col gap-1 flex-shrink-0">
          <button data-alert-id="${escapeHtml(a.id)}" data-agent-id="${escapeHtml(a.agentId || a.id)}"
            class="btn-destroy-alert px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold rounded transition-colors whitespace-nowrap">
            💣 Détruire
          </button>
          <button data-alert-id="${escapeHtml(a.id)}"
            class="btn-dismiss-alert px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-xs rounded transition-colors">
            Ignorer
          </button>
        </div>
      </div>
    `).join('');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Destruction à distance
// Écrit une commande dans RTDB : destruction_commands/{agentId}
// L'agent Android lit ce nœud et exécute la destruction si la commande existe
// ══════════════════════════════════════════════════════════════════════════
function ouvrirModalDestruction(targetId, raison) {
  pendingDestructionTarget = targetId;
  pendingDestructionRaison = raison || 'Commande admin';

  if (destructionTargetLabel) {
    destructionTargetLabel.textContent = `Cible : ${targetId} — Raison : ${raison || 'Commande admin'}`;
  }

  // [NOUVEAU] — Réinitialiser le champ de confirmation et désactiver le bouton
  if (destructionConfirmInput) {
    destructionConfirmInput.value = '';
    destructionConfirmInput.classList.remove('border-green-500', 'border-rose-500');
    destructionConfirmInput.classList.add('border-slate-600');
  }
  if (destructionConfirmHint) destructionConfirmHint.classList.add('hidden');
  if (btnConfirmerDestruction) {
    btnConfirmerDestruction.disabled = true;
    btnConfirmerDestruction.className = btnConfirmerDestruction.className
      .replace(/bg-rose-\S+/g, '')
      .replace(/hover:bg-rose-\S+/g, '')
      .replace(/cursor-pointer/g, '')
      .trim()
      + ' bg-slate-600 text-slate-400 cursor-not-allowed';
  }

  if (modalDestructionConfirm) modalDestructionConfirm.classList.remove('hidden');

  // Focus sur le champ de confirmation
  setTimeout(() => destructionConfirmInput?.focus(), 100);
}

async function executerDestructionDistante(targetId, raison) {
  try {
    // [ADMIN SUPRÊME] — Écriture dans RTDB nœud destruction_commands
    // L'agent Android surveille ce nœud et déclenche la destruction
    await set(ref(db, `destruction_commands/${targetId}`), {
      command:     'DESTROY',
      reason:      raison || 'Forced uninstall detected',
      issuedBy:    'superadmin',
      issuedAt:    Date.now(),
      status:      'pending',
    });

    // Tentative via API backend pour logging côté serveur
    try {
      await fetch('/api/admin/destruction/trigger', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ targetId, raison }),
      });
    } catch {
      // Non bloquant : la commande RTDB est déjà écrite
    }

    showMsg(destructionMessage,
      `💣 Commande de destruction envoyée à l'appareil "${targetId}". L'agent recevra l'ordre au prochain wake-up.`,
      'error'
    );

    // Marquer l'alerte comme traitée si elle existait
    try {
      await set(ref(db, `uninstall_alerts/${targetId}/status`), 'treated');
    } catch { /* pas d'alerte associée */ }

  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Destruction :", err);
    showMsg(destructionMessage, `❌ Erreur lors de l'envoi de la commande : ${err.message}`, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Recherche de comptes
// ══════════════════════════════════════════════════════════════════════════
async function rechercherCompte() {
  if (!accountSearchInput) return;
  const query = accountSearchInput.value.trim();
  if (!query) {
    showMsg(searchMessage, 'Saisissez un critère de recherche (email, UID ou nom).', 'error');
    return;
  }

  if (btnSearchAccount) { btnSearchAccount.disabled = true; btnSearchAccount.textContent = 'Recherche…'; }
  if (searchMessage)     searchMessage.classList.add('hidden');
  if (accountSearchResults) accountSearchResults.classList.add('hidden');

  try {
    const res  = await fetch(`/api/admin/accounts/search?query=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(searchMessage, data.error || 'Erreur lors de la recherche.', 'error');
      return;
    }

    if (data.success && Array.isArray(data.accounts)) {
      renderSearchResults(data.accounts);
    } else {
      showMsg(searchMessage, 'Format de réponse invalide.', 'error');
    }
  } catch (err) {
    showMsg(searchMessage, 'Erreur réseau : ' + err.message, 'error');
  } finally {
    if (btnSearchAccount) { btnSearchAccount.disabled = false; btnSearchAccount.textContent = 'Rechercher'; }
  }
}

function renderSearchResults(accounts) {
  if (!accountResultsBody) return;

  if (accounts.length === 0) {
    accountResultsBody.innerHTML = `
      <tr><td colspan="4" class="p-6 text-center text-slate-400">Aucun compte trouvé.</td></tr>
    `;
    if (accountSearchResults) accountSearchResults.classList.remove('hidden');
    return;
  }

  accountResultsBody.innerHTML = accounts.map(acc => `
    <tr class="hover:bg-slate-800/40 border-b border-slate-800 transition-colors">
      <td class="p-3">
        <div class="font-semibold text-slate-100">${escapeHtml(acc.companyName)}</div>
        <div class="text-xs text-slate-400">${escapeHtml(acc.email)}</div>
      </td>
      <td class="p-3 font-mono text-slate-400 select-all text-xs">${escapeHtml(acc.uid)}</td>
      <td class="p-3">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold ${acc.role === 'partner' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-700 text-slate-300'}">
            ${escapeHtml(acc.role.toUpperCase())}
          </span>
          <span class="px-2 py-0.5 rounded-full text-xs font-bold ${acc.validated ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">
            ${acc.validated ? 'Validé' : 'Non Validé'}
          </span>
        </div>
      </td>
      <td class="p-3 text-right">
        <div class="flex justify-end gap-2">
          ${!acc.validated
            ? `<button data-uid="${acc.uid}" class="btn-validate px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors">Valider</button>`
            : `<button data-uid="${acc.uid}" class="btn-revoke px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition-colors">Révoquer</button>`
          }
        </div>
      </td>
    </tr>
  `).join('');

  if (accountSearchResults) accountSearchResults.classList.remove('hidden');
}

// ── Modification de statut compte (validate / revoke) ─────────────────
async function modifierStatutCompte(companyId, action, button) {
  const originalText = button.textContent;
  button.disabled    = true;
  button.textContent = 'En cours…';
  if (searchMessage) searchMessage.classList.add('hidden');

  try {
    const res  = await fetch(`/api/admin/accounts/${action}`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ companyId }),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(searchMessage, data.error || 'Erreur lors de l\'opération.', 'error');
    } else {
      showMsg(searchMessage, `✅ ${data.message || 'Action effectuée avec succès.'}`, 'success');
      await chargerStats();
      await rechercherCompte();
      await chargerTousLesClients();
    }
  } catch (err) {
    showMsg(searchMessage, 'Erreur réseau : ' + err.message, 'error');
  } finally {
    button.disabled    = false;
    button.textContent = originalText;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Rendu tableau licences
// ══════════════════════════════════════════════════════════════════════════
function renderLicencesTable(licences) {
  if (!licencesTableBody) return;

  if (licences.length === 0) {
    licencesTableBody.innerHTML = `
      <tr><td colspan="6" class="p-6 text-center text-slate-400">Aucune clé de licence enregistrée.</td></tr>
    `;
    return;
  }

  const translatedPacks = {
    illimite:          'Accès Illimité',
    abonnement_flotte: 'Forfait Flotte B2B',
    suivi_eleve:       'Suivi Élève',
    suivi_etudiant:    'Suivi Étudiant',
  };

  licencesTableBody.innerHTML = licences.map(lic => {
    const packLabel  = translatedPacks[lic.type_pack] || lic.type_pack;
    const isUsed     = lic.statut === 'utilise';
    const statutBadge = isUsed
      ? `<span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full font-bold text-xs">Utilisé</span>`
      : `<span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-bold text-xs">Disponible</span>`;

    return `
      <tr class="hover:bg-slate-800/40 border-b border-slate-800/60 transition-colors">
        <td class="p-3 font-mono font-bold text-slate-200 select-all text-xs">${escapeHtml(lic.cle_licence)}</td>
        <td class="p-3 font-medium text-slate-300 text-xs">${escapeHtml(packLabel)}</td>
        <td class="p-3">${statutBadge}</td>
        <td class="p-3 font-mono text-slate-400 select-all text-xs">${escapeHtml(lic.utilise_par || '—')}</td>
        <td class="p-3 text-slate-400 text-xs">${escapeHtml(lic.date_activation ? formatterDate(lic.date_activation) : '—')}</td>
        <td class="p-3 text-slate-400 text-xs">${escapeHtml(lic.date_expiration ? formatterDate(lic.date_expiration) : '—')}</td>
      </tr>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Configuration de tous les écouteurs d'événements
// ══════════════════════════════════════════════════════════════════════════
function configurerEcouteurs() {

  // ── Visibilité champs quantité agents ───────────────────────────────
  [importTypePack, genTypePack].forEach((sel) => {
    sel?.addEventListener('change', () => {
      const needsQty = ['suivi_eleve', 'suivi_etudiant'].includes(sel.value);
      if (sel === importTypePack) quantiteAgentsRow?.classList.toggle('hidden', !needsQty);
      if (sel === genTypePack)   genQuantiteRow?.classList.toggle('hidden', !needsQty);
    });
  });

  // ── Rafraîchissement licences ───────────────────────────────────────
  btnRefreshLicences?.addEventListener('click', chargerLicences);

  // ── Rafraîchissement clients ────────────────────────────────────────
  btnRefreshClients?.addEventListener('click', chargerTousLesClients);

  // ── Filtre clients ──────────────────────────────────────────────────
  clientsFilterInput?.addEventListener('input', () => {
    const f = clientsFilterInput.value.trim().toLowerCase();
    if (!f) { renderAllClientsTable(allClients); return; }
    renderAllClientsTable(allClients.filter(c =>
      (c.companyName || '').toLowerCase().includes(f) ||
      (c.email || '').toLowerCase().includes(f) ||
      (c.role || '').toLowerCase().includes(f) ||
      (c.typePack || '').toLowerCase().includes(f) ||
      (c.uid || '').toLowerCase().includes(f)
    ));
  });

  // ── Actions délégation sur tableau clients ──────────────────────────
  allClientsTableBody?.addEventListener('click', async (e) => {
    const destroyBtn = e.target.closest('[data-action="destruct-client"]');
    const validateBtn = e.target.closest('.btn-validate');
    const revokeBtn   = e.target.closest('.btn-revoke');

    if (destroyBtn) {
      const uid = destroyBtn.dataset.uid;
      ouvrirModalDestruction(uid, 'Action admin depuis tableau clients');
    } else if (validateBtn) {
      await modifierStatutCompte(validateBtn.dataset.uid, 'validate', validateBtn);
    } else if (revokeBtn) {
      await modifierStatutCompte(revokeBtn.dataset.uid, 'revoke', revokeBtn);
    }
  });

  // ── Recherche compte ────────────────────────────────────────────────
  btnSearchAccount?.addEventListener('click', rechercherCompte);
  accountSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') rechercherCompte();
  });

  // ── Actions délégation sur résultats de recherche ──────────────────
  accountResultsBody?.addEventListener('click', async (e) => {
    const validateBtn = e.target.closest('.btn-validate');
    const revokeBtn   = e.target.closest('.btn-revoke');
    if (validateBtn) await modifierStatutCompte(validateBtn.dataset.uid, 'validate', validateBtn);
    else if (revokeBtn) await modifierStatutCompte(revokeBtn.dataset.uid, 'revoke', revokeBtn);
  });

  // ── Alertes désinstallation : délégation ───────────────────────────
  uninstallAlertsContainer?.addEventListener('click', async (e) => {
    const destroyBtn  = e.target.closest('.btn-destroy-alert');
    const dismissBtn  = e.target.closest('.btn-dismiss-alert');

    if (destroyBtn) {
      const agentId = destroyBtn.dataset.agentId;
      ouvrirModalDestruction(agentId, 'Désinstallation forcée détectée');
    } else if (dismissBtn) {
      const alertId = dismissBtn.dataset.alertId;
      try {
        await set(ref(db, `uninstall_alerts/${alertId}/status`), 'treated');
      } catch (err) {
        console.error("[ADMIN SUPRÊME] — Ignorer alerte :", err);
      }
    }
  });

  // ── Modal destruction — Bouton Destruction Manuelle ────────────────
  btnDestructionManuelle?.addEventListener('click', () => {
    const target = destructionTargetId?.value.trim();
    const raison = destructionRaison?.value.trim();
    if (!target) {
      showMsg(destructionMessage, 'Saisissez un UID ou Device ID cible.', 'error');
      return;
    }
    ouvrirModalDestruction(target, raison || 'Commande manuelle admin');
  });

  // ── Modal destruction — Annuler ─────────────────────────────────────
  btnAnnulerDestruction?.addEventListener('click', () => {
    pendingDestructionTarget = null;
    pendingDestructionRaison = null;
    if (destructionConfirmInput) destructionConfirmInput.value = '';
    if (destructionConfirmHint) destructionConfirmHint.classList.add('hidden');
    modalDestructionConfirm?.classList.add('hidden');
  });

  // [NOUVEAU] ── Validation par frappe "DÉTRUIRE" ──────────────────────
  // Le bouton confirmer reste désactivé jusqu'à la saisie exacte
  destructionConfirmInput?.addEventListener('input', () => {
    const val    = (destructionConfirmInput.value || '').trim();
    const valide = val === 'DÉTRUIRE';

    if (valide) {
      destructionConfirmInput.classList.remove('border-slate-600', 'border-rose-500');
      destructionConfirmInput.classList.add('border-green-500');
      if (destructionConfirmHint) destructionConfirmHint.classList.add('hidden');
      if (btnConfirmerDestruction) {
        btnConfirmerDestruction.disabled  = false;
        btnConfirmerDestruction.className =
          'flex-1 px-4 py-3 bg-rose-700 hover:bg-rose-600 text-white rounded-xl text-sm ' +
          'font-bold transition-all cursor-pointer flex items-center justify-center gap-2';
      }
    } else if (val.length > 0) {
      destructionConfirmInput.classList.remove('border-slate-600', 'border-green-500');
      destructionConfirmInput.classList.add('border-rose-500');
      if (destructionConfirmHint) destructionConfirmHint.classList.remove('hidden');
      if (btnConfirmerDestruction) {
        btnConfirmerDestruction.disabled  = true;
        btnConfirmerDestruction.className =
          'flex-1 px-4 py-3 bg-slate-600 text-slate-400 rounded-xl text-sm ' +
          'font-bold transition-all cursor-not-allowed flex items-center justify-center gap-2';
      }
    } else {
      destructionConfirmInput.classList.remove('border-rose-500', 'border-green-500');
      destructionConfirmInput.classList.add('border-slate-600');
      if (destructionConfirmHint) destructionConfirmHint.classList.add('hidden');
    }
  });

  // ── Modal destruction — Confirmer ───────────────────────────────────
  btnConfirmerDestruction?.addEventListener('click', async () => {
    // Vérification finale côté JS (double sécurité)
    if ((destructionConfirmInput?.value || '').trim() !== 'DÉTRUIRE') return;
    if (!pendingDestructionTarget) return;

    modalDestructionConfirm?.classList.add('hidden');
    if (btnConfirmerDestruction) {
      btnConfirmerDestruction.disabled    = true;
      btnConfirmerDestruction.textContent = 'Envoi…';
    }

    await executerDestructionDistante(pendingDestructionTarget, pendingDestructionRaison);

    pendingDestructionTarget = null;
    pendingDestructionRaison = null;
    if (destructionConfirmInput) destructionConfirmInput.value = '';
    if (btnConfirmerDestruction) {
      btnConfirmerDestruction.disabled    = false;
      btnConfirmerDestruction.textContent = '💣 Confirmer la Destruction';
    }
  });

  // ── Fermeture modal avec Escape ──────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      modalDestructionConfirm?.classList.add('hidden');
      modalAideAdmin?.classList.add('hidden');
      pendingDestructionTarget = null;
      pendingDestructionRaison = null;
      if (destructionConfirmInput) destructionConfirmInput.value = '';
    }
  });

  // ── Aide administrateur ──────────────────────────────────────────────
  btnOuvrirAideAdmin?.addEventListener('click', () => modalAideAdmin?.classList.remove('hidden'));
  btnFermerAide?.addEventListener('click', ()     => modalAideAdmin?.classList.add('hidden'));
  modalAideAdmin?.addEventListener('click', (e) => {
    if (e.target === modalAideAdmin) modalAideAdmin.classList.add('hidden');
  });

  // ── Import de clés ──────────────────────────────────────────────────
  btnImport?.addEventListener('click', async () => {
    const type_pack = importTypePack.value;
    const rawKeys   = importKeys.value.trim();
    if (!rawKeys) { showMsg(importMessage, 'Collez au moins une clé.', 'error'); return; }

    const keys = rawKeys.split('\n').map(k => k.trim()).filter(Boolean);
    const body = { type_pack, keys };
    if (['suivi_eleve', 'suivi_etudiant'].includes(type_pack)) {
      body.quantite_agents = parseInt(importQuantiteAgents.value, 10) || 1;
    }

    btnImport.disabled    = true;
    btnImport.textContent = 'Import en cours…';

    try {
      const res  = await fetch('/api/admin/licence/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body:   JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        showMsg(importMessage, data.error || 'Erreur lors de l\'import.', 'error');
      } else {
        showMsg(importMessage, `✅ ${data.created} clé(s) créée(s), ${data.skipped} ignorée(s).`, 'success');
        importKeys.value = '';
        await chargerStats();
        await chargerLicences();
      }
    } catch (err) {
      showMsg(importMessage, 'Erreur réseau : ' + err.message, 'error');
    } finally {
      btnImport.disabled    = false;
      btnImport.textContent = 'Importer les clés';
    }
  });

  // ── Génération de clés ──────────────────────────────────────────────
  btnGenerate?.addEventListener('click', async () => {
    const type_pack = genTypePack.value;
    const count     = parseInt(genCount.value, 10) || 1;
    const body      = { type_pack, count };
    if (['suivi_eleve', 'suivi_etudiant'].includes(type_pack)) {
      body.quantite_agents = parseInt(genQuantiteAgents.value, 10) || 1;
    }

    btnGenerate.disabled    = true;
    btnGenerate.textContent = 'Génération…';
    genResult?.classList.add('hidden');

    try {
      const res  = await fetch('/api/admin/licence/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body:   JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        showMsg(genMessage, data.error || 'Erreur lors de la génération.', 'error');
      } else {
        showMsg(genMessage, `✅ ${data.count} clé(s) générée(s).`, 'success');
        if (genResult) {
          genResult.innerHTML = data.keys.map(k => `<div>${escapeHtml(k)}</div>`).join('');
          genResult.classList.remove('hidden');
        }
        await chargerStats();
        await chargerLicences();
      }
    } catch (err) {
      showMsg(genMessage, 'Erreur réseau : ' + err.message, 'error');
    } finally {
      btnGenerate.disabled    = false;
      btnGenerate.textContent = 'Générer les clés';
    }
  });

  // ── Cron d'expiration ────────────────────────────────────────────────
  btnCron?.addEventListener('click', async () => {
    btnCron.disabled    = true;
    btnCron.textContent = 'Vérification en cours…';

    try {
      const res  = await fetch('/api/admin/cron/check-expirations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        showMsg(cronMessage, data.error || 'Erreur lors du cron.', 'error');
      } else {
        showMsg(cronMessage,
          `✅ Terminé : ${data.traites} abonnement(s) expiré(s) traité(s), ${data.erreurs} erreur(s).`,
          'success'
        );
      }
    } catch (err) {
      showMsg(cronMessage, 'Erreur réseau : ' + err.message, 'error');
    } finally {
      btnCron.disabled    = false;
      btnCron.textContent = 'Lancer la vérification maintenant';
    }
  });

  // ── Notifications d'expiration ───────────────────────────────────────
  btnNotif?.addEventListener('click', async () => {
    btnNotif.disabled    = true;
    btnNotif.textContent = 'Envoi en cours…';

    try {
      const res  = await fetch('/api/admin/notifications/expiration', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (!res.ok) {
        showMsg(notifMessage, data.error || 'Erreur lors de l\'envoi.', 'error');
      } else {
        showMsg(notifMessage,
          `✅ ${data.envoyes} notification(s) créée(s) (J-7: ${data.j7}, J-3: ${data.j3}, J-1: ${data.j1}).`,
          'success'
        );
      }
    } catch (err) {
      showMsg(notifMessage, 'Erreur réseau : ' + err.message, 'error');
    } finally {
      btnNotif.disabled    = false;
      btnNotif.textContent = 'Envoyer les rappels d\'expiration';
    }
  });

  // ── Filtre dynamique historique licences ─────────────────────────────
  licenceFilterInput?.addEventListener('input', () => {
    const f = licenceFilterInput.value.trim().toLowerCase();
    if (!f) { renderLicencesTable(allLicences); return; }
    renderLicencesTable(allLicences.filter(lic =>
      (lic.cle_licence || '').toLowerCase().includes(f) ||
      (lic.type_pack   || '').toLowerCase().includes(f) ||
      (lic.statut      || '').toLowerCase().includes(f) ||
      (lic.utilise_par || '').toLowerCase().includes(f)
    ));
  });
}

// ══════════════════════════════════════════════════════════════════════════
// [ADMIN SUPRÊME] — Utilitaires
// ══════════════════════════════════════════════════════════════════════════

/** Formatte une date ISO en chaîne lisible fr-FR */
function formatterDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(typeof isoStr === 'number' ? isoStr : isoStr)
      .toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
  } catch { return String(isoStr); }
}

/** Nettoyage XSS pour les insertions HTML */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );
}

/** Affichage stylisé des messages avec fermeture automatique */
function showMsg(el, text, type) {
  if (!el) return;
  const styles = {
    success: 'bg-green-500/10 border border-green-500/30 text-green-300',
    error:   'bg-red-500/10 border border-red-500/30 text-red-300',
    info:    'bg-sky-500/10 border border-sky-500/30 text-sky-300',
  };
  el.textContent = text;
  el.className   = `rounded-lg px-4 py-3 text-sm ${styles[type] || styles.info}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 8000);
}
