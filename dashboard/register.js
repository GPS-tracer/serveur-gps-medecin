import { auth, db } from "../shared/firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
        const reader = new FileReader();
        reader.onload = (e) => {
            logoImage.src = e.target.result;
            logoImage.classList.remove('hidden');
            logoPreview.querySelector('svg').classList.add('hidden');
        };
        reader.readAsDataURL(file);
    }
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
    setTimeout(() => {
        errorMessage.classList.add('hidden');
    }, 5000);
}

// Upload logo vers Firebase Storage
async function uploadLogo(file, userId) {
    if (!file) return null;
    
    const storage = getStorage();
    const logoRef = storageRef(storage, `logos/${userId}/${file.name}`);
    
    try {
        await uploadBytes(logoRef, file);
        const url = await getDownloadURL(logoRef);
        return url;
    } catch (error) {
        console.error('Erreur upload logo:', error);
        return null;
    }
}

// Soumission du formulaire
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Désactiver le bouton
    submitBtn.disabled = true;
    submitBtn.textContent = 'Création en cours...';
    
    // Récupérer les données
    const companyName = document.getElementById('companyName').value.trim();
    const sector = document.getElementById('sector').value;
    const address = document.getElementById('address').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const logoFile = logoInput.files[0];
    
    try {
        // Créer l'utilisateur Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Upload du logo (si présent)
        let logoUrl = null;
        if (logoFile) {
            logoUrl = await uploadLogo(logoFile, user.uid);
        }
        
        // Sauvegarder les infos dans Realtime Database
        await set(ref(db, `companies/${user.uid}`), {
            companyName,
            sector,
            address,
            email,
            logoUrl,
            createdAt: Date.now(),
            role: 'company'
        });
        
        // Rediriger vers le dashboard
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('Erreur inscription:', error);
        
        let message = 'Une erreur est survenue. Veuillez réessayer.';
        
        if (error.code === 'auth/email-already-in-use') {
            message = 'Cet email est déjà utilisé.';
        } else if (error.code === 'auth/weak-password') {
            message = 'Le mot de passe est trop faible.';
        } else if (error.code === 'auth/invalid-email') {
            message = 'Email invalide.';
        }
        
        showError(message);
        
        // Réactiver le bouton
        submitBtn.disabled = false;
        submitBtn.textContent = 'Créer mon compte';
    }
});
