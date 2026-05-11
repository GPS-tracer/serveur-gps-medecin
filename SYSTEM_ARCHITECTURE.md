# GPS Tracker - Architecture système

## Structure des données Firebase

### `agents/{agentId}`
Chaque agent est stocké à la racine avec son ID unique.

**Champs créés par le dashboard:**
- `companyId` (string) - UID de la société propriétaire
- `name` (string) - Nom de l'agent
- `vehicleType` (string) - Type: "moto", "voiture", "camion"
- `phone` (string|null) - Téléphone optionnel
- `status` (string) - "active"
- `createdAt` (number) - Timestamp de création

**Champs mis à jour par l'app Android:**
- `lat` (number) - Latitude actuelle
- `lng` (number) - Longitude actuelle
- `lastUpdate` (number) - Timestamp de la dernière position
- `history/{timestamp}/lat` (number) - Historique des positions
- `history/{timestamp}/lng` (number) - Historique des positions

### `companies/{uid}`
Informations des sociétés inscrites.

**Champs:**
- `companyName` (string) - Nom de la société
- `sector` (string) - Secteur d'activité
- `address` (string) - Adresse complète
- `email` (string) - Email de connexion
- `logoUrl` (string|null) - URL du logo dans Storage
- `role` (string) - "company"
- `status` (string) - "active"
- `createdAt` (number) - Timestamp d'inscription

## Flux de données

### 1. Inscription d'une société
1. Société remplit le formulaire sur `register.html`
2. Création du compte Firebase Auth
3. Upload du logo dans Storage: `logos/{uid}/{filename}`
4. Enregistrement dans `companies/{uid}`

### 2. Ajout d'un agent
1. Admin se connecte et va sur `fleet.html`
2. Remplit: nom, ID unique, type de véhicule, téléphone
3. Création dans `agents/{agentId}` avec `companyId`
4. Initialisation des champs GPS à null

### 3. Tracking GPS (Android)
1. Agent entre son ID dans l'app Android
2. App demande les permissions GPS
3. Service en arrière-plan envoie position toutes les 10s
4. Mise à jour de `agents/{agentId}/lat`, `lng`, `lastUpdate`, `history`

### 4. Visualisation (Dashboard)
1. Admin se connecte sur `index.html`
2. Dashboard charge tous les agents depuis `agents/`
3. **Filtre par `companyId`** pour n'afficher que ses agents
4. Affichage en temps réel sur la carte Leaflet
5. Historique des trajets par agent et par jour

## Sécurité Firebase

### Règles actuelles
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

**Notes:**
- Lecture des agents: tout utilisateur authentifié (pour le dashboard)
- Écriture des agents: ouverte (pour l'app Android non authentifiée)
- Lecture/écriture companies: uniquement le propriétaire

## Compatibilité Android

### Versions supportées
- **minSdk 21** (Android 5.0 Lollipop)
- **targetSdk 34** (Android 14)

### Permissions
- `ACCESS_FINE_LOCATION` - GPS précis
- `ACCESS_COARSE_LOCATION` - GPS approximatif
- `ACCESS_BACKGROUND_LOCATION` - GPS en arrière-plan (Android 10+)
- `FOREGROUND_SERVICE` - Service persistant
- `RECEIVE_BOOT_COMPLETED` - Démarrage automatique

### Optimisations
- GPS sur thread dédié (pas le thread principal)
- Service en foreground avec notification
- Redémarrage automatique (START_STICKY)
- Gestion d'erreur Firebase avec logs

## Déploiement

### Serveur (Render)
- URL: `https://serveur-gps-medecin.onrender.com`
- Dashboard: `/dashboard/`
- Agent web: `/agent/`
- Fichiers: `server.js`, `package.json`, `render.yaml`

### APK Android
1. Compiler: `cd android && ./gradlew assembleRelease`
2. APK: `android/app/build/outputs/apk/release/app-release.apk`
3. Compresser en ZIP avant envoi (évite corruption)

### Firebase
- Projet: `db-tracker-d39a7`
- Realtime Database: activée
- Authentication: Email/Password activée
- Storage: activé pour logos

## Points d'amélioration futurs

1. **Lecture config depuis Firebase dans Android**
   - L'app pourrait lire `vehicleType`, `name` depuis Firebase
   - Éviterait la saisie manuelle dans l'app

2. **Limitation de l'historique**
   - Actuellement l'historique grossit indéfiniment
   - Ajouter une limite (ex: 100 derniers points)

3. **Sécurité renforcée**
   - Authentifier l'app Android
   - Règles Firebase plus strictes par `companyId`

4. **Notifications**
   - Alertes si agent hors zone
   - Notifications push pour événements

5. **Rapports**
   - Distance parcourue par jour
   - Temps d'activité
   - Export PDF/Excel
