/**
 * Email/password sign-in with email verification check.
 */

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../shared/firebase.js";

const form = document.getElementById("loginForm");
const emailEl = document.getElementById("email");
const passwordEl = document.getElementById("password");
const errorEl = document.getElementById("loginError");
const verificationWarning = document.getElementById("verificationWarning");
const resendBtn = document.getElementById("resendVerification");
const submitBtn = document.getElementById("submitBtn");

let currentUser = null;

// Vérifier si déjà connecté
onAuthStateChanged(auth, (user) => {
  if (user && user.emailVerified) {
    window.location.replace("index.html");
  }
});

// Renvoyer l'email de vérification
if (resendBtn) {
  resendBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    
    resendBtn.disabled = true;
    resendBtn.textContent = "Envoi en cours...";
    
    try {
      await sendEmailVerification(currentUser);
      errorEl.textContent = "";
      errorEl.className = "success";
      errorEl.textContent = "✅ Email de vérification renvoyé! Vérifiez votre boîte de réception.";
      
      setTimeout(() => {
        errorEl.textContent = "";
        errorEl.className = "error";
      }, 5000);
    } catch (err) {
      errorEl.textContent = "Erreur lors de l'envoi: " + (err.message || String(err));
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = "Renvoyer l'email";
    }
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  errorEl.className = "error";
  verificationWarning.classList.add("hidden");
  
  submitBtn.disabled = true;
  submitBtn.textContent = "Connexion...";

  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      emailEl.value.trim(),
      passwordEl.value
    );
    
    currentUser = userCredential.user;
    
    // Vérifier si l'email est validé
    if (!currentUser.emailVerified) {
      verificationWarning.classList.remove("hidden");
      errorEl.className = "warning";
      errorEl.textContent = "⚠️ Veuillez confirmer votre compte via le lien envoyé à votre adresse email.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Se connecter";
      return;
    }
    
    // Email vérifié, rediriger vers le dashboard
    window.location.replace("index.html");
    
  } catch (err) {
    currentUser = null;
    verificationWarning.classList.add("hidden");
    
    let message = err.message || String(err);
    
    // Messages d'erreur personnalisés
    if (err.code === 'auth/user-not-found') {
      message = "❌ Aucun compte trouvé avec cet email.";
    } else if (err.code === 'auth/wrong-password') {
      message = "❌ Mot de passe incorrect.";
    } else if (err.code === 'auth/invalid-email') {
      message = "❌ Adresse email invalide.";
    } else if (err.code === 'auth/user-disabled') {
      message = "❌ Ce compte a été désactivé.";
    } else if (err.code === 'auth/too-many-requests') {
      message = "❌ Trop de tentatives. Réessayez plus tard.";
    }
    
    errorEl.textContent = message;
    submitBtn.disabled = false;
    submitBtn.textContent = "Se connecter";
  }
});
