/**
 * Loads the dashboard only when Firebase Auth has a signed-in user.
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../shared/firebase.js";

const root = document.getElementById("dashboard-root");
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
    window.location.replace(new URL("login.html", import.meta.url));
    return;
  }

  log("Utilisateur connecté : " + user.email + " → chargement du dashboard...");

  if (appStarted) return;
  appStarted = true;

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
