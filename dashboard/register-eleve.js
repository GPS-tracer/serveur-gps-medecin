/**
 * register-eleve.js — Inscription d'un élève (primaire / secondaire)
 *
 * Flux :
 * 1. L'élève (ou son parent) saisit le code parent (= companyId du compte parent)
 * 2. Vérification que ce code existe dans companies/{code}
 * 3. Création d'un compte sur le serveur sécurisé (email + mot de passe)
 * 4. Enregistrement sous :
 *    - companies/{parentId}/eleves_lies/{uid}  ← lien parent/élève
 *    - companies/{uid}                          ← profil propre de l'élève
 */

import { auth, db } from '../shared/firebase.js';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { ref, set, get } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// ─── Éléments DOM ────────────────────────────────────────────
const form         = document.getElementById('registerForm');
const codeParentEl = document.getElementById('codeParent');
const nomEl        = document.getElementById('nomEleve');
const emailEl      = document.getElementById('emailEleve');
const dateNaissanceEl = document.getElementById('dateNaissance');
const classeEl     = document.getElementById('classeEleve');
const mdpEl        = document.getElementById('motDePasse');
const errorEl      = document.getElementById('errorMessage');
const successEl    = document.getElementById('successMessage');
const submitBtn    = document.getElementById('submitBtn');

// Rediriger si déjà connecté
import { redirigerApresLogin } from './post-login.js';

onAuthStateChanged(auth, (user) => {
  if (user && user.emailVerified) redirigerApresLogin();
});

// ─── Soumission ───────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideMessages();

  const codeParent = codeParentEl.value.trim();
  const nom        = nomEl.value.trim();
  const email      = emailEl.value.trim();
  const classe     = classeEl.value.trim();
  const dateNaissance = dateNaissanceEl?.value || '';
  const mdp        = mdpEl.value;

  // Validation
  if (!codeParent) { showError('Le code parent est obligatoire.'); return; }
  if (!nom)        { showError('Le nom de l\'élève est obligatoire.'); return; }
  if (!email || !email.includes('@')) { showError('Email invalide.'); return; }
  if (!dateNaissance) { showError('La date de naissance est obligatoire.'); return; }
  const age = calculerAge(dateNaissance);
  if (age > 15) {
    showError('L\'offre Suivi Élève est réservée aux élèves de 15 ans et moins. Utilisez l\'inscription Étudiant si vous avez plus de 15 ans.');
    return;
  }
  if (mdp.length < 6) { showError('Le mot de passe doit contenir au moins 6 caractères.'); return; }

  setLoading(true);

  try {
    // 1. Vérifier que le code parent existe et a un abonnement suivi_eleve
    const parentSnap = await get(ref(db, `companies/${codeParent}`));
    if (!parentSnap.exists()) {
      showError('Code parent invalide. Demandez le bon code à votre parent ou tuteur légal.');
      return;
    }

    // 2. Créer le compte sur le serveur sécurisé
    const credential = await createUserWithEmailAndPassword(auth, email, mdp);
    const uid        = credential.user.uid;

    // 3. Enregistrer le profil élève dans companies/{uid}
    await set(ref(db, `companies/${uid}`), {
      companyName: nom,
      email,
      sector:      'scolaire',
      accountType: 'eleve',
      parentId:    codeParent,
      classe:         classe || null,
      dateNaissance,
      age,
      createdAt:      Date.now(),
      role:        'eleve',
      status:      'active',
    });

    // 4. Lier l'élève au compte parent
    await set(ref(db, `companies/${codeParent}/eleves_lies/${uid}`), {
      nom,
      email,
      typeCompte: 'eleve',
      classe:     classe || null,
      linkedAt:   Date.now(),
      status:     'active',
    });

    // 5. Envoyer l'email de vérification
    await sendEmailVerification(credential.user);

    showSuccess(`✅ Compte élève créé ! Vérifiez votre email (${email}) pour activer votre compte.`);
    form.reset();

    setTimeout(() => window.location.replace('login.html'), 4000);

  } catch (err) {
    const msg = traduireErreurAuth(err);
    showError(msg);
    console.error('register-eleve error:', err);
  } finally {
    setLoading(false);
  }
});

/** Âge en années complètes à partir d'une date YYYY-MM-DD */
function calculerAge(ymd) {
  const d = new Date(ymd);
  if (Number.isNaN(d.getTime())) return 99;
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  const m = t.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age -= 1;
  return age;
}

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
  submitBtn.textContent = loading ? 'Création en cours…' : 'Créer mon compte élève';
}

function traduireErreurAuth(err) {
  if (err.code === 'auth/email-already-in-use') return 'Cet email est déjà utilisé.';
  if (err.code === 'auth/weak-password')        return 'Mot de passe trop faible (min. 6 caractères).';
  if (err.code === 'auth/invalid-email')        return 'Adresse email invalide.';
  if (err.code === 'auth/network-request-failed') return 'Erreur réseau. Vérifiez votre connexion.';
  return err.message || 'Une erreur est survenue. Réessayez.';
}
