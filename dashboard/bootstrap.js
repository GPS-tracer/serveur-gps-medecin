/**
 * Charge le tableau de bord uniquement lorsqu’un utilisateur est connecté
 * avec une adresse email vérifiée.
 * Affiche : "Bonjour [Nom société]" + indicateur vert "Connecté"
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { verifierSessionGeo } from "./session-geo.js";

verifierSessionGeo();

const root      = document.getElementById("dashboard-root");
const loadingEl = document.getElementById("auth-loading");

function log(msg) {
  console.log("[bootstrap]", msg);
  // Mettre à jour le texte de statut du splash sans toucher au spinner
  const statusEl = document.getElementById("splash-status");
  if (statusEl) statusEl.textContent = msg;
}

log("Connexion sécurisée établie, vérification de votre session...");

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
  let companyData = {};
  try {
    const snap = await get(ref(db, `companies/${user.uid}`));
    if (snap.exists()) {
      companyData = snap.val();
      companyName = companyData.companyName || null;
    }
  } catch (e) {
    console.warn("[bootstrap] Impossible de charger le nom de la société:", e.message);
  }

  // ── Injecter logo + nom dans la nouvelle sidebar ────────────
  injecterIdentiteSidebar(companyName || user.email.split('@')[0], companyData.logoUrl || null);

  // ── Charger le badge de statut du compte ────────────────────
  chargerBadgeCompte(user.uid);

  // ── Afficher le bandeau de bienvenue (dashboard-root) ───────
  renderWelcomeBanner(user.email, companyName);

  if (loadingEl) {
    loadingEl.hidden = true;
    loadingEl.style.display = "none";
  }
  if (root) root.hidden = false;

  await import("./app.js");
  log("Dashboard chargé.");
}, (err) => {
  log("Erreur d’authentification : " + (err.message || err));
});

/**
 * renderWelcomeBanner — désactivée dans le nouveau design.
 * L'identité est maintenant injectée directement dans la sidebar
 * via injecterIdentiteSidebar().
 */
function renderWelcomeBanner(_email, _companyName) {
  // No-op : remplacé par injecterIdentiteSidebar()
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * Injecte le logo et le nom de la société dans la sidebar.
 */
function injecterIdentiteSidebar(nom, logoUrl) {
  const nameEl    = document.getElementById('sidebarCompanyName');
  const logoImg   = document.getElementById('companyLogoImg');
  const logoFall  = document.getElementById('companyLogoFallback');

  if (nameEl) nameEl.textContent = nom;

  if (logoUrl && logoImg) {
    logoImg.src = logoUrl;
    logoImg.classList.remove('hidden');
    if (logoFall) logoFall.classList.add('hidden');
  }
}

/**
 * Charge le statut du compte et met à jour le badge dans la sidebar.
 */
async function chargerBadgeCompte(uid) {
  const badgeEl = document.getElementById('accountBadgeText');
  if (!badgeEl) return;

  try {
    const snap    = await get(ref(db, `companies/${uid}/licence`));
    const licence = snap.val() || {};
    const type    = licence.typePack || 'free';

    let texte, couleur;

    if (licence.est_illimite || type === 'illimite' ||
        type === 'abonnement_flotte' || type === 'abonnement_unite') {
      texte   = '✦ Version Pro — Illimité';
      couleur = 'text-emerald-400';
    } else if (type === 'suivi_eleve') {
      texte   = '🎒 Suivi Élève actif';
      couleur = 'text-cyan-400';
    } else if (type === 'suivi_etudiant') {
      texte   = '🎓 Suivi Étudiant actif';
      couleur = 'text-indigo-400';
    } else if ((licence.rapportsRestants || 0) > 0) {
      texte   = `📄 ${licence.rapportsRestants} impression(s) restante(s)`;
      couleur = 'text-sky-400';
    } else {
      texte   = '🆓 Gratuit — 1 impression/jour';
      couleur = 'text-slate-400';
    }

    badgeEl.textContent = texte;
    badgeEl.className   = `truncate text-xs ${couleur}`;
  } catch {
    badgeEl.textContent = 'Plan gratuit';
  }
}
