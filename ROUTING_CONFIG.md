# Configuration du routage - GPS Tracker

## Structure des routes

### Routes publiques (accessibles sans authentification)
- `/` - Page d'accueil (redirige vers `/dashboard/`)
- `/dashboard/login.html` - Page de connexion
- `/dashboard/register.html` - Page d'inscription
- `/agent/` - Application PWA pour agents (pas d'auth requise)

### Routes protégées (authentification + email vérifié requis)
- `/dashboard/` ou `/dashboard/index.html` - Dashboard principal avec carte
- `/dashboard/fleet.html` - Gestion de la flotte

## Système de protection des routes

### 1. Vérification d'authentification
Tous les fichiers protégés utilisent `onAuthStateChanged` pour vérifier:
- ✅ Utilisateur connecté
- ✅ Email vérifié

### 2. Flux d'authentification

#### Inscription (`register.html`)
```
1. Utilisateur remplit le formulaire
2. Création du compte Firebase Auth
3. Envoi automatique de l'email de vérification
4. Redirection vers login.html
5. Message: "Vérifiez votre email pour activer votre compte"
```

#### Connexion (`login.html`)
```
1. Utilisateur entre email/mot de passe
2. Vérification des credentials
3. SI email non vérifié:
   - Affichage du message d'avertissement
   - Bouton "Renvoyer l'email"
   - Pas d'accès au dashboard
4. SI email vérifié:
   - Redirection vers dashboard
```

#### Accès au dashboard
```
1. bootstrap.js vérifie l'auth state
2. SI pas connecté → redirect login.html
3. SI connecté mais email non vérifié:
   - Déconnexion automatique
   - Redirect login.html
4. SI connecté ET email vérifié:
   - Chargement du dashboard
```

## Fichiers de protection

### `dashboard/bootstrap.js`
Protège le dashboard principal (`index.html`)
- Vérifie auth + email vérifié
- Charge `app.js` seulement si OK
- Redirige vers login sinon

### `dashboard/fleet.js`
Protège la page de gestion de flotte
- Vérifie auth + email vérifié dans `onAuthStateChanged`
- Redirige vers login si non autorisé

### `dashboard/login.js`
Gère la connexion avec vérification d'email
- Affiche message si email non vérifié
- Permet de renvoyer l'email de vérification
- Redirige vers dashboard si déjà connecté avec email vérifié

### `dashboard/register.js`
Gère l'inscription avec envoi d'email
- Crée le compte
- Envoie l'email de vérification automatiquement
- Redirige vers login (pas vers dashboard)

## Messages utilisateur

### Email non vérifié (login)
```
⚠️ Veuillez confirmer votre compte via le lien envoyé à votre adresse email.

[Bouton: Renvoyer l'email]
```

### Après inscription
```
✅ Compte créé avec succès! Vérifiez votre email pour activer votre compte.
→ Redirection vers login.html
```

### Email de vérification renvoyé
```
✅ Email de vérification renvoyé! Vérifiez votre boîte de réception.
```

## Configuration Firebase

### Authentication
- Méthode: Email/Password
- Email verification: Activée
- Template d'email: Personnalisable dans Firebase Console

### Realtime Database Rules
```json
{
  "rules": {
    "agents": {
      ".read": "auth != null",
      "$agentId": {
        ".write": true
      }
    },
    "companies": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid"
      }
    }
  }
}
```

## Déploiement sur Render

### Configuration serveur (`server.js`)
Le serveur Express sert tous les fichiers statiques:
```javascript
app.use(express.static('.'));
```

### Routes servies
- `GET /` → `index.html` (redirection)
- `GET /dashboard/` → `dashboard/index.html`
- `GET /dashboard/login.html` → Page de connexion
- `GET /dashboard/register.html` → Page d'inscription
- `GET /dashboard/fleet.html` → Gestion de flotte
- `GET /agent/` → Application PWA

### Variables d'environnement
Aucune variable d'environnement requise côté serveur.
La config Firebase est dans `shared/firebase.js` (côté client).

## Test du système

### 1. Test d'inscription
```bash
# Ouvrir
https://serveur-gps-medecin.onrender.com/dashboard/register.html

# Actions
1. Remplir le formulaire
2. Soumettre
3. Vérifier redirection vers login.html
4. Vérifier email reçu
```

### 2. Test de connexion sans vérification
```bash
# Ouvrir
https://serveur-gps-medecin.onrender.com/dashboard/login.html

# Actions
1. Se connecter avec compte non vérifié
2. Vérifier message d'avertissement
3. Cliquer "Renvoyer l'email"
4. Vérifier email reçu
```

### 3. Test de connexion avec vérification
```bash
# Actions
1. Cliquer sur le lien dans l'email
2. Retourner sur login.html
3. Se connecter
4. Vérifier redirection vers dashboard
```

### 4. Test de protection des routes
```bash
# Sans être connecté, essayer d'accéder:
https://serveur-gps-medecin.onrender.com/dashboard/
→ Doit rediriger vers login.html

https://serveur-gps-medecin.onrender.com/dashboard/fleet.html
→ Doit rediriger vers login.html
```

## Personnalisation de l'email de vérification

### Dans Firebase Console
1. Aller dans Authentication → Templates
2. Sélectionner "Email address verification"
3. Personnaliser:
   - Nom de l'expéditeur
   - Objet de l'email
   - Corps du message
   - URL de redirection après vérification

### URL de redirection recommandée
```
https://serveur-gps-medecin.onrender.com/dashboard/login.html
```

Après avoir cliqué sur le lien, l'utilisateur sera redirigé vers la page de login où il pourra se connecter avec son email maintenant vérifié.

## Dépannage

### L'email de vérification n'arrive pas
- Vérifier les spams
- Vérifier que Email/Password est activé dans Firebase
- Vérifier les quotas Firebase (limite d'envoi)

### Redirection infinie
- Vérifier que `emailVerified` est bien `true` après vérification
- Vider le cache du navigateur
- Vérifier la console pour les erreurs

### Utilisateur bloqué sur login
- Vérifier que l'email a bien été vérifié (Firebase Console → Authentication → Users)
- Forcer la vérification manuellement si nécessaire
- Renvoyer l'email de vérification

### Dashboard ne charge pas
- Vérifier la console JavaScript
- Vérifier que `bootstrap.js` est bien chargé
- Vérifier les règles Firebase Database
