/**
 * admin.js — Panneau d'administration GPS Tracker
 *
 * Authentification par secret admin (header x-admin-secret).
 * Fonctionnalités :
 *  - Import / génération de clés Chariow
 *  - Déclenchement manuel du cron d'expiration
 *  - Envoi des notifications d'expiration (J-7, J-3, J-1)
 *  - Statistiques globales (sociétés, abonnements, clés)
 */

'use strict';

// ─── Éléments DOM ────────────────────────────────────────────
const adminAuth        = document.getElementById('adminAuth');
const adminPanel       = document.getElementById('adminPanel');
const adminSecretInput = document.getElementById('adminSecretInput');
const authError        = document.getElementById('authError');
const btnAdminAuth     = document.getElementById('btnAdminAuth');

// Stats
const statSocietes       = document.getElementById('statSocietes');
const statAbonnements    = document.getElementById('statAbonnements');
const statClesDisponibles = document.getElementById('statClesDisponibles');
const statClesUtilisees  = document.getElementById('statClesUtilisees');

// Import
const importTypePack      = document.getElementById('importTypePack');
const importKeys          = document.getElementById('importKeys');
const importMessage       = document.getElementById('importMessage');
const btnImport           = document.getElementById('btnImport');
const quantiteAgentsRow   = document.getElementById('quantiteAgentsRow');
const importQuantiteAgents = document.getElementById('importQuantiteAgents');

// Génération
const genTypePack       = document.getElementById('genTypePack');
const genCount          = document.getElementById('genCount');
const genMessage        = document.getElementById('genMessage');
const genResult         = document.getElementById('genResult');
const btnGenerate       = document.getElementById('btnGenerate');
const genQuantiteRow    = document.getElementById('genQuantiteRow');
const genQuantiteAgents = document.getElementById('genQuantiteAgents');

// Cron
const cronMessage = document.getElementById('cronMessage');
const btnCron     = document.getElementById('btnCron');

// Notifs
const notifMessage = document.getElementById('notifMessage');
const btnNotif     = document.getElementById('btnNotif');

let adminSecret = null;

// ─── Authentification admin ───────────────────────────────────
btnAdminAuth.addEventListener('click', async () => {
  const secret = adminSecretInput.value.trim();
  if (!secret) { showAuthError('Entrez le secret admin.'); return; }

  btnAdminAuth.disabled    = true;
  btnAdminAuth.textContent = 'Vérification…';

  // Vérification légère : on tente un appel admin réel
  try {
    const res = await fetch('/api/admin/cron/check-expirations', {
      method:  'POST',
      headers: { 'x-admin-secret': secret, 'Content-Type': 'application/json' },
    });

    if (res.status === 403) {
      showAuthError('Secret incorrect.');
      return;
    }

    // Secret valide
    adminSecret = secret;
    adminAuth.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    await chargerStats();

  } catch (err) {
    showAuthError('Erreur réseau : ' + err.message);
  } finally {
    btnAdminAuth.disabled    = false;
    btnAdminAuth.textContent = 'Accéder au panneau admin';
  }
});

adminSecretInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAdminAuth.click();
});

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

// ─── Afficher/masquer quantité agents ────────────────────────
[importTypePack, genTypePack].forEach((sel) => {
  sel.addEventListener('change', () => {
    const isUnite = sel.value === 'abonnement_unite';
    if (sel === importTypePack) quantiteAgentsRow.classList.toggle('hidden', !isUnite);
    if (sel === genTypePack)    genQuantiteRow.classList.toggle('hidden', !isUnite);
  });
});

// ─── Charger les statistiques globales ───────────────────────
async function chargerStats() {
  try {
    const res  = await fetch('/api/admin/stats', {
      headers: { 'x-admin-secret': adminSecret },
    });
    if (!res.ok) return;
    const data = await res.json();

    statSocietes.textContent        = data.totalSocietes        ?? '—';
    statAbonnements.textContent     = data.abonnementsActifs    ?? '—';
    statClesDisponibles.textContent = data.clesDisponibles      ?? '—';
    statClesUtilisees.textContent   = data.clesUtilisees        ?? '—';
  } catch {
    // Stats non critiques, on ignore silencieusement
  }
}

// ─── Import de clés ───────────────────────────────────────────
btnImport.addEventListener('click', async () => {
  const type_pack = importTypePack.value;
  const rawKeys   = importKeys.value.trim();

  if (!rawKeys) { showMsg(importMessage, 'Collez au moins une clé.', 'error'); return; }

  const keys = rawKeys.split('\n').map((k) => k.trim()).filter(Boolean);
  const body = { type_pack, keys };
  if (type_pack === 'abonnement_unite') {
    body.quantite_agents = parseInt(importQuantiteAgents.value, 10) || 1;
  }

  btnImport.disabled    = true;
  btnImport.textContent = 'Import en cours…';

  try {
    const res  = await fetch('/api/admin/licence/import', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': adminSecret },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(importMessage, data.error || 'Erreur import.', 'error');
    } else {
      showMsg(importMessage,
        `✅ ${data.created} clé(s) créée(s), ${data.skipped} ignorée(s) (déjà existantes).`,
        'success'
      );
      importKeys.value = '';
      await chargerStats();
    }
  } catch (err) {
    showMsg(importMessage, 'Erreur réseau : ' + err.message, 'error');
  } finally {
    btnImport.disabled    = false;
    btnImport.textContent = 'Importer les clés';
  }
});

// ─── Génération de clés de test ───────────────────────────────
btnGenerate.addEventListener('click', async () => {
  const type_pack = genTypePack.value;
  const count     = parseInt(genCount.value, 10) || 1;
  const body      = { type_pack, count };
  if (type_pack === 'abonnement_unite') {
    body.quantite_agents = parseInt(genQuantiteAgents.value, 10) || 1;
  }

  btnGenerate.disabled    = true;
  btnGenerate.textContent = 'Génération…';
  genResult.classList.add('hidden');

  try {
    const res  = await fetch('/api/admin/licence/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': adminSecret },
      body:    JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(genMessage, data.error || 'Erreur génération.', 'error');
    } else {
      showMsg(genMessage, `✅ ${data.count} clé(s) générée(s).`, 'success');
      genResult.innerHTML = data.keys.map((k) => `<div>${k}</div>`).join('');
      genResult.classList.remove('hidden');
      await chargerStats();
    }
  } catch (err) {
    showMsg(genMessage, 'Erreur réseau : ' + err.message, 'error');
  } finally {
    btnGenerate.disabled    = false;
    btnGenerate.textContent = 'Générer les clés';
  }
});

// ─── Cron d'expiration manuel ─────────────────────────────────
btnCron.addEventListener('click', async () => {
  btnCron.disabled    = true;
  btnCron.textContent = 'Vérification en cours…';

  try {
    const res  = await fetch('/api/admin/cron/check-expirations', {
      method:  'POST',
      headers: { 'x-admin-secret': adminSecret },
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(cronMessage, data.error || 'Erreur.', 'error');
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

// ─── Notifications d'expiration ───────────────────────────────
btnNotif.addEventListener('click', async () => {
  btnNotif.disabled    = true;
  btnNotif.textContent = 'Envoi en cours…';

  try {
    const res  = await fetch('/api/admin/notifications/expiration', {
      method:  'POST',
      headers: { 'x-admin-secret': adminSecret },
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(notifMessage, data.error || 'Erreur.', 'error');
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

// ─── Helper messages ──────────────────────────────────────────
function showMsg(el, text, type) {
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
