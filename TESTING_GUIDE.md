# Guide de test - GPS Tracker

## Test complet du système

### 1. Test de l'inscription société

**URL:** `https://serveur-gps-medecin.onrender.com/dashboard/register.html`

**Étapes:**
1. Remplir tous les champs:
   - Nom de la société
   - Secteur (Moto/Voiture/Camion/Scolaire)
   - Adresse complète
   - Email (unique)
   - Mot de passe (min 6 caractères)
2. Uploader un logo (max 5MB, JPG/PNG)
3. Cliquer "Créer mon compte"

**Résultat attendu:**
- ✅ Message de succès
- ✅ Redirection vers login.html
- ✅ Logo uploadé dans Firebase Storage
- ✅ Compte créé dans Firebase Auth
- ✅ Données dans `companies/{uid}`

### 2. Test de connexion

**URL:** `https://serveur-gps-medecin.onrender.com/dashboard/login.html`

**Étapes:**
1. Entrer email et mot de passe
2. Cliquer "Se connecter"

**Résultat attendu:**
- ✅ Redirection vers index.html (dashboard)
- ✅ Nom de la société affiché
- ✅ Bouton "Fleet" visible

### 3. Test de gestion de flotte

**URL:** `https://serveur-gps-medecin.onrender.com/dashboard/fleet.html`

**Étapes:**
1. Cliquer sur "🚗 Fleet" dans le dashboard
2. Remplir le formulaire:
   - Nom de l'agent: "Agent Test 1"
   - Identifiant: "TEST001" (alphanumérique uniquement)
   - Type de véhicule: Moto
   - Téléphone: "+242 06 123 4567" (optionnel)
3. Cliquer "Ajouter l'agent"

**Résultat attendu:**
- ✅ Message "Agent ajouté avec succès"
- ✅ Agent apparaît dans la liste
- ✅ Icône 🏍️ pour moto
- ✅ Données dans `agents/TEST001` avec `companyId`

**Vérifier dans Firebase:**
```json
{
  "agents": {
    "TEST001": {
      "name": "Agent Test 1",
      "vehicleType": "moto",
      "phone": "+242 06 123 4567",
      "companyId": "uid_de_la_societe",
      "status": "active",
      "createdAt": 1234567890,
      "lat": null,
      "lng": null,
      "lastUpdate": null,
      "history": {}
    }
  }
}
```

### 4. Test de l'app Android

**Prérequis:**
- APK installé sur téléphone Android
- Permissions GPS accordées

**Étapes:**
1. Ouvrir l'app GPS Tracker
2. Entrer l'identifiant: "TEST001"
3. Entrer le nom: "Agent Test 1"
4. Entrer le téléphone (optionnel)
5. Cliquer "Enregistrer et démarrer"
6. Accorder les permissions GPS
7. Laisser l'app tourner 30 secondes

**Résultat attendu:**
- ✅ Notification "GPS Tracker actif"
- ✅ Coordonnées affichées dans la notification
- ✅ Données envoyées à Firebase toutes les 10s

**Vérifier dans Firebase:**
```json
{
  "agents": {
    "TEST001": {
      "lat": -4.7761,
      "lng": 11.8635,
      "lastUpdate": 1234567890,
      "history": {
        "1234567890": {
          "lat": -4.7761,
          "lng": 11.8635
        }
      }
    }
  }
}
```

### 5. Test du dashboard en temps réel

**URL:** `https://serveur-gps-medecin.onrender.com/dashboard/`

**Étapes:**
1. Retourner sur le dashboard (index.html)
2. Vérifier que l'agent TEST001 apparaît
3. Vérifier le statut "Online" (si lastUpdate < 2 min)
4. Cliquer sur l'agent dans la liste

**Résultat attendu:**
- ✅ Agent visible sur la carte avec marqueur
- ✅ Statut "Online" en vert
- ✅ Coordonnées affichées
- ✅ Adresse géocodée (ex: "Quartier, Ville")
- ✅ Popup avec détails au clic
- ✅ Carte centrée sur l'agent

### 6. Test de l'historique

**Étapes:**
1. Dans le dashboard, section "Movement history"
2. Sélectionner "TEST001" dans le menu déroulant
3. Sélectionner la date du jour
4. Attendre quelques secondes

**Résultat attendu:**
- ✅ Ligne bleue (polyline) sur la carte
- ✅ Message "X points — polyline shown"
- ✅ Carte zoomée sur le trajet

### 7. Test du filtrage par société

**Étapes:**
1. Créer une 2ème société avec un autre email
2. Se connecter avec la 2ème société
3. Ajouter un agent "TEST002"
4. Vérifier le dashboard

**Résultat attendu:**
- ✅ Société 1 voit uniquement TEST001
- ✅ Société 2 voit uniquement TEST002
- ✅ Chaque société voit ses propres agents

### 8. Test de suppression

**Étapes:**
1. Dans fleet.html, cliquer sur l'icône poubelle
2. Confirmer la suppression

**Résultat attendu:**
- ✅ Modal de confirmation
- ✅ Agent supprimé de la liste
- ✅ Agent supprimé de Firebase
- ✅ Agent disparaît du dashboard

## Problèmes courants

### Agent n'apparaît pas sur le dashboard
- ✅ Vérifier que `companyId` correspond à l'UID de la société
- ✅ Vérifier que `lat` et `lng` ne sont pas null
- ✅ Vérifier les règles Firebase (`.read: "auth != null"`)

### App Android ne se connecte pas
- ✅ Vérifier `google-services.json` dans `android/app/`
- ✅ Vérifier les permissions GPS
- ✅ Vérifier la connexion Internet
- ✅ Regarder les logs: `adb logcat | grep GPS`

### Statut "Offline" alors que l'app tourne
- ✅ Vérifier que `lastUpdate` est récent (< 2 min)
- ✅ Vérifier que l'app envoie bien toutes les 10s
- ✅ Vérifier l'horloge du téléphone

### Historique ne s'affiche pas
- ✅ Vérifier que `history/{timestamp}` existe dans Firebase
- ✅ Vérifier la date sélectionnée (format YYYY-MM-DD)
- ✅ Besoin d'au moins 2 points pour tracer une ligne

## Commandes utiles

### Compiler l'APK
```bash
cd android
./gradlew assembleRelease
```

### Voir les logs Android
```bash
adb logcat | grep -E "GPS|Firebase"
```

### Déployer sur Render
```bash
git add .
git commit -m "Update"
git push origin main
```

### Tester localement
```bash
npm install
node server.js
# Ouvrir http://localhost:3000/dashboard/
```

## Checklist finale

- [ ] Inscription société fonctionne
- [ ] Connexion fonctionne
- [ ] Ajout d'agent fonctionne
- [ ] App Android envoie GPS
- [ ] Dashboard affiche agents en temps réel
- [ ] Filtrage par société fonctionne
- [ ] Historique s'affiche
- [ ] Suppression fonctionne
- [ ] Statut Online/Offline correct
- [ ] Géocodage des adresses fonctionne
