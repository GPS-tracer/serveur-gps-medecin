/**
 * admin.js — Panneau d'administration GPS Tracker
 * 
 * [ADMIN SUPRÊME] — Version ultra-sécurisée avec authentification unifiée,
 * vérification stricte du rôle superadmin dans Firebase RTDB, utilisation de jetons
 * Firebase ID Token (Bearer) pour les requêtes backend, et widgets de supervision en temps réel.
 */

// [ADMIN SUPRÊME] — Importations des dépendances Firebase (SDK modulaire) et de la configuration partagée
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { genererTableauAdminChariowHtml } from './chariow-paiement.js';

// [ADMIN SUPRÊME] — Récupération des éléments DOM pour la supervision et le catalogue
const adminCatalogueChariow = document.getElementById('adminCatalogueChariow');
const adminPanel       = document.getElementById('adminPanel');

// [ADMIN SUPRÊME] — Récupération des éléments DOM pour l'affichage des statistiques globales
const statSocietes       = document.getElementById('statSocietes');
const statAbonnements    = document.getElementById('statAbonnements');
const statClesDisponibles = document.getElementById('statClesDisponibles');
const statClesUtilisees  = document.getElementById('statClesUtilisees');

// [ADMIN SUPRÊME] — Récupération des éléments DOM pour la section Importation de clés Chariow
const importTypePack      = document.getElementById('importTypePack');
const importKeys          = document.getElementById('importKeys');
const importMessage       = document.getElementById('importMessage');
const btnImport           = document.getElementById('btnImport');
const quantiteAgentsRow   = document.getElementById('quantiteAgentsRow');
const importQuantiteAgents = document.getElementById('importQuantiteAgents');

// [ADMIN SUPRÊME] — Récupération des éléments DOM pour la section Génération de clés de test
const genTypePack       = document.getElementById('genTypePack');
const genCount          = document.getElementById('genCount');
const genMessage        = document.getElementById('genMessage');
const genResult         = document.getElementById('genResult');
const btnGenerate       = document.getElementById('btnGenerate');
const genQuantiteRow    = document.getElementById('genQuantiteRow');
const genQuantiteAgents = document.getElementById('genQuantiteAgents');

// [ADMIN SUPRÊME] — Récupération des éléments DOM pour la section Cron manuel
const cronMessage = document.getElementById('cronMessage');
const btnCron     = document.getElementById('btnCron');

// [ADMIN SUPRÊME] — Récupération des éléments DOM pour la section Notifications d'expiration
const notifMessage = document.getElementById('notifMessage');
const btnNotif     = document.getElementById('btnNotif');

// [ADMIN SUPRÊME] — Récupération des nouveaux éléments DOM de l'Administrateur Suprême (sécurité, supervision, gestion)
const securityShield       = document.getElementById('securityShield');
const pingStatus           = document.getElementById('pingStatus');
const accountSearchInput   = document.getElementById('accountSearchInput');
const btnSearchAccount     = document.getElementById('btnSearchAccount');
const searchMessage        = document.getElementById('searchMessage');
const accountSearchResults = document.getElementById('accountSearchResults');
const accountResultsBody   = document.getElementById('accountResultsBody');
const licenceFilterInput   = document.getElementById('licenceFilterInput');
const btnRefreshLicences   = document.getElementById('btnRefreshLicences');
const licencesTableBody    = document.getElementById('licencesTableBody');

// [ADMIN SUPRÊME] — Variables d'état globales pour conserver le jeton d'authentification et les licences chargées
let adminToken = null;
let allLicences = [];

// [ADMIN SUPRÊME] — Affichage ou masquage dynamique de la quantité d'agents requis pour les packs spécifiques
[importTypePack, genTypePack].forEach((sel) => {
  sel.addEventListener('change', () => {
    const needsQty = ['suivi_eleve', 'suivi_etudiant'].includes(sel.value);
    if (sel === importTypePack) quantiteAgentsRow.classList.toggle('hidden', !needsQty);
    if (sel === genTypePack)    genQuantiteRow.classList.toggle('hidden', !needsQty);
  });
});

// [ADMIN SUPRÊME] — Écouteur d'état Firebase Auth avec validation obligatoire du rôle 'superadmin' dans la base RTDB
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    console.log("[ADMIN SUPRÊME] — Utilisateur non connecté. Redirection vers la page de connexion.");
    window.location.replace('login.html?redirect=admin.html');
    return;
  }
  
  if (!user.emailVerified) {
    console.log("[ADMIN SUPRÊME] — Email non validé. Redirection et déconnexion.");
    const { deconnecter } = await import("./deconnexion.js");
    await deconnecter("login.html");
    return;
  }

  try {
    // Lecture directe du nœud profil société dans la base de données temps réel
    const snap = await get(ref(db, `companies/${user.uid}`));
    if (!snap.exists()) {
      console.log("[ADMIN SUPRÊME] — Aucun profil de société existant dans RTDB. Accès refusé.");
      window.location.replace('index.html');
      return;
    }

    const companyData = snap.val();
    if (companyData.role !== 'superadmin') {
      console.log("[ADMIN SUPRÊME] — Rôle insuffisant (" + (companyData.role || 'aucun') + "). Redirection vers le tableau de bord standard.");
      window.location.replace('index.html');
      return;
    }

    // Récupération du jeton d'identité Firebase pour authentifier les appels API
    adminToken = await user.getIdToken();
    console.log("[ADMIN SUPRÊME] — Accès autorisé et authentifié.");

    // Retrait en douceur de l'écran de garde de sécurité
    if (securityShield) {
      securityShield.classList.add('opacity-0');
      securityShield.classList.add('pointer-events-none');
      setTimeout(() => {
        securityShield.classList.add('hidden');
      }, 500);
    }

    // Initialisation complète de l'interface d'administration
    initialiserPanneauAdmin();

  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Erreur lors de la validation des accès :", err);
    window.location.replace('index.html');
  }
});

// [ADMIN SUPRÊME] — Fonction d'initialisation centrale pour charger toutes les données de l'interface
function initialiserPanneauAdmin() {
  if (adminCatalogueChariow) {
    adminCatalogueChariow.innerHTML = genererTableauAdminChariowHtml();
  }

  // Chargement des données statistiques et de l'historique global
  chargerStats();
  chargerLicences();

  // Association de tous les écouteurs d'événements
  configurerEcouteurs();

  // Démarrage de la surveillance de la latence du serveur en temps réel
  demarrerSupervisionServeur();
}

// [ADMIN SUPRÊME] — Lancement du processus de ping toutes les 15 secondes pour mesurer la latence du serveur principal Render
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
            <span class="inline-block h-3.5 w-3.5 bg-emerald-500 rounded-full" id="pingIndicator"></span>
            Serveur Connecté (${latence}ms)
          `;
        }
      } else {
        if (pingStatus) {
          pingStatus.innerHTML = `
            <span class="inline-block h-3.5 w-3.5 bg-yellow-500 rounded-full animate-pulse" id="pingIndicator"></span>
            Réponse serveur anormale (${res.status})
          `;
        }
      }
    } catch (err) {
      if (pingStatus) {
        pingStatus.innerHTML = `
          <span class="inline-block h-3.5 w-3.5 bg-red-500 rounded-full animate-pulse" id="pingIndicator"></span>
          Serveur Inaccessible
        `;
      }
    }
  }

  executerPing();
  setInterval(executerPing, 15000);
}

// [ADMIN SUPRÊME] — Appel à l'API sécurisée pour récupérer les statistiques d'utilisation globales
async function chargerStats() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) return;
    const data = await res.json();

    if (statSocietes) statSocietes.textContent = data.totalSocietes ?? '—';
    if (statAbonnements) statAbonnements.textContent = data.abonnementsActifs ?? '—';
    if (statClesDisponibles) statClesDisponibles.textContent = data.clesDisponibles ?? '—';
    if (statClesUtilisees) statClesUtilisees.textContent = data.clesUtilisees ?? '—';
  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Impossible de récupérer les statistiques :", err);
  }
}

// [ADMIN SUPRÊME] — Chargement de la liste historique de l'ensemble des licences enregistrées dans Firestore
async function chargerLicences() {
  if (licencesTableBody) {
    licencesTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="p-6 text-center text-slate-500 font-medium">Chargement des licences...</td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/admin/licences', {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    });
    if (!res.ok) {
      throw new Error(`Erreur HTTP ${res.status}`);
    }
    const data = await res.json();
    
    if (data.success && Array.isArray(data.licences)) {
      allLicences = data.licences;
      renderLicencesTable(allLicences);
    } else {
      throw new Error("Format de réponse invalide");
    }
  } catch (err) {
    console.error("[ADMIN SUPRÊME] — Impossible de récupérer la liste des licences :", err);
    if (licencesTableBody) {
      licencesTableBody.innerHTML = `
        <tr>
          <td colspan="6" class="p-6 text-center text-red-400 font-medium">⚠️ Erreur lors du chargement des licences</td>
        </tr>
      `;
    }
  }
}

// [ADMIN SUPRÊME] — Affichage formaté des licences dans le tableau HTML avec des badges et boutons d'action
function renderLicencesTable(licences) {
  if (!licencesTableBody) return;

  if (licences.length === 0) {
    licencesTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="p-6 text-center text-slate-400 font-medium">Aucune clé de licence enregistrée.</td>
      </tr>
    `;
    return;
  }

  const translatedPacks = {
    illimite: 'Accès Illimité',
    abonnement_flotte: 'Forfait Flotte B2B',
    suivi_eleve: 'Suivi Élève',
    suivi_etudiant: 'Suivi Étudiant'
  };

  licencesTableBody.innerHTML = licences.map(lic => {
    const packLabel = translatedPacks[lic.type_pack] || lic.type_pack;
    const isUsed = lic.statut === 'utilise';
    
    const statutBadge = isUsed 
      ? `<span class="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full font-bold text-xs">Utilisé</span>`
      : `<span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-bold text-xs">Disponible</span>`;
      
    const formattedAct = lic.date_activation ? formatterDate(lic.date_activation) : '—';
    const formattedExp = lic.date_expiration ? formatterDate(lic.date_expiration) : '—';
    const client = lic.utilise_par || '—';

    return `
      <tr class="hover:bg-slate-800/40 border-b border-slate-800/60 transition-colors">
        <td class="p-3 font-mono font-bold text-slate-200 select-all">${escapeHtml(lic.cle_licence)}</td>
        <td class="p-3 font-medium text-slate-300">${escapeHtml(packLabel)}</td>
        <td class="p-3">${statutBadge}</td>
        <td class="p-3 font-mono text-slate-400 select-all">${escapeHtml(client)}</td>
        <td class="p-3 text-slate-400">${escapeHtml(formattedAct)}</td>
        <td class="p-3 text-slate-400">${escapeHtml(formattedExp)}</td>
      </tr>
    `;
  }).join('');
}

// [ADMIN SUPRÊME] — Recherche de comptes utilisateurs dans Firebase par email, nom ou UID
async function rechercherCompte() {
  if (!accountSearchInput) return;
  const query = accountSearchInput.value.trim();
  if (!query) {
    showMsg(searchMessage, 'Saisissez un critère de recherche (email, UID ou nom).', 'error');
    return;
  }

  if (btnSearchAccount) {
    btnSearchAccount.disabled = true;
    btnSearchAccount.textContent = 'Recherche…';
  }
  if (searchMessage) searchMessage.classList.add('hidden');
  if (accountSearchResults) accountSearchResults.classList.add('hidden');

  try {
    const res = await fetch(`/api/admin/accounts/search?query=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
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
    if (btnSearchAccount) {
      btnSearchAccount.disabled = false;
      btnSearchAccount.textContent = 'Rechercher';
    }
  }
}

// [ADMIN SUPRÊME] — Rendu HTML dynamique de la liste des comptes trouvés après recherche
function renderSearchResults(accounts) {
  if (!accountResultsBody) return;

  if (accounts.length === 0) {
    accountResultsBody.innerHTML = `
      <tr>
        <td colspan="4" class="p-6 text-center text-slate-400 font-medium">Aucun compte trouvé correspondant à la recherche.</td>
      </tr>
    `;
    if (accountSearchResults) accountSearchResults.classList.remove('hidden');
    return;
  }

  accountResultsBody.innerHTML = accounts.map(acc => {
    return `
      <tr class="hover:bg-slate-800/40 border-b border-slate-800 transition-colors">
        <td class="p-3">
          <div class="font-semibold text-slate-100">${escapeHtml(acc.companyName)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(acc.email)}</div>
        </td>
        <td class="p-3 font-mono text-slate-400 select-all">${escapeHtml(acc.uid)}</td>
        <td class="p-3">
          <div class="flex items-center gap-2">
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
            ${!acc.validated ? `
              <button data-uid="${acc.uid}" class="btn-validate px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold transition-colors">
                Valider
              </button>
            ` : `
              <button data-uid="${acc.uid}" class="btn-revoke px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold transition-colors">
                Révoquer
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (accountSearchResults) accountSearchResults.classList.remove('hidden');
}

// [ADMIN SUPRÊME] — Action sécurisée de modification de rôle (Validation en Partenaire ou Révocation en Société standard)
async function modifierStatutCompte(companyId, action, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'En cours…';
  if (searchMessage) searchMessage.classList.add('hidden');

  try {
    const endpoint = `/api/admin/accounts/${action}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ companyId })
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(searchMessage, data.error || 'Une erreur est survenue lors de l\'opération.', 'error');
    } else {
      showMsg(searchMessage, `✅ ${data.message || 'Action effectuée avec succès.'}`, 'success');
      
      // Rafraîchir les statistiques et relancer la recherche pour actualiser l'état
      await chargerStats();
      await rechercherCompte();
    }
  } catch (err) {
    showMsg(searchMessage, 'Erreur réseau : ' + err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

// [ADMIN SUPRÊME] — Configuration des boutons d'administration de licences et de tâches
function configurerEcouteurs() {
  
  // Rafraîchissement manuel de l'historique des clés
  if (btnRefreshLicences) {
    btnRefreshLicences.addEventListener('click', chargerLicences);
  }

  // Lancement manuel de la recherche de compte
  if (btnSearchAccount) {
    btnSearchAccount.addEventListener('click', rechercherCompte);
  }
  
  if (accountSearchInput) {
    accountSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') rechercherCompte();
    });
  }

  // Écouteur d'action de validation / révocation par délégation d'événement sur la table des résultats
  if (accountResultsBody) {
    accountResultsBody.addEventListener('click', async (e) => {
      const validateBtn = e.target.closest('.btn-validate');
      const revokeBtn   = e.target.closest('.btn-revoke');
      
      if (validateBtn) {
        const companyId = validateBtn.dataset.uid;
        await modifierStatutCompte(companyId, 'validate', validateBtn);
      } else if (revokeBtn) {
        const companyId = revokeBtn.dataset.uid;
        await modifierStatutCompte(companyId, 'revoke', revokeBtn);
      }
    });
  }

  // Import de clés de licences collées par l'admin
  if (btnImport) {
    btnImport.addEventListener('click', async () => {
      const type_pack = importTypePack.value;
      const rawKeys   = importKeys.value.trim();

      if (!rawKeys) { showMsg(importMessage, 'Collez au moins une clé.', 'error'); return; }

      const keys = rawKeys.split('\n').map((k) => k.trim()).filter(Boolean);
      const body = { type_pack, keys };
      if (['suivi_eleve', 'suivi_etudiant'].includes(type_pack)) {
        body.quantite_agents = parseInt(importQuantiteAgents.value, 10) || 1;
      }

      btnImport.disabled    = true;
      btnImport.textContent = 'Import en cours…';

      try {
        const res  = await fetch('/api/admin/licence/import', {
          method:  'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${adminToken}` 
          },
          body:    JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          showMsg(importMessage, data.error || 'Erreur lors de l\'import.', 'error');
        } else {
          showMsg(importMessage,
            `✅ ${data.created} clé(s) créée(s), ${data.skipped} ignorée(s) (déjà existantes).`,
            'success'
          );
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
  }

  // Génération automatique de clés de tests
  if (btnGenerate) {
    btnGenerate.addEventListener('click', async () => {
      const type_pack = genTypePack.value;
      const count     = parseInt(genCount.value, 10) || 1;
      const body      = { type_pack, count };
      if (['suivi_eleve', 'suivi_etudiant'].includes(type_pack)) {
        body.quantite_agents = parseInt(genQuantiteAgents.value, 10) || 1;
      }

      btnGenerate.disabled    = true;
      btnGenerate.textContent = 'Génération…';
      if (genResult) genResult.classList.add('hidden');

      try {
        const res  = await fetch('/api/admin/licence/generate', {
          method:  'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${adminToken}` 
          },
          body:    JSON.stringify(body),
        });
        const data = await res.json();

        if (!res.ok) {
          showMsg(genMessage, data.error || 'Erreur lors de la génération.', 'error');
        } else {
          showMsg(genMessage, `✅ ${data.count} clé(s) générée(s).`, 'success');
          if (genResult) {
            genResult.innerHTML = data.keys.map((k) => `<div>${k}</div>`).join('');
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
  }

  // Déclenchement manuel du cron d'expiration
  if (btnCron) {
    btnCron.addEventListener('click', async () => {
      btnCron.disabled    = true;
      btnCron.textContent = 'Vérification en cours…';

      try {
        const res  = await fetch('/api/admin/cron/check-expirations', {
          method:  'POST',
          headers: { 
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
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
  }

  // Déclenchement manuel de l'envoi des e-mails d'alerte d'expiration
  if (btnNotif) {
    btnNotif.addEventListener('click', async () => {
      btnNotif.disabled    = true;
      btnNotif.textContent = 'Envoi en cours…';

      try {
        const res  = await fetch('/api/admin/notifications/expiration', {
          method:  'POST',
          headers: { 
            'Authorization': `Bearer ${adminToken}`,
            'Content-Type': 'application/json'
          },
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
  }

  // Filtre dynamique textuel de l'historique des clés
  if (licenceFilterInput) {
    licenceFilterInput.addEventListener('input', () => {
      const filter = licenceFilterInput.value.trim().toLowerCase();
      if (!filter) {
        renderLicencesTable(allLicences);
        return;
      }
      
      const filtered = allLicences.filter(lic => {
        const cle = (lic.cle_licence || '').toLowerCase();
        const type = (lic.type_pack || '').toLowerCase();
        const statut = (lic.statut || '').toLowerCase();
        const user = (lic.utilise_par || '').toLowerCase();
        
        return cle.includes(filter) || type.includes(filter) || statut.includes(filter) || user.includes(filter);
      });
      
      renderLicencesTable(filtered);
    });
  }
}

// [ADMIN SUPRÊME] — Formateur de date ISO en chaîne lisible locale (fr-FR)
function formatterDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoStr;
  }
}

// [ADMIN SUPRÊME] — Nettoyage XSS pour sécuriser les insertions HTML de données provenant d'API externes
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function (match) {
    const escapes = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return escapes[match];
  });
}

// [ADMIN SUPRÊME] — Affichage premium des messages avec stylisation responsive et fermeture automatique
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
