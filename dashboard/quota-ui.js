/**
 * Bannières quota / upsell — sans dépendre de fleet.js.
 */
import { auth } from '../shared/firebase.js';
import { genererListeUpsellHtml } from './chariow-paiement.js';

/**
 * Affiche le bloc « quota épuisé » avec liens vers le catalogue (pas navigation forcée Chariow).
 */
export function showQuotaEpuise(errData, ancre = null) {
  document.getElementById('quotaEpuiseBlock')?.remove();
  const uid = auth.currentUser?.uid;
  const message = errData?.message
    ? String(errData.message)
    : 'Vous avez épuisé votre impression gratuite pour aujourd\'hui.';
  const offresHtml = `<div class="offer-upsell">${genererListeUpsellHtml(uid)}</div>`;

  const div = document.createElement('div');
  div.id = 'quotaEpuiseBlock';
  div.className = 'my-4 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 text-sm';
  div.innerHTML = `
    <div class="flex items-start justify-between gap-2 mb-3">
      <p class="text-amber-300 font-semibold leading-snug">⏳ ${escapeHtml(message)}</p>
      <button type="button" onclick="document.getElementById('quotaEpuiseBlock').remove()"
        class="text-slate-500 hover:text-slate-300 text-lg leading-none flex-shrink-0" aria-label="Fermer">✕</button>
    </div>
    <p class="text-slate-400 text-xs mb-3">
      Choisissez une offre ci-dessous ou sur la page
      <a href="licence.html" class="text-sky-400 hover:underline">Abonnements</a>,
      puis payez sur Chariow.
    </p>
    <div class="flex flex-col gap-2">${offresHtml}</div>`;

  if (ancre?.parentNode) ancre.parentNode.insertBefore(div, ancre.nextSibling);
  else (document.querySelector('.app-main') || document.querySelector('.container') || document.body).prepend(div);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
