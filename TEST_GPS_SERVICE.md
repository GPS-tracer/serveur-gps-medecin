# Guide de test - Service GPS amélioré

## 🎯 Objectif

Tester toutes les nouvelles fonctionnalités du service GPS.

## 📋 Prérequis

- Android Studio installé
- Appareil Android (physique recommandé)
- Connexion Internet
- Firebase configuré

## 🔨 Compilation

### 1. Compiler l'APK

```bash
cd android
./gradlew assembleDebug
```

**Résultat attendu:**
```
BUILD SUCCESSFUL
APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### 2. Installer sur l'appareil

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

Ou via Android Studio: Run → Run 'app'

## 🧪 Tests fonctionnels

### Test 1: Démarrage du service

**Étapes:**
1. Ouvrir l'app GPS Tracker
2. Entrer un ID agent (ex: "TEST001")
3. Cliquer "Enregistrer et démarrer"
4. Accorder les permissions GPS

**Résultat attendu:**
- ✅ Notification apparaît: "🛰️ GPS Tracker actif"
- ✅ Message: "Initialisation du GPS..."
- ✅ Après quelques secondes: coordonnées affichées
- ✅ Format: "📍 lat, lng\n🚗 speed km/h • 📊 ±Xm • #count"

### Test 2: Données dans Firebase

**Étapes:**
1. Service démarré depuis 30 secondes
2. Ouvrir Firebase Console → Realtime Database
3. Naviguer vers `agents/TEST001`

**Résultat attendu:**
```json
{
  "lat": -4.7761,
  "lng": 11.8635,
  "lastUpdate": 1234567890,
  "speed": 0.0,
  "accuracy": 8.2,
  "altitude": 325.0,
  "bearing": 0.0,
  "provider": "gps",
  "totalDistance": 0.0,
  "updateCount": 3,
  "name": "...",
  "phone": "...",
  "history": {
    "1234567890": {
      "lat": -4.7761,
      "lng": 11.8635,
      "speed": 0.0,
      "accuracy": 8.2
    }
  }
}
```

### Test 3: Notification interactive

**Étapes:**
1. Service actif
2. Dérouler la notification
3. Observer les informations
4. Cliquer sur "Arrêter"

**Résultat attendu:**
- ✅ Notification affiche coordonnées, vitesse, précision, compteur
- ✅ Clic sur notification ouvre l'app
- ✅ Bouton "Arrêter" arrête le service
- ✅ Notification disparaît

### Test 4: Mouvement et vitesse

**Étapes:**
1. Service actif
2. Se déplacer (marcher, voiture, etc.)
3. Observer la notification

**Résultat attendu:**
- ✅ Coordonnées changent
- ✅ Vitesse affichée (km/h)
- ✅ Compteur augmente
- ✅ Distance totale augmente dans Firebase

### Test 5: Remote Config

**Étapes:**
1. Firebase Console → Remote Config
2. Créer paramètre `gps_update_interval_seconds` = 5
3. Publier
4. Redémarrer l'app
5. Observer les logs

**Résultat attendu:**
```bash
adb logcat | grep LocationService
# Doit afficher:
LocationService: Remote Config récupéré avec succès
LocationService: Configuration appliquée: interval=5000ms, ...
```

### Test 6: Redémarrage automatique (START_STICKY)

**Étapes:**
1. Service actif
2. Forcer l'arrêt de l'app:
   ```bash
   adb shell am force-stop com.gpstracker.agent
   ```
3. Attendre 10-30 secondes
4. Vérifier la notification

**Résultat attendu:**
- ✅ Service redémarre automatiquement
- ✅ Notification réapparaît
- ✅ Tracking continue

### Test 7: Statistiques de session

**Étapes:**
1. Service actif pendant 5 minutes
2. Se déplacer un peu
3. Arrêter le service
4. Vérifier Firebase: `agents/TEST001/lastSession`

**Résultat attendu:**
```json
{
  "lastSession": {
    "endTime": 1234567890,
    "totalUpdates": 30,
    "totalDistance": 450.5,
    "duration": 300000
  }
}
```

### Test 8: Limitation de l'historique

**Étapes:**
1. Configurer Remote Config: `gps_max_history_points` = 10
2. Laisser tourner jusqu'à avoir 15+ points
3. Vérifier Firebase: `agents/TEST001/history`

**Résultat attendu:**
- ✅ Maximum 10 points dans l'historique
- ✅ Points les plus anciens supprimés automatiquement

### Test 9: Compatibilité Android 14+

**Étapes:**
1. Tester sur Android 14 ou supérieur
2. Démarrer le service
3. Vérifier la notification

**Résultat attendu:**
- ✅ Notification s'affiche correctement
- ✅ Pas d'erreur de permission
- ✅ Service fonctionne normalement

### Test 10: Gestion d'erreurs

**Étapes:**
1. Désactiver le GPS dans les paramètres
2. Démarrer le service
3. Observer la notification

**Résultat attendu:**
- ✅ Notification affiche: "⚠️ GPS non disponible"
- ✅ Service ne crash pas
- ✅ Logs montrent l'erreur

## 📊 Logs de débogage

### Commandes utiles

```bash
# Tous les logs du service
adb logcat | grep LocationService

# Logs Remote Config
adb logcat | grep RemoteConfig

# Logs Firebase
adb logcat | grep Firebase

# Effacer les logs
adb logcat -c

# Logs en temps réel avec filtre
adb logcat LocationService:D *:S
```

### Logs attendus

**Démarrage:**
```
LocationService: Service créé
LocationService: Remote Config récupéré avec succès
LocationService: Configuration appliquée: interval=10000ms, minDistance=5.0m, maxHistory=1000
LocationService: Mises à jour GPS démarrées
```

**Mise à jour GPS:**
```
LocationService: Position #1: lat=-4.7761, lng=11.8635, speed=0.0km/h, accuracy=8.2m
LocationService: Données envoyées à Firebase avec succès
```

**Arrêt:**
```
LocationService: Arrêt du service demandé
LocationService: Service détruit
LocationService: Statistiques sauvegardées: 30 updates, 450.50m parcourus
```

## 🔍 Vérifications Firebase

### Realtime Database

**Chemin:** `agents/TEST001`

**Vérifier:**
- ✅ `lat` et `lng` présents et valides
- ✅ `lastUpdate` récent (< 30 secondes)
- ✅ `speed` présent (peut être 0)
- ✅ `accuracy` présent
- ✅ `updateCount` augmente
- ✅ `history` contient des points
- ✅ `lastSession` créé après arrêt

### Remote Config

**Chemin:** Firebase Console → Remote Config

**Vérifier:**
- ✅ Paramètres créés
- ✅ Valeurs publiées
- ✅ Fetch count > 0 (dans Analytics)

## 🐛 Problèmes courants

### Service ne démarre pas

**Causes possibles:**
- Permissions GPS non accordées
- Erreur de compilation
- Firebase non configuré

**Solutions:**
1. Vérifier les permissions dans l'app
2. Vérifier les logs: `adb logcat | grep LocationService`
3. Vérifier `google-services.json` présent

### Notification n'apparaît pas

**Causes possibles:**
- Notifications désactivées pour l'app
- Android 13+ sans permission POST_NOTIFICATIONS

**Solutions:**
1. Paramètres → Apps → GPS Tracker → Notifications → Activer
2. Accorder la permission notifications

### Données non envoyées à Firebase

**Causes possibles:**
- Pas de connexion Internet
- Règles Firebase trop restrictives
- Agent ID non configuré

**Solutions:**
1. Vérifier la connexion Internet
2. Vérifier les règles Firebase (`.write: true`)
3. Vérifier que l'ID agent est saisi

### Remote Config ne fonctionne pas

**Causes possibles:**
- Paramètres non publiés
- Pas de connexion Internet
- Cache de 1 heure

**Solutions:**
1. Publier les modifications dans Firebase Console
2. Vérifier la connexion
3. Redémarrer l'app pour forcer la récupération

### Service s'arrête tout seul

**Causes possibles:**
- Optimisation batterie agressive
- Pas de WakeLock
- Erreur dans le code

**Solutions:**
1. Désactiver l'optimisation batterie pour l'app
2. Vérifier les logs pour les erreurs
3. START_STICKY devrait le redémarrer automatiquement

## 📈 Métriques de performance

### À surveiller

**Batterie:**
- Consommation: ~5-8% par heure (mode standard)
- Acceptable pour 8h de travail

**Données:**
- ~180 KB par heure (10s interval)
- ~1.4 MB par jour (8h)

**Firebase:**
- ~360 écritures par heure
- ~2880 écritures par jour (8h)

### Outils de mesure

```bash
# Batterie
adb shell dumpsys batterystats | grep com.gpstracker.agent

# Données réseau
adb shell dumpsys netstats | grep com.gpstracker.agent

# Mémoire
adb shell dumpsys meminfo com.gpstracker.agent
```

## ✅ Checklist de validation

### Fonctionnalités de base
- [ ] Service démarre correctement
- [ ] Notification s'affiche
- [ ] Coordonnées GPS récupérées
- [ ] Données envoyées à Firebase

### Fonctionnalités avancées
- [ ] Remote Config fonctionne
- [ ] Vitesse affichée correctement
- [ ] Précision affichée
- [ ] Compteur de mises à jour
- [ ] Distance totale calculée

### Robustesse
- [ ] Service redémarre après kill
- [ ] Gestion GPS non disponible
- [ ] Gestion erreur Firebase
- [ ] Nettoyage historique fonctionne
- [ ] Statistiques sauvegardées

### Compatibilité
- [ ] Fonctionne sur Android 5.0+
- [ ] Fonctionne sur Android 14+
- [ ] Notification interactive
- [ ] Bouton "Arrêter" fonctionne

### Performance
- [ ] Consommation batterie acceptable
- [ ] Consommation données raisonnable
- [ ] Pas de lag ou freeze
- [ ] Mémoire stable

## 🎉 Validation finale

Si tous les tests passent:
- ✅ Service GPS prêt pour la production
- ✅ Toutes les fonctionnalités implémentées
- ✅ Robuste et performant
- ✅ Compatible Android 14+

Prêt à déployer! 🚀
