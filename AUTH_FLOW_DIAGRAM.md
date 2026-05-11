# Diagramme du flux d'authentification

## Vue d'ensemble du système

```
┌─────────────────────────────────────────────────────────────────┐
│                     GPS TRACKER - AUTHENTICATION                 │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   Visiteur   │
└──────┬───────┘
       │
       ├─────────────────────────────────────────────────────────┐
       │                                                         │
       v                                                         v
┌──────────────┐                                        ┌──────────────┐
│  INSCRIPTION │                                        │   CONNEXION  │
│ register.html│                                        │  login.html  │
└──────┬───────┘                                        └──────┬───────┘
       │                                                       │
       │ 1. Remplir formulaire                                │ 1. Email + Password
       │ 2. Upload logo (opt)                                 │
       v                                                       v
┌──────────────────────┐                            ┌──────────────────────┐
│ Firebase Auth        │                            │ Firebase Auth        │
│ createUser()         │                            │ signIn()             │
└──────┬───────────────┘                            └──────┬───────────────┘
       │                                                    │
       │ 3. Compte créé                                     │
       v                                                    v
┌──────────────────────┐                            ┌──────────────────────┐
│ sendEmailVerification│                            │ Vérifier             │
│ Envoi auto           │                            │ emailVerified?       │
└──────┬───────────────┘                            └──────┬───────────────┘
       │                                                    │
       │ 4. Email envoyé                                    ├─── NON ───┐
       v                                                    │           │
┌──────────────────────┐                                   │           v
│ Realtime Database    │                                   │    ┌──────────────┐
│ companies/{uid}      │                                   │    │ Message:     │
│ Données société      │                                   │    │ "Vérifiez    │
└──────┬───────────────┘                                   │    │  votre email"│
       │                                                    │    └──────┬───────┘
       │ 5. Données sauvées                                 │           │
       v                                                    │           │
┌──────────────────────┐                                   │    ┌──────v───────┐
│ Redirect login.html  │                                   │    │ Bouton:      │
│ Message: "Vérifiez   │                                   │    │ "Renvoyer    │
│  votre email"        │                                   │    │  l'email"    │
└──────────────────────┘                                   │    └──────────────┘
                                                           │
                                                           │
                                                          OUI
                                                           │
                                                           v
                                                    ┌──────────────────────┐
                                                    │ Redirect dashboard   │
                                                    │ index.html           │
                                                    └──────┬───────────────┘
                                                           │
                                                           v
                                                    ┌──────────────────────┐
                                                    │ bootstrap.js         │
                                                    │ Vérif auth + email   │
                                                    └──────┬───────────────┘
                                                           │
                                                           v
                                                    ┌──────────────────────┐
                                                    │ DASHBOARD            │
                                                    │ Carte + Agents       │
                                                    └──────────────────────┘
```

## Flux de vérification d'email

```
┌─────────────────────────────────────────────────────────────────┐
│                    EMAIL VERIFICATION FLOW                       │
└─────────────────────────────────────────────────────────────────┘

1. INSCRIPTION
   ┌──────────────┐
   │ Utilisateur  │
   │ s'inscrit    │
   └──────┬───────┘
          │
          v
   ┌──────────────────────┐
   │ Firebase Auth        │
   │ Crée le compte       │
   │ emailVerified: false │
   └──────┬───────────────┘
          │
          v
   ┌──────────────────────┐
   │ sendEmailVerification│
   │ Envoi automatique    │
   └──────┬───────────────┘
          │
          v
   ┌──────────────────────┐
   │ Email reçu           │
   │ Lien de vérification │
   └──────────────────────┘

2. VÉRIFICATION
   ┌──────────────────────┐
   │ Utilisateur clique   │
   │ sur le lien          │
   └──────┬───────────────┘
          │
          v
   ┌──────────────────────┐
   │ Firebase vérifie     │
   │ emailVerified: true  │
   └──────┬───────────────┘
          │
          v
   ┌──────────────────────┐
   │ Redirect login.html  │
   │ (optionnel)          │
   └──────────────────────┘

3. CONNEXION
   ┌──────────────────────┐
   │ Utilisateur se       │
   │ connecte             │
   └──────┬───────────────┘
          │
          v
   ┌──────────────────────┐
   │ Vérif credentials    │
   └──────┬───────────────┘
          │
          v
   ┌──────────────────────┐
   │ Vérif emailVerified  │
   └──────┬───────────────┘
          │
          ├─── false ───> Message + Bouton renvoyer
          │
          └─── true ────> Accès dashboard
```

## Protection des routes

```
┌─────────────────────────────────────────────────────────────────┐
│                      ROUTE PROTECTION                            │
└─────────────────────────────────────────────────────────────────┘

REQUÊTE: /dashboard/index.html
   │
   v
┌──────────────────────┐
│ bootstrap.js         │
│ onAuthStateChanged   │
└──────┬───────────────┘
       │
       v
┌──────────────────────┐
│ user existe?         │
└──────┬───────────────┘
       │
       ├─── NON ───> Redirect login.html
       │
       └─── OUI
            │
            v
     ┌──────────────────────┐
     │ emailVerified?       │
     └──────┬───────────────┘
            │
            ├─── NON ───> signOut() + Redirect login.html
            │
            └─── OUI
                 │
                 v
          ┌──────────────────────┐
          │ Charger app.js       │
          │ Afficher dashboard   │
          └──────────────────────┘


REQUÊTE: /dashboard/fleet.html
   │
   v
┌──────────────────────┐
│ fleet.js             │
│ onAuthStateChanged   │
└──────┬───────────────┘
       │
       v
┌──────────────────────┐
│ user existe?         │
└──────┬───────────────┘
       │
       ├─── NON ───> Redirect login.html
       │
       └─── OUI
            │
            v
     ┌──────────────────────┐
     │ emailVerified?       │
     └──────┬───────────────┘
            │
            ├─── NON ───> signOut() + Redirect login.html
            │
            └─── OUI
                 │
                 v
          ┌──────────────────────┐
          │ Charger données      │
          │ Afficher fleet       │
          └──────────────────────┘
```

## États de l'utilisateur

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER STATES                               │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│ ÉTAT 1: Anonyme      │
│ user = null          │
│ emailVerified = N/A  │
├──────────────────────┤
│ Accès:               │
│ ✅ login.html        │
│ ✅ register.html     │
│ ❌ dashboard         │
│ ❌ fleet.html        │
└──────────────────────┘

┌──────────────────────┐
│ ÉTAT 2: Inscrit      │
│ user = {...}         │
│ emailVerified = false│
├──────────────────────┤
│ Accès:               │
│ ✅ login.html        │
│ ⚠️  Message affiché  │
│ ❌ dashboard         │
│ ❌ fleet.html        │
└──────────────────────┘

┌──────────────────────┐
│ ÉTAT 3: Vérifié      │
│ user = {...}         │
│ emailVerified = true │
├──────────────────────┤
│ Accès:               │
│ ✅ dashboard         │
│ ✅ fleet.html        │
│ ↪️  login.html       │
│    (redirect auto)   │
└──────────────────────┘
```

## Matrice de routage

```
┌─────────────────────────────────────────────────────────────────┐
│                      ROUTING MATRIX                              │
└─────────────────────────────────────────────────────────────────┘

Route              │ Anonyme │ Non vérifié │ Vérifié
───────────────────┼─────────┼─────────────┼─────────
/                  │ → /dash │ → /dash     │ → /dash
/dashboard/        │ → login │ → login     │ ✅ OK
/dashboard/login   │ ✅ OK   │ ✅ OK       │ → /dash
/dashboard/register│ ✅ OK   │ ✅ OK       │ → /dash
/dashboard/fleet   │ → login │ → login     │ ✅ OK
/agent/            │ ✅ OK   │ ✅ OK       │ ✅ OK

Légende:
✅ OK       = Accès autorisé
→ /dash     = Redirect vers dashboard
→ login     = Redirect vers login.html
```

## Séquence de messages

```
┌─────────────────────────────────────────────────────────────────┐
│                    MESSAGE SEQUENCE                              │
└─────────────────────────────────────────────────────────────────┘

INSCRIPTION RÉUSSIE:
┌────────────────────────────────────────────────────┐
│ ✅ Compte créé avec succès!                        │
│    Vérifiez votre email pour activer votre compte │
│                                                    │
│    [Redirection vers login dans 3s...]            │
└────────────────────────────────────────────────────┘

CONNEXION - EMAIL NON VÉRIFIÉ:
┌────────────────────────────────────────────────────┐
│ ⚠️  Veuillez confirmer votre compte via le lien   │
│     envoyé à votre adresse email                  │
│                                                    │
│ ┌────────────────────────────────────────────┐   │
│ │ 📧 Un email de vérification a été envoyé   │   │
│ │    Cliquez sur le lien pour activer        │   │
│ │                                             │   │
│ │    [Renvoyer l'email]                      │   │
│ └────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘

EMAIL RENVOYÉ:
┌────────────────────────────────────────────────────┐
│ ✅ Email de vérification renvoyé!                  │
│    Vérifiez votre boîte de réception              │
└────────────────────────────────────────────────────┘

CONNEXION RÉUSSIE:
┌────────────────────────────────────────────────────┐
│ [Redirection automatique vers dashboard...]       │
└────────────────────────────────────────────────────┘
```

## Architecture des fichiers

```
gps-tracker/
│
├── index.html                    # Redirection vers /dashboard/
│
├── dashboard/
│   ├── login.html               # ✅ Page de connexion
│   ├── login.js                 # ✅ Logique connexion + vérif email
│   ├── register.html            # ✅ Page d'inscription
│   ├── register.js              # ✅ Logique inscription + envoi email
│   ├── index.html               # 🔒 Dashboard principal (protégé)
│   ├── bootstrap.js             # 🔒 Protection + chargement
│   ├── app.js                   # 🔒 Logique dashboard
│   ├── fleet.html               # 🔒 Gestion flotte (protégé)
│   ├── fleet.js                 # 🔒 Logique fleet + protection
│   └── auth-guard.js            # 🛡️  Module de protection (optionnel)
│
├── shared/
│   └── firebase.js              # Configuration Firebase
│
└── server.js                    # Serveur Express

Légende:
✅ = Public (accessible sans auth)
🔒 = Protégé (auth + email vérifié requis)
🛡️  = Utilitaire de sécurité
```
