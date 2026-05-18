/**
 * splash-wake.js — Attend que le serveur Express (Render) soit réveillé
 * avant de lancer Firebase Auth.
 *
 * Render Free Tier endort le service après ~15 min d'inactivité.
 * Le cold start peut prendre 30–50 secondes.
 * Ce module ping GET /api/health en boucle jusqu'à obtenir une réponse 200.
 *
 * @param {{ maxAttempts?: number, intervalMs?: number, requestTimeoutMs?: number, onStatus?: (msg: string) => void }} opts
 * @returns {Promise<boolean>}  true si le serveur a répondu, false si timeout
 */
export async function waitForServerWake(opts = {}) {
  const maxAttempts      = opts.maxAttempts      ?? 25;
  const intervalMs       = opts.intervalMs       ?? 2000;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 12000;
  const onStatus         = opts.onStatus         ?? (() => {});

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onStatus(
      attempt === 1
        ? "Connexion au serveur…"
        : `Réveil du serveur… (${attempt}/${maxAttempts})`
    );

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

      const res = await fetch("/api/health", {
        method: "GET",
        cache:  "no-store",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) {
        onStatus("Serveur prêt.");
        return true;
      }
    } catch {
      // Render endormi ou réseau lent — on réessaie
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  onStatus("Serveur lent — chargement du tableau de bord quand même…");
  return false;
}
