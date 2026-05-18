/**
 * Auth Guard - Protège les routes du dashboard
 * Vérifie que l'utilisateur est connecté ET que son email est vérifié
 */

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "../shared/firebase.js";
import { deconnecter } from "./deconnexion.js";

const loadingEl = document.getElementById("auth-loading");
const dashboardRoot = document.getElementById("dashboard-root");

// Pages publiques qui ne nécessitent pas d'authentification
const PUBLIC_PAGES = ['login.html', 'register.html'];

// Vérifier si on est sur une page publique
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
const isPublicPage = PUBLIC_PAGES.includes(currentPage);

// Protéger les routes
onAuthStateChanged(auth, (user) => {
  if (loadingEl) loadingEl.hidden = true;
  
  // Si pas d'utilisateur et page protégée → rediriger vers login
  if (!user && !isPublicPage) {
    window.location.replace('login.html');
    return;
  }
  
  // Si utilisateur connecté mais email non vérifié et page protégée → rediriger vers login
  if (user && !user.emailVerified && !isPublicPage) {
    // Déconnecter l'utilisateur pour forcer la vérification
    deconnecter('login.html');
    return;
  }
  
  // Si utilisateur connecté avec email vérifié et sur page publique → rediriger vers dashboard
  if (user && user.emailVerified && isPublicPage) {
    window.location.replace('index.html');
    return;
  }
  
  // Tout est OK, afficher le contenu
  if (dashboardRoot) {
    dashboardRoot.hidden = false;
  }
});

// Export pour utilisation dans d'autres fichiers
export function requireAuth() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      
      if (!user) {
        reject(new Error('User not authenticated'));
        window.location.replace('login.html');
        return;
      }
      
      if (!user.emailVerified) {
        reject(new Error('Email not verified'));
        window.location.replace('login.html');
        return;
      }
      
      resolve(user);
    });
  });
}
