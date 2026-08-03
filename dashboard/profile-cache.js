/**
 * profile-cache.js — Cache partagé du profil utilisateur Firebase
 *
 * Évite les lectures RTDB multiples sur la même page.
 * Un seul get() par session — toutes les autres lectures utilisent le cache.
 *
 * Usage :
 *   import { getProfile } from './profile-cache.js';
 *   const profile = await getProfile(uid);
 *   // profile.accountType, profile.role, profile.licence, etc.
 */

import { ref, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';
import { db } from '../shared/firebase.js';
import { fusionnerProfil } from './roles.js';

/** Cache en mémoire — clé = uid */
const _cache = new Map();

/** Listeners en attente (évite les requêtes parallèles pour le même uid) */
const _pending = new Map();

/**
 * Retourne le profil Firebase d'un utilisateur.
 * - Première lecture : fetch RTDB + mise en cache
 * - Lectures suivantes : cache mémoire (instantané)
 *
 * @param {string} uid
 * @param {boolean} [forceRefresh=false] — force une nouvelle lecture
 * @returns {Promise<object>} profil fusionné
 */
export async function getProfile(uid, forceRefresh = false) {
  if (!uid) return {};

  if (!forceRefresh && _cache.has(uid)) {
    return _cache.get(uid);
  }

  // Si une requête est déjà en cours pour ce uid, on attend son résultat
  if (_pending.has(uid)) {
    return _pending.get(uid);
  }

  const promise = get(ref(db, `companies/${uid}`))
    .then((snap) => {
      const raw     = snap.val() || {};
      const profile = fusionnerProfil(raw);
      _cache.set(uid, profile);
      _pending.delete(uid);
      return profile;
    })
    .catch((err) => {
      console.warn('[profile-cache] Erreur lecture profil:', err.message);
      _pending.delete(uid);
      return {};
    });

  _pending.set(uid, promise);
  return promise;
}

/**
 * Met à jour le cache local sans refaire de requête Firebase.
 * Utile après une modification de profil (ex: isDeviceOwner).
 * @param {string} uid
 * @param {object} patch — champs à mettre à jour
 */
export function patchProfile(uid, patch) {
  if (!uid) return;
  const current = _cache.get(uid) || {};
  _cache.set(uid, { ...current, ...patch });
}

/**
 * Vide le cache pour un uid (ex: déconnexion).
 * @param {string} [uid] — si omis, vide tout le cache
 */
export function clearProfile(uid) {
  if (uid) _cache.delete(uid);
  else     _cache.clear();
}
