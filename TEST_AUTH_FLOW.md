# Test du flux d'authentification

## Prérequis
- Firebase Authentication activé (Email/Password)
- Application déployée sur Render

## Scénario 1: Inscription complète

### Étape 1: Créer un compte
1. Aller sur: `https://serveur-gps-medecin.onrender.com/dashboard/register.html`
2. Remplir le formulaire:
   - Nom société: "Test Transport"
   - Secteur: "Voiture"
   - Adresse: "123 Rue Test, Brazzaville"
   - Email: "test@example.com"
   - Mot de passe: "test123456"
   - Logo: (optionnel)
3. Cliquer "Créer mon compte"

**Résultat attendu:**
- ✅ Message: "Compte créé avec succès! Vérifiez votre email..."
- ✅ Redirection vers `login.html` après 3 secondes
- ✅ Email de vérification envoyé à test@example.com

### Étape 2: Tenter de se connecter sans vérifier l'email
1. Sur `login.html`, entrer:
   - Email: "test@example.com"
   - Mot de passe: "test123456"
2. Cliquer "Se connecter"

**Résultat attendu:**
- ⚠️ Message: "Veuillez confirmer votre compte via le lien envoyé..."
- ⚠️ Boîte jaune avec bouton "Renvoyer l'email"
- ❌ PAS de redirection vers le dashboard

### Étape 3: Renvoyer l'email de vérification
1. Cliquer sur "Renvoyer l'email"

**Résultat attendu:**
- ✅ Message: "Email de vérification renvoyé!"
- ✅ Nouvel email reçu

### Étape 4: Vérifier l'email
1. Ouvrir l'email de vérification
2. Cliquer sur le lien de vérification

**Résultat attendu:**
- ✅ Page Firebase confirmant la vérification
- ✅ Redirection possible vers login.html

### Étape 5: Se connecter avec email vérifié
1. Retourner sur `login.html`
2. Entrer email et mot de passe
3. Cliquer "Se connecter"

**Résultat attendu:**
- ✅ Redirection immédiate vers `index.html` (dashboard)
- ✅ Carte visible avec agents
- ✅ Bouton "Fleet" visible

## Scénario 2: Protection des routes

### Test 1: Accès direct au dashboard sans connexion
1. Ouvrir un navigateur en navigation privée
2. Aller sur: `https://serveur-gps-medecin.onrender.com/dashboard/`

**Résultat attendu:**
- ✅ Redirection automatique vers `login.html`
- ✅ Message: "Aucun utilisateur connecté"

### Test 2: Accès à fleet.html sans connexion
1. En navigation privée
2. Aller sur: `https://serveur-gps-medecin.onrender.com/dashboard/fleet.html`

**Résultat attendu:**
- ✅ Redirection automatique vers `login.html`

### Test 3: Accès avec email non vérifié
1. Créer un nouveau compte (ne pas vérifier l'email)
2. Se connecter
3. Essayer d'accéder au dashboard via URL directe

**Résultat attendu:**
- ✅ Déconnexion automatique
- ✅ Redirection vers `login.html`
- ✅ Message de vérification requis

## Scénario 3: Navigation normale

### Flux complet
1. Se connecter avec compte vérifié
2. Voir le dashboard avec carte
3. Cliquer sur "🚗 Fleet"
4. Ajouter un agent
5. Retourner au dashboard (cliquer "Carte")
6. Voir l'agent sur la carte
7. Se déconnecter

**Résultat attendu:**
- ✅ Toutes les pages chargent correctement
- ✅ Pas de redirection inattendue
- ✅ Déconnexion ramène à login.html

## Scénario 4: Cas limites

### Test 1: Email déjà utilisé
1. Essayer de créer un compte avec un email existant

**Résultat attendu:**
- ❌ Message: "Cet email est déjà utilisé..."

### Test 2: Mot de passe trop court
1. Essayer de créer un compte avec mot de passe < 6 caractères

**Résultat attendu:**
- ❌ Message: "Le mot de passe doit contenir au moins 6 caractères"

### Test 3: Mauvais mot de passe à la connexion
1. Entrer un mauvais mot de passe

**Résultat attendu:**
- ❌ Message: "Mot de passe incorrect"

### Test 4: Email inexistant
1. Essayer de se connecter avec un email qui n'existe pas

**Résultat attendu:**
- ❌ Message: "Aucun compte trouvé avec cet email"

## Vérifications dans Firebase Console

### Authentication → Users
Après inscription, vérifier:
- ✅ Utilisateur créé
- ✅ Email affiché
- ✅ Colonne "Email verified" = false (avant vérification)
- ✅ Colonne "Email verified" = true (après vérification)

### Realtime Database → Data
Après inscription, vérifier:
```json
{
  "companies": {
    "uid_utilisateur": {
      "companyName": "Test Transport",
      "sector": "Voiture",
      "address": "123 Rue Test, Brazzaville",
      "email": "test@example.com",
      "logoUrl": "...",
      "createdAt": 1234567890,
      "role": "company",
      "status": "active"
    }
  }
}
```

### Storage → Files
Si logo uploadé, vérifier:
```
logos/
  └── uid_utilisateur/
      └── timestamp_filename.jpg
```

## Checklist finale

- [ ] Inscription fonctionne
- [ ] Email de vérification envoyé
- [ ] Connexion bloquée si email non vérifié
- [ ] Message d'avertissement affiché
- [ ] Bouton "Renvoyer l'email" fonctionne
- [ ] Connexion réussie après vérification
- [ ] Dashboard accessible après vérification
- [ ] Fleet accessible après vérification
- [ ] Redirection automatique si non connecté
- [ ] Redirection automatique si email non vérifié
- [ ] Déconnexion fonctionne
- [ ] Messages d'erreur clairs et en français

## Commandes utiles

### Voir les logs du serveur (Render)
```
Render Dashboard → Service → Logs
```

### Tester localement
```bash
npm install
node server.js
# Ouvrir http://localhost:3000/dashboard/
```

### Forcer la vérification d'un email (Firebase Console)
```
Authentication → Users → Sélectionner utilisateur → Actions → Verify email
```

### Supprimer un utilisateur de test
```
Authentication → Users → Sélectionner utilisateur → Delete user
```
