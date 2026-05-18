/**
 * session-geo.js — Vérification géographique côté client (Congo)
 *
 * Appelle GET /api/geo/session pour vérifier que l'utilisateur
 * se connecte depuis une zone autorisée (bbox Congo).
 * En cas de refus, affiche un avertissement non bloquant.
 *
 * Ce module est importé en début de login.js et bootstrap.js.
 * Il ne bloque PAS la connexion — il log et avertit seulement.
 */

const GEO_SESSION_URL = '/api/geo/session';

/**
 * Vérifie la session géographique de l'utilisateur.
 * @returns {Promise<{ allowed: boolean, country?: string, message?: string }>}
 */
export async function verifierSessionGeo() {
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 6000);
    const res  = await fetch(GEO_SESSION_URL, {
      cache:  'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) return { allowed: true }; // En cas d'erreur serveur, on laisse passer

    const data = await res.json();

    if (!data.allowed) {
      console.warn('[session-geo] Accès hors zone Congo :', data.message);
      // Avertissement non bloquant dans la console
      // (le serveur gère le blocage réel sur les routes sensibles)
    }

    return data;
  } catch {
    // Réseau indisponible ou timeout → on laisse passer silencieusement
    return { allowed: true };
  }
}
