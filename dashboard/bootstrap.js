/**
 * Charge le tableau de bord uniquement lorsqu’un utilisateur est connecté
 * avec une adresse email vérifiée.
 * Affiche : "Bonjour [Nom société]" + indicateur vert "Connecté"
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { auth, db } from "../shared/firebase.js";
import { verifierSessionGeo } from "./session-geo.js";
import { estSuperadmin, fusionnerProfil } from "./roles.js";
import { getProfile, clearProfile } from "./profile-cache.js";

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
    const { deconnecter } = await import("./deconnexion.js");
    await deconnecter("login.html");
    return;
  }

  log("Utilisateur connecté : " + user.email);

  if (appStarted) return;
  appStarted = true;

  // ── Récupérer le profil depuis la base RTDB (companies/ = source unique) ──
  let companyName = null;
  let companyData = {};
  try {
    // Utiliser le cache partagé — évite la double lecture avec boot-app.js
    companyData = await getProfile(user.uid);
    companyName = companyData.companyName || null;

    if (await estSuperadmin(user)) {
      const page = window.location.pathname.split('/').pop();
      if (page !== 'admin.html') {
        window.location.replace('admin.html');
        return;
      }
      return;
    }
  } catch (e) {
    console.warn("[bootstrap] Impossible de charger le profil:", e.message);
  }

  // ── Injecter logo + nom dans la nouvelle sidebar ────────────
  injecterIdentiteSidebar(companyName || user.email.split('@')[0], companyData.logoUrl || null);

  // ── Adapter le vocabulaire sidebar selon le type de compte ──
  adapterVocabulaireSidebar(companyData);

  // ── Statut bonus / plan gratuit (décrémente 1 crédit bonus par visite) ──
  await chargerStatutUtilisateur(user);

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
 * Adapte les labels de la sidebar selon le type de compte.
 * - Particulier : "Mon appareil" au lieu de "Ma Flotte"
 * - Suivi élève : "Mes élèves"
 * - Suivi étudiant : "Mes étudiants"
 */
function adapterVocabulaireSidebar(companyData) {
  const accountType      = companyData.accountType || companyData.role || 'company';
  const typeAbonnement   = companyData.licence?.type_abonnement || null;

  // Déterminer le label et l'icône du lien "flotte"
  let labelFlotte = 'Ma Flotte';
  let iconeFlotte = '🚗';

  if (accountType === 'particulier' || companyData.role === 'particulier') {
    labelFlotte = 'Mon appareil';
    iconeFlotte = '📱';
  } else if (typeAbonnement === 'suivi_eleve') {
    labelFlotte = 'Mes élèves';
    iconeFlotte = '🎒';
  } else if (typeAbonnement === 'suivi_etudiant') {
    labelFlotte = 'Mes étudiants';
    iconeFlotte = '🎓';
  }

  // Mettre à jour le lien "Ma Flotte" dans la sidebar de index.html
  const navFlotte = document.querySelector('a[href="fleet.html"] span:last-child');
  if (navFlotte) navFlotte.textContent = labelFlotte;

  // Mettre à jour l'icône du lien flotte dans la sidebar
  const navFlotteParent = document.querySelector('a[href="fleet.html"]');
  if (navFlotteParent) {
    const svgEl = navFlotteParent.querySelector('svg');
    // Remplacer le SVG par l'emoji pour les cas non-flotte
    if (svgEl && iconeFlotte !== '🚗') {
      const span = document.createElement('span');
      span.textContent = iconeFlotte;
      span.className   = 'text-base';
      svgEl.replaceWith(span);
    }
  }

  // Mettre à jour la barre de navigation mobile
  const mobileFlotte = document.querySelector('[data-mobile-nav="flotte"] span:last-child');
  if (mobileFlotte) mobileFlotte.textContent = labelFlotte;

  const mobileFlotteIcon = document.querySelector('[data-mobile-nav="flotte"] .mobile-nav-icon');
  if (mobileFlotteIcon) mobileFlotteIcon.textContent = iconeFlotte;

  // Mettre à jour le titre "AGENTS ACTIFS" dans la sidebar
  const agentsTitle = document.querySelector('.sidebar-new nav p.text-slate-600');
  if (agentsTitle) {
    if (accountType === 'particulier' || companyData.role === 'particulier') {
      agentsTitle.textContent = 'MON APPAREIL';
    } else if (typeAbonnement === 'suivi_eleve') {
      agentsTitle.textContent = 'ÉLÈVES ACTIFS';
    } else if (typeAbonnement === 'suivi_etudiant') {
      agentsTitle.textContent = 'ÉTUDIANTS ACTIFS';
    }
  }

  // Mettre à jour le lien "Ajouter un appareil à suivre"
  const emptyLink = document.querySelector('#emptyState a[href="fleet.html"]');
  if (emptyLink) {
    if (accountType === 'particulier' || companyData.role === 'particulier') {
      emptyLink.textContent = '+ Ajouter mon appareil';
    } else if (typeAbonnement === 'suivi_eleve') {
      emptyLink.textContent = '+ Inviter un élève';
    } else if (typeAbonnement === 'suivi_etudiant') {
      emptyLink.textContent = '+ Inviter un étudiant';
    }
  }
}
async function chargerStatutUtilisateur(user) {
  try {
    const token = await user.getIdToken();
    const res   = await fetch('/api/user/check-status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data  = await res.json();
    if (!res.ok) throw new Error(data.error || 'check-status failed');

    window.__userAccountStatus = data;
  } catch (e) {
    console.warn('[bootstrap] check-status:', e.message);
    window.__userAccountStatus = { status: 'FREE_STRICT', showStrictBanner: true };
  }
}

/**
 * Charge le statut du compte et met à jour le badge dans la sidebar.
 */
async function chargerBadgeCompte(uid) {
  const badgeEl = document.getElementById('accountBadgeText');
  if (!badgeEl) return;

  try {
    const snap    = await get(ref(db, `companies/${uid}`));
    const company = snap.val() || {};
    const licence = company.licence || {};
    const type    = licence.typePack || 'free';
    const userStatus = company.user_status || window.__userAccountStatus?.status;

    let texte, couleur;

    const partExp = company.abonnement_particulier_expire;
    if (company.user_status === 'premium' || (partExp && Number(partExp) > Date.now())) {
      texte   = '⭐ Particulier Premium';
      couleur = 'text-amber-400';
    } else if (licence.est_illimite || type === 'illimite' ||
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
    } else if (userStatus === 'FREE_BONUS') {
      const credits = company.credits_freemium ??
        window.__userAccountStatus?.creditsRemaining;
      texte   = credits != null
        ? `🎁 Bonus — ${credits} visite(s) restante(s)`
        : '🎁 Bonus de démarrage actif';
      couleur = 'text-amber-400';
    } else {
      texte   = '🆓 Plan gratuit — 1 appareil, 1 impression/jour';
      couleur = 'text-slate-400';
    }

    badgeEl.textContent = texte;
    badgeEl.className   = `truncate text-xs ${couleur}`;
  } catch {
    badgeEl.textContent = 'Plan gratuit';
  }
}
