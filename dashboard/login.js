/**
 * Email/password sign-in with email verification check.
 * Une fois l'email vérifié, la boîte d'avertissement disparaît
 * automatiquement et l'utilisateur est redirigé vers le dashboard.
 */

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendEmailVerification,
  reload,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../shared/firebase.js";
import { verifierSessionGeo } from "./session-geo.js";
import { aIntentAchatEnAttente, lireIntentAchat } from "./intent-achat.js";
import { redirigerApresLogin } from "./post-login.js";
import { libelleOffreIntent } from "./chariow-paiement.js";

verifierSessionGeo();

const hintEl = document.querySelector(".hint");
const recapEl = document.getElementById("intentAchatLoginRecap");
const linkRegister = document.getElementById("linkRegisterAchat");

if (aIntentAchatEnAttente()) {
  const intent = lireIntentAchat();
  if (hintEl) {
    hintEl.textContent = "Vous avez déjà un compte — saisissez votre email et mot de passe pour accéder au paiement Chariow.";
  }
  if (recapEl && intent) {
    recapEl.textContent = `Offre en attente : ${libelleOffreIntent(intent)}`;
    recapEl.classList.remove("hidden");
  }
  if (linkRegister) {
    linkRegister.href = lienInscription(intent?.offreType);
    linkRegister.textContent = "Créer un compte pour payer cette offre";
  }
}

function lienInscription(offreType) {
  switch (offreType) {
    case "eleve":    return "register-eleve.html";
    case "etudiant": return "register-etudiant.html";
    default:         return "register-entreprise.html";
  }
}

const form                = document.getElementById("loginForm");
const emailEl             = document.getElementById("email");
const passwordEl          = document.getElementById("password");
const errorEl             = document.getElementById("loginError");
const verificationWarning = document.getElementById("verificationWarning");
const resendBtn           = document.getElementById("resendVerification");
const submitBtn           = document.getElementById("submitBtn");

let currentUser      = null;
let pollingInterval  = null; // intervalle de vérification email

// ── Si déjà connecté et vérifié → dashboard directement ──────
onAuthStateChanged(auth, (user) => {
  if (user && user.emailVerified) {
    stopPolling();
    redirigerApresLogin();
  }
});

// ── Renvoyer l'email de vérification ─────────────────────────
if (resendBtn) {
  resendBtn.addEventListener("click", async () => {
    if (!currentUser) return;

    resendBtn.disabled    = true;
    resendBtn.textContent = "Envoi en cours...";

    try {
      await sendEmailVerification(currentUser);
      errorEl.className   = "success";
      errorEl.textContent = "✅ Email de vérification renvoyé ! Vérifiez votre boîte de réception.";
      setTimeout(() => {
        errorEl.textContent = "";
        errorEl.className   = "error";
      }, 5000);
    } catch (err) {
      errorEl.textContent = "Erreur lors de l'envoi : " + (err.message || String(err));
    } finally {
      resendBtn.disabled    = false;
      resendBtn.textContent = "Renvoyer l'email";
    }
  });
}

// ── Soumission du formulaire ──────────────────────────────────
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  errorEl.className   = "error";
  verificationWarning.classList.add("hidden");
  stopPolling();

  submitBtn.disabled    = true;
  submitBtn.textContent = "Connexion...";

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      emailEl.value.trim(),
      passwordEl.value
    );

    currentUser = credential.user;

    if (!currentUser.emailVerified) {
      // Afficher la boîte d'avertissement
      verificationWarning.classList.remove("hidden");
      errorEl.className   = "warning";
      errorEl.textContent = "⚠️ Veuillez confirmer votre compte via le lien envoyé à votre adresse email.";

      submitBtn.disabled    = false;
      submitBtn.textContent = "Se connecter";

      // Démarrer le polling : vérifie toutes les 3s si l'email est confirmé
      startPolling();
      return;
    }

    redirigerApresLogin();

  } catch (err) {
    currentUser = null;
    verificationWarning.classList.add("hidden");
    stopPolling();

    let message = err.message || String(err);
    if (err.code === "auth/user-not-found")      message = "❌ Aucun compte trouvé avec cet email.";
    else if (err.code === "auth/wrong-password") message = "❌ Mot de passe incorrect.";
    else if (err.code === "auth/invalid-email")  message = "❌ Adresse email invalide.";
    else if (err.code === "auth/user-disabled")  message = "❌ Ce compte a été désactivé.";
    else if (err.code === "auth/too-many-requests") message = "❌ Trop de tentatives. Réessayez plus tard.";
    else if (err.code === "auth/invalid-credential") message = "❌ Email ou mot de passe incorrect.";

    errorEl.textContent   = message;
    submitBtn.disabled    = false;
    submitBtn.textContent = "Se connecter";
  }
});

// ── Polling : recharge le token toutes les 3s ─────────────────
// Dès que le serveur sécurisé confirme emailVerified = true :
//   → masque la boîte d'avertissement
//   → redirige vers le dashboard
function startPolling() {
  if (pollingInterval) return; // déjà actif

  // Mettre à jour le texte du bouton renvoyer pour indiquer l'attente
  if (resendBtn) {
    resendBtn.insertAdjacentHTML("afterend",
      `<p id="pollingHint" style="margin:8px 0 0;font-size:12px;color:#64748b;">
        ⏳ En attente de confirmation… La page se mettra à jour automatiquement.
      </p>`
    );
  }

  pollingInterval = setInterval(async () => {
    if (!currentUser) { stopPolling(); return; }

    try {
      // Recharger le profil utilisateur pour obtenir l'état emailVerified à jour
      await reload(currentUser);

      if (currentUser.emailVerified) {
        stopPolling();

        // Masquer la boîte d'avertissement avec une transition douce
        verificationWarning.style.transition = "opacity .4s";
        verificationWarning.style.opacity    = "0";
        setTimeout(() => verificationWarning.classList.add("hidden"), 400);

        errorEl.className   = "success";
        errorEl.textContent = "✅ Email confirmé ! Redirection en cours…";

        // Rediriger après un court délai
        setTimeout(() => redirigerApresLogin(), 1200);
      }
    } catch {
      // Ignorer les erreurs réseau temporaires
    }
  }, 3000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  document.getElementById("pollingHint")?.remove();
}
