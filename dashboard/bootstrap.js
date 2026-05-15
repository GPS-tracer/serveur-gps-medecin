/**
 * Loads the dashboard only when Firebase Auth has a signed-in user with verified email.
 * Affiche : "Bonjour [Nom société]" + indicateur vert "Connecté"
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";

const root      = document.getElementById("dashboard-root");
const loadingEl = document.getElementById("auth-loading");

function log(msg) {
  console.log("[bootstrap]", msg);
  if (loadingEl) loadingEl.textContent = msg;
}

log("Firebase auth initialisé, en attente de session...");

let appStarted = false;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    log("Aucun utilisateur connecté → redirection vers login.html");
    appStarted = false;
    window.location.replace("login.html");
    return;
  }

  if (!user.emailVerified) {
    log("Email non vérifié → redirection vers login.html");
    appStarted = false;
    await auth.signOut();
    window.location.replace("login.html");
    return;
  }

  log("Utilisateur connecté : " + user.email);

  if (appStarted) return;
  appStarted = true;

  // ── Récupérer le nom de la société depuis Firebase ──────────
  let companyName = null;
  try {
    const snap = await get(ref(db, `companies/${user.uid}`));
    if (snap.exists()) {
      companyName = snap.val().companyName || null;
    }
  } catch (e) {
    console.warn("[bootstrap] Impossible de charger le nom de la société:", e.message);
  }

  // ── Afficher le bandeau de bienvenue ────────────────────────
  renderWelcomeBanner(user.email, companyName);

  if (loadingEl) {
    loadingEl.hidden = true;
    loadingEl.style.display = "none";
  }
  if (root) root.hidden = false;

  await import("./app.js");
  log("Dashboard chargé.");
}, (err) => {
  log("Erreur Auth : " + (err.message || err));
});

/**
 * Injecte dans le header :
 *  - "Bonjour, [Nom société]" (ou email si nom inconnu)
 *  - Badge vert "● Connecté"
 */
function renderWelcomeBanner(email, companyName) {
  const headerRow = document.querySelector(".sidebar-header__row");
  if (!headerRow) return;

  // Supprimer un éventuel bandeau existant
  document.getElementById("welcomeBanner")?.remove();

  const label = companyName
    ? companyName
    : email.split("@")[0]; // fallback : partie locale de l'email

  const banner = document.createElement("div");
  banner.id = "welcomeBanner";
  banner.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: linear-gradient(135deg, #0f2027, #1a3a4a);
    border: 1px solid #0ea5e9;
    border-radius: 10px;
    padding: 10px 16px;
    margin: 0 0 12px 0;
    gap: 12px;
  `;

  banner.innerHTML = `
    <!-- Salutation -->
    <div style="display:flex; align-items:center; gap:10px; min-width:0;">
      <span style="font-size:22px;">👋</span>
      <div style="min-width:0;">
        <p style="margin:0; font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em;">Bienvenue</p>
        <p style="margin:0; font-size:15px; font-weight:700; color:#f1f5f9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          Bonjour, <span style="color:#38bdf8;">${escapeHtml(label)}</span>
        </p>
      </div>
    </div>

    <!-- Badge connecté -->
    <div id="connectionBadge" style="
      display: flex;
      align-items: center;
      gap: 7px;
      background: #052e16;
      border: 1px solid #16a34a;
      border-radius: 999px;
      padding: 5px 12px;
      flex-shrink: 0;
      cursor: default;
    " title="Session active">
      <span id="connectionDot" style="
        width: 10px; height: 10px;
        background: #22c55e;
        border-radius: 50%;
        display: inline-block;
        box-shadow: 0 0 0 0 rgba(34,197,94,.6);
        animation: pulse-green 2s infinite;
      "></span>
      <span style="font-size:12px; font-weight:600; color:#4ade80; white-space:nowrap;">Connecté</span>
    </div>
  `;

  // Animation pulse CSS injectée une seule fois
  if (!document.getElementById("pulse-style")) {
    const style = document.createElement("style");
    style.id = "pulse-style";
    style.textContent = `
      @keyframes pulse-green {
        0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.6); }
        70%  { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
        100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
      }
    `;
    document.head.appendChild(style);
  }

  // Insérer le bandeau en haut de la sidebar, avant le headerRow
  headerRow.parentElement.insertBefore(banner, headerRow);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
