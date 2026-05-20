import { auth, db } from "../shared/firebase.js";
import { createUserWithEmailAndPassword, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// Éléments DOM
const form = document.getElementById('registerForm');
const logoInput = document.getElementById('logoInput');
const logoPreview = document.getElementById('logoPreview');
const logoImage = document.getElementById('logoImage');
const togglePassword = document.getElementById('togglePassword');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('errorMessage');
const submitBtn = document.getElementById('submitBtn');

// Prévisualisation du logo
logoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        // Vérifier la taille (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            showError('Le logo ne doit pas dépasser 5 MB');
            logoInput.value = '';
            return;
        }
        
        // Vérifier le type
        if (!file.type.startsWith('image/')) {
            showError('Veuillez sélectionner une image valide');
            logoInput.value = '';
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (e) => {
            logoImage.src = e.target.result;
            logoImage.classList.remove('hidden');
            logoPreview.querySelector('svg').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
});

// Clic sur la zone de prévisualisation pour ouvrir le sélecteur
logoPreview.addEventListener('click', () => {
    logoInput.click();
});

// Toggle password visibility
togglePassword.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
});

// Afficher erreur
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
        errorMessage.classList.add('hidden');
    }, 5000);
}

// Afficher succès
function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'fixed top-4 right-4 bg-green-500/90 text-white px-6 py-4 rounded-lg shadow-lg z-50 animate-fade-in';
    successDiv.textContent = message;
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

// Upload logo vers le stockage sécurisé GPTS
async function uploadLogo(file, userId) {
    if (!file) return null;
    
    const storage = getStorage();
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name}`;
    const logoRef = storageRef(storage, `logos/${userId}/${fileName}`);
    
    try {
        console.log('Upload du logo en cours...');
        const snapshot = await uploadBytes(logoRef, file);
        console.log('Logo uploadé avec succès');
        
        const url = await getDownloadURL(snapshot.ref);
        console.log('URL du logo:', url);
        return url;
    } catch (error) {
        console.error('Erreur upload logo:', error);
        throw new Error('Impossible d\'uploader le logo. Veuillez réessayer.');
    }
}

// Valider les données du formulaire
function validateForm(companyName, sector, address, email, password) {
    if (!companyName || companyName.length < 2) {
        throw new Error('Le nom de la société doit contenir au moins 2 caractères');
    }
    
    if (!sector) {
        throw new Error('Veuillez sélectionner un secteur d\'activité');
    }
    
    if (!address || address.trim().length < 5) {
        throw new Error('Veuillez entrer une adresse (minimum 5 caractères)');
    }
    
    if (!email || !email.includes('@')) {
        throw new Error('Veuillez entrer un email valide');
    }
    
    if (!password || password.length < 6) {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères');
    }
}

// Soumission du formulaire
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Désactiver le bouton
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<svg class="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
    
    // Récupérer les données
    const companyName = document.getElementById('companyName').value.trim();
    const sector = document.getElementById('sector').value;
    const address = document.getElementById('address').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const logoFile = logoInput.files[0];
    
    try {
        // Valider les données
        validateForm(companyName, sector, address, email, password);
        
        console.log('Création de l\'utilisateur...');
        // Créer le compte sur le serveur sécurisé
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log('Utilisateur créé:', user.uid);
        
        // Upload du logo (si présent)
        let logoUrl = null;
        if (logoFile) {
            console.log('Upload du logo...');
            logoUrl = await uploadLogo(logoFile, user.uid);
        }
        
        console.log('Enregistrement des données...');
        // Sauvegarder les infos dans Realtime Database
        await set(ref(db, `companies/${user.uid}`), {
            companyName,
            sector,
            address,
            email,
            logoUrl,
            createdAt: Date.now(),
            role: 'company',
            status: 'active'
        });
        
        console.log('Envoi de l\'email de vérification...');
        // Envoyer l'email de vérification
        await sendEmailVerification(user);
        
        console.log('Inscription réussie!');
        showSuccess('Compte créé avec succès! Vérifiez votre email pour activer votre compte.');
        
        // Rediriger vers le login après 3 secondes
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 3000);
        
    } catch (error) {
        console.error('Erreur inscription:', error);
        
        let message = 'Une erreur est survenue. Veuillez réessayer.';
        
        // Messages d'erreur d'authentification
        if (error.code === 'auth/email-already-in-use') {
            message = '❌ Cet email est déjà utilisé. Veuillez vous connecter ou utiliser un autre email.';
        } else if (error.code === 'auth/weak-password') {
            message = '❌ Le mot de passe est trop faible. Utilisez au moins 6 caractères.';
        } else if (error.code === 'auth/invalid-email') {
            message = '❌ L\'adresse email est invalide.';
        } else if (error.code === 'auth/operation-not-allowed') {
            message = '❌ L\'inscription par email/mot de passe n\'est pas activée.';
        } else if (error.code === 'auth/network-request-failed') {
            message = '❌ Erreur de connexion. Vérifiez votre connexion internet.';
        } else if (error.message) {
            message = `❌ ${error.message}`;
        }
        
        showError(message);
        
        // Réactiver le bouton
        submitBtn.disabled = false;
        submitBtn.textContent = 'Créer mon compte';
    }
});

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { redirigerApresLogin } from "./post-login.js";

onAuthStateChanged(auth, (user) => {
    if (user && user.emailVerified) redirigerApresLogin();
});
