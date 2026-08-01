import { auth, db } from "../shared/firebase.js";
import { signInWithEmailAndPassword, sendEmailVerification, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { ref, update } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { redirigerApresLogin } from './post-login.js';

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
            const icon = logoPreview.querySelector('.register-form__logo-icon, svg');
            if (icon) icon.classList.add('hidden');
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
    successDiv.className = 'register-form__toast';
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
    submitBtn.innerHTML = '<svg class="register-form__spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
    
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

        console.log('Création du compte (atomique, côté serveur)...');
        // Le serveur crée le compte Auth ET le profil companies/{uid} ensemble.
        // En cas d'échec du profil, le compte Auth est automatiquement annulé
        // côté serveur — plus de compte "fantôme" bloquant l'email pour toujours.
        const createRes = await fetch('/api/register/entreprise', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ companyName, sector, address, email, password }),
        });
        const createData = await createRes.json();
        if (!createRes.ok) {
            throw new Error(createData.error || 'Erreur lors de la création du compte.');
        }
        console.log('Compte créé:', createData.uid);

        // Établir la session (le compte existe déjà côté serveur, on se connecte)
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Upload du logo (si présent) — non bloquant, purement cosmétique.
        if (logoFile) {
            console.log('Upload du logo...');
            try {
                const logoUrl = await uploadLogo(logoFile, user.uid);
                if (logoUrl) await update(ref(db, `companies/${user.uid}`), { logoUrl });
            } catch (logoErr) {
                console.warn('Upload du logo échoué, poursuite sans logo:', logoErr);
            }
        }

        // Initialisation serveur : date_creation, expiration_essai J+14, 50 crédits
        try {
            const token = await user.getIdToken();
            await fetch('/api/user/init-account', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch (initErr) {
            console.warn('Init bonus freemium (sera fait au 1er login):', initErr);
        }
        
        console.log('Envoi de l\'email de vérification...');
        // Envoyer l'email de vérification
        await sendEmailVerification(user);
        
        console.log('Inscription réussie!');
        
        // Afficher un message de succès plus visible
        const successMessage = 'Compte créé avec succès! ✅\n\nVérifiez votre email pour activer votre compte.\nRedirection en cours...';
        showSuccess(successMessage);
        
        // Rediriger vers le login après 4 secondes (au lieu de 3)
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 4000);
        
    } catch (error) {
        console.error('Erreur inscription:', error);
        
        let message = 'Une erreur est survenue. Veuillez réessayer.';
        
        // Messages d'erreur d'authentification
        if (error.code === 'auth/email-already-in-use' || error.code === 'auth/email-already-exists') {
            message = '❌ Cet email est déjà utilisé. Veuillez vous connecter ou utiliser un autre email.';
        } else if (error.code === 'auth/weak-password') {
            message = '❌ Le mot de passe est trop faible. Utilisez au moins 6 caractères.';
        } else if (error.code === 'auth/invalid-email') {
            message = '❌ L\'adresse email est invalide.';
        } else if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
            message = '❌ Compte créé mais connexion échouée. Réessayez de vous connecter manuellement.';
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

// Vérifier si l'utilisateur est déjà connecté
onAuthStateChanged(auth, (user) => {
    if (user && user.emailVerified) redirigerApresLogin();
});
