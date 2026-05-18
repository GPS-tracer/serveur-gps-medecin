/**
 * register-etudiant.js — Inscription d'un étudiant
 *
 * Flux :
 * 1. L'étudiant saisit le code parent (= companyId du compte parent)
 * 2. Vérification que ce code existe dans companies/{code}
 * 3. Création d'un compte sur le serveur sécurisé (email + mot de passe)
 * 4. Enregistrement sous :
 *    - companies/{parentId}/eleves_lies/{uid}  ← lien parent/étudiant
 *    - companies/{uid}                          ← profil propre de l'étudiant
 */

import { auth, db } from '../shared/firebase.js';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { ref, set, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ─── Éléments DOM ────────────────────────────────────────────
const form           = document.getElementById('registerForm');
const codeParentEl   = document.getElementById('codeParent');
const nomEl          = document.getElementById('nomEtudiant');
const emailEl        = document.getElementById('emailEtudiant');
const numeroEl       = document.getElementById('numeroEtudiant');
const mdpEl          = document.getElementById('motDePasse');
const errorEl        = document.getElementById('errorMessage');
const successEl      = document.getElementById('successMessage');
const submitBtn      = document.getElementById('submitBtn');

// Rediriger si déjà connecté
onAuthStateChanged(auth, (user) => {
  if (user && user.emailVerified) window.location.replace('index.html');
});

// ─── Soumission ───────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const codeParent  = codeParentEl.value.trim();
  const nom         = nomEl.value.trim();
  const email       = emailEl.value.trim();
  const numero      = numeroEl.value.trim();
  const mdp         = mdpEl.value;

  // Validation
  if (!codeParent) { showError('Le code de liaison est obligatoire.'); return; }
  if (!nom)        { showError('Votre nom complet est obligatoire.'); return; }
  if (!email || !email.includes('@')) { showError('Email invalide.'); return; }
  if (mdp.length < 6) { showError('Le mot de passe doit contenir au moins 6 caractères.'); return; }

  setLoading(true);

  try {
    // 1. Vérifier que le code parent existe
    const parentSnap = await get(ref(db, `companies/${codeParent}`));
    if (!parentSnap.exists()) {
      showError('Code de liaison invalide. Demandez le bon code à votre parent ou établissement.');
      return;
    }
    const parentData = parentSnap.val();

    // 2. Créer le compte sur le serveur sécurisé
    const credential = await createUserWithEmailAndPassword(auth, email, mdp);
    const uid        = credential.user.uid;

    // 3. Enregistrer le profil étudiant dans companies/{uid}
    await set(ref(db, `companies/${uid}`), {
      companyName:  nom,
      email,
      sector:       'scolaire',
      accountType:  'etudiant',
      parentId:     codeParent,
      numeroEtudiant: numero || null,
      createdAt:    Date.now(),
      role:         'etudiant',
      status:       'active',
    });

    // 4. Lier l'étudiant au compte parent
    await set(ref(db, `companies/${codeParent}/eleves_lies/${uid}`), {
      nom,
      email,
      typeCompte:     'etudiant',
      numeroEtudiant: numero || null,
      linkedAt:       Date.now(),
      status:         'active',
    });

    // 5. Envoyer l'email de vérification
    await sendEmailVerification(credential.user);

    showSuccess(`✅ Compte étudiant créé ! Vérifiez votre email (${email}) pour activer votre compte.`);
    form.reset();

    setTimeout(() => window.location.replace('login.html'), 4000);

  } catch (err) {
    const msg = traduireErreurAuth(err);
    showError(msg);
    console.error('register-etudiant error:', err);
  } finally {
    setLoading(false);
  }
});

// ─── Helpers ──────────────────────────────────────────────────
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function showSuccess(msg) {
  successEl.textContent = msg;
  successEl.classList.remove('hidden');
}

function hideMessages() {
  errorEl.classList.add('hidden');
  successEl.classList.add('hidden');
}

function setLoading(loading) {
  submitBtn.disabled    = loading;
  submitBtn.textContent = loading ? 'Création en cours…' : 'Créer mon compte étudiant';
}

function traduireErreurAuth(err) {
  if (err.code === 'auth/email-already-in-use') return 'Cet email est déjà utilisé.';
  if (err.code === 'auth/weak-password')        return 'Mot de passe trop faible (min. 6 caractères).';
  if (err.code === 'auth/invalid-email')        return 'Adresse email invalide.';
  if (err.code === 'auth/network-request-failed') return 'Erreur réseau. Vérifiez votre connexion.';
  return err.message || 'Une erreur est survenue. Réessayez.';
}
