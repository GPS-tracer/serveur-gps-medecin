# Requirements Document

## Introduction

GPS Tracker Congo sert plusieurs types d'utilisateurs. La logique actuelle contient des incohérences critiques : des pages web existent pour les élèves et étudiants alors qu'ils ne doivent pas avoir de dashboard, le QR Code MDM est générique alors qu'il devrait être lié au compte du client, et le vocabulaire "flotte/agents" est incorrect pour les parents qui suivent leurs enfants.

Cette spec couvre trois axes de refonte en une seule livraison cohérente :
1. Supprimer les rôles élève/étudiant du dashboard web
2. Adapter le dashboard pour les parents avec vocabulaire élèves
3. Créer un QR Code antivol personnalisé pour les comptes Particulier

## Requirements

### Section 1 — Nettoyage des rôles élève/étudiant

#### R1 — Suppression des pages web élève/étudiant

**User Story :** En tant que responsable produit, je veux supprimer les pages `panel-etudiant.html`, `register-eleve.js` et `register-etudiant.js`, afin que la plateforme web ne propose plus de comptes à des personnes qui sont suivies et non des utilisateurs actifs.

**Acceptance Criteria:**
1. `panel-etudiant.html` est supprimé (ou redirige vers `login.html` si des liens externes existent)
2. `register-eleve.js` et `register-etudiant.js` sont supprimés du projet
3. `PAGES_AUTORISEES` dans `post-login.js` ne contient plus `panel-etudiant.html`
4. Aucun lien de navigation ne pointe vers ces pages supprimées
5. Un utilisateur avec `role === 'eleve'` ou `role === 'etudiant'` qui tente de se connecter au dashboard web est redirigé vers une page d'erreur explicative ("Ce compte est uniquement accessible depuis l'application mobile")

#### R2 — Inscription élève/étudiant uniquement via l'app Android

**User Story :** En tant qu'élève ou étudiant, je veux m'inscrire uniquement depuis l'application Android en saisissant le code de mon parent ou établissement, afin de ne pas avoir besoin de créer un compte web.

**Acceptance Criteria:**
1. Le flux `OnboardingActivity.kt` reste inchangé pour les options "Étudiant" et "Élève"
2. Aucune page web d'inscription élève/étudiant n'existe ou n'est accessible
3. Le code parent saisi dans l'app Android est le companyId (UID Firebase) du compte parent/école
4. L'app Android écrit le lien sous `companies/{parentId}/eleves_lies/{deviceId}` comme actuellement

---

### Section 2 — Dashboard parent avec vocabulaire adapté

#### R3 — Vocabulaire adaptatif selon l'abonnement

**User Story :** En tant que parent ou directeur d'école connecté au dashboard, je veux voir "Mes élèves" ou "Mes étudiants" au lieu de "Ma Flotte" et "Agents", afin que l'interface corresponde à mon usage réel.

**Acceptance Criteria:**
1. Si `licence.type_abonnement === 'suivi_eleve'` : le titre de `fleet.html` affiche "Mes élèves", les agents sont appelés "élèves" partout dans l'UI
2. Si `licence.type_abonnement === 'suivi_etudiant'` : titre "Mes étudiants", agents appelés "étudiants"
3. Les icônes s'adaptent : 🎒 pour élève, 🎓 pour étudiant, 🚗/🏍️ pour flotte standard
4. Le formulaire "Ajouter un appareil" est remplacé par une section "Inviter un élève" qui affiche le code parent à partager
5. Ce changement de vocabulaire est détecté côté client (lecture de `companies/{uid}/licence`) sans rechargement de page

#### R4 — Code parent accessible facilement

**User Story :** En tant que parent avec un abonnement scolaire actif, je veux accéder facilement à mon code parent depuis mon dashboard, afin de pouvoir le transmettre à mon enfant ou à l'école.

**Acceptance Criteria:**
1. Dans `licence.html`, le bloc "Mon code parent" est affiché pour tout compte avec `abonnement_scolaire_expire > Date.now()`
2. Le code est copiable en un clic avec feedback visuel ("✅ Copié !")
3. Une instruction claire explique l'usage : "Donnez ce code à votre enfant pour qu'il le saisisse lors du premier lancement de l'application GPS Tracker"
4. Le bloc est déjà partiellement implémenté — s'assurer qu'il s'affiche correctement

---

### Section 3 — Compte Particulier antivol QR Code personnalisé

#### R5 — QR Code personnalisé pour téléphone neuf (Device Owner)

**User Story :** En tant que client particulier qui vient d'acheter un téléphone Android vierge, je veux scanner un QR Code lié à mon compte lors du premier démarrage, afin que l'app s'installe en mode Device Owner et soit automatiquement configurée avec mon compte sans aucune saisie manuelle.

**Acceptance Criteria:**
1. Le dashboard particulier (`index.html` ou `licence.html`) affiche un bouton "Générer mon QR Code antivol"
2. Le QR Code généré contient `PROVISIONING_ADMIN_EXTRAS_BUNDLE` avec `{"uid": "<uid_client>", "account_type": "particulier"}`
3. Lors du provisioning Android, `AdminReceiver.onProfileProvisioningComplete()` lit l'UID depuis le bundle et crée automatiquement le profil sans passer par `OnboardingActivity`
4. Le mode Device Owner est actif après provisioning : `DISALLOW_FACTORY_RESET`, `DISALLOW_UNINSTALL_APPS`, `DISALLOW_SAFE_BOOT` appliqués
5. `wipeData()` est disponible pour la destruction à distance
6. L'app Android écrit `isDeviceOwner: true` dans `companies/{uid}` après provisioning réussi

#### R6 — Installation classique APK (téléphone déjà utilisé)

**User Story :** En tant que client particulier avec un téléphone déjà configuré, je veux télécharger l'APK et créer mon compte depuis l'app, afin de bénéficier du tracking et des alertes antivol même sans Device Owner.

**Acceptance Criteria:**
1. Le flux "Particulier" dans `OnboardingActivity.kt` reste fonctionnel et inchangé
2. L'écran de choix dans `OnboardingActivity` affiche clairement la différence entre les deux modes : "Protection complète (téléphone neuf + QR Code)" vs "Protection standard (ce téléphone)"
3. Les alertes antivol email sont actives dans les deux cas
4. L'app Android écrit `isDeviceOwner: false` dans `companies/{uid}` pour ce cas
5. L'UI n'affiche pas le bouton "Destruction à distance" si `isDeviceOwner: false` (la destruction partielle reste disponible)

#### R7 — Indicateur de niveau de protection dans le dashboard

**User Story :** En tant que client particulier connecté au dashboard web, je veux voir le niveau de protection antivol actif sur mon appareil, afin de savoir si mon téléphone bénéficie de la protection totale ou partielle.

**Acceptance Criteria:**
1. Dans `index.html` ou `licence.html`, un badge affiche :
   - 🟢 "Protection totale — Device Owner actif" si `companies/{uid}/isDeviceOwner === true`
   - 🟡 "Protection standard — Installation APK" si `isDeviceOwner === false` ou absent
2. L'app Android écrit `isDeviceOwner: true/false` dans `companies/{uid}` au démarrage
3. Le badge est visible uniquement pour les comptes Particulier (pas pour les entreprises)
4. Un lien "Passer en protection totale" pointe vers les instructions QR Code si `isDeviceOwner === false`

---

## Résumé des acteurs et leurs accès

| Acteur | Dashboard web | App Android | Notes |
|---|---|---|---|
| Superadmin | `admin.html` | — | Gère toute la plateforme |
| Entreprise / École | `index.html` + `fleet.html` | — | Vocabulaire "flotte" ou "élèves" selon abonnement |
| Parent | `index.html` + `fleet.html` | — | Vocabulaire "élèves" adaptatif |
| Particulier | `index.html` + QR Code | Onboarding "Particulier" | Antivol total (QR) ou partiel (APK) |
| Élève / Étudiant | ❌ Pas de dashboard web | Onboarding avec code parent | Uniquement suivi GPS |

## Glossary

- **Device Owner** : mode MDM Android activé lors du provisioning sur téléphone vierge, donne des droits système complets (wipeData, restrictions usine)
- **companyId** : UID Firebase d'un compte — sert de code parent, code entreprise, et identifiant unique partout
- **eleves_lies** : nœud Firebase `companies/{parentId}/eleves_lies/{deviceId}` qui liste les appareils liés à un compte parent
- **isDeviceOwner** : champ booléen dans `companies/{uid}` indiquant si l'appareil est en mode Device Owner
- **suivi_eleve / suivi_etudiant** : types d'abonnement scolaire dans `companies/{uid}/licence.type_abonnement`
