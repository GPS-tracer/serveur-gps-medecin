/**
 * antivol-sms-toggle.js
 *
 * Gère le toggle SMS antivol sur la page licence.html.
 * Lit l'état actuel depuis Firebase (companies/{uid}/alerts_sms)
 * et envoie PATCH /api/antivol/sms pour activer/désactiver.
 */

import { onAuthStateChanged, getIdToken } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { auth, db } from '../shared/firebase.js';

const btn      = document.getElementById('btnToggleSMSAntivol');
const label    = document.getElementById('smsStatusLabel');
const msgEl    = document.getElementById('smsToggleMessage');

if (!btn) {
  // Script chargé sur une page sans ce composant — ne rien faire
  throw new Error('antivol-sms-toggle: éléments DOM introuvables');
}

let token = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  token = await getIdToken(user);

  // Écoute temps réel de la préférence SMS dans Firebase
  onValue(ref(db, `companies/${user.uid}/alerts_sms`), (snap) => {
    const actif = snap.val() === true;
    appliquerEtatToggle(actif);
    btn.disabled = false;
  });

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;

    const etatActuel = btn.getAttribute('aria-checked') === 'true';
    const nouvelEtat = !etatActuel;

    afficherMessage('Mise à jour…', 'info');

    try {
      const res  = await fetch('/api/antivol/sms', {
        method:  'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ sms: nouvelEtat }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        appliquerEtatToggle(nouvelEtat);
        afficherMessage(data.message, 'success');
      } else {
        afficherMessage(data.error || 'Erreur lors de la mise à jour.', 'error');
      }
    } catch (err) {
      afficherMessage('Erreur réseau. Réessayez.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
});

function appliquerEtatToggle(actif) {
  btn.setAttribute('aria-checked', String(actif));
  btn.classList.toggle('bg-emerald-600', actif);
  btn.classList.toggle('bg-slate-600',   !actif);

  const thumb = btn.querySelector('span');
  if (thumb) {
    thumb.classList.toggle('translate-x-6', actif);
    thumb.classList.toggle('translate-x-1', !actif);
  }

  if (label) {
    label.textContent = actif ? 'Activé' : 'Désactivé';
    label.className   = actif
      ? 'text-xs text-emerald-400 font-semibold'
      : 'text-xs text-slate-400';
  }
}

function afficherMessage(texte, type) {
  if (!msgEl) return;
  msgEl.textContent = texte;
  msgEl.className   = [
    'text-xs mt-3',
    type === 'success' ? 'text-emerald-400' :
    type === 'error'   ? 'text-red-400'     :
                         'text-slate-400',
  ].join(' ');
  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 4000);
}
