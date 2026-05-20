/**
 * Attend la session Firebase (évite redirect login pendant la restauration).
 */
import { auth } from '../shared/firebase.js';
import { deconnecter } from './deconnexion.js';

/**
 * @param {string} [loginPath='login.html']
 * @returns {Promise<import('firebase/auth').User>}
 */
export async function exigerSessionDashboard(loginPath = 'login.html') {
  await auth.authStateReady();

  const user = auth.currentUser;
  if (!user) {
    window.location.replace(loginPath);
    throw new Error('AUTH_REQUIRED');
  }

  if (!user.emailVerified) {
    await deconnecter(loginPath);
    throw new Error('EMAIL_NOT_VERIFIED');
  }

  return user;
}
