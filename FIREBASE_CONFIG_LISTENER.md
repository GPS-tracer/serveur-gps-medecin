# Listener de configuration Firebase en temps réel

## 🎯 Fonctionnalité

Surveillance en temps réel des changements de configuration depuis le dashboard via Firebase Realtime Database.

## 📊 Fonctionnement

### Architecture

```
Dashboard (Web)                    Firebase                    App Android
     │                                │                              │
     │  Modifie vehicleType          │                              │
     ├────────────────────────────────>                              │
     │                                │                              │
     │                                │  ValueEventListener          │
     │                                ├──────────────────────────────>
     │                                │                              │
     │                                │  onDataChange()              │
     │                                │  - vehicleType               │
     │                                │  - name                      │
     │                                │  - phone                     │
     │                                │  - companyId                 │
     │                                │                              │
     │                                │  Sauvegarde locale           │
     │                                │  (SharedPreferences)         │
     │                                │                              │
     │                                │  Notification utilisateur    │
     │                                │  "Type véhicule mis à jour"  │
```

### Données surveillées

**Chemin Firebase:** `agents/{id_agent}`

**Champs écoutés:**
- `vehicleType` - Type de véhicule (moto, voiture, camion)
- `name` - Nom de l'agent
- `phone` - Téléphone
- `companyId` - ID de la société propriétaire

### Exemple de données Firebase

```json
{
  "agents": {
    "AGENT001": {
      "vehicleType": "moto",
      "name": "Agent Test",
      "phone": "+242 06 123 4567",
      "companyId": "uid_societe_123",
      "lat": -4.7761,
      "lng": 11.8635,
      "lastUpdate": 1234567890,
      ...
    }
  }
}
```

## 🔄 Cycle de vie du listener

### 1. Démarrage (onCreate)

```kotlin
startConfigListener()
  ↓
loadLocalConfig() // Charge config existante
  ↓
agentRef.addValueEventListener(configListener)
  ↓
Log: "🎧 Listener de configuration démarré pour agent: AGENT001"
```

### 2. Réception de données (onDataChange)

```kotlin
onDataChange(snapshot)
  ↓
Récupération des données:
  - vehicleType
  - name
  - phone
  - companyId
  ↓
Vérification changement vehicleType
  ↓
Mise à jour variables locales
  ↓
saveLocalConfig() // SharedPreferences
  ↓
Si changement → onVehicleTypeChanged()
```

### 3. Changement de type de véhicule

```kotlin
onVehicleTypeChanged("moto")
  ↓
Log: "🚗 Type de véhicule modifié: voiture → moto"
  ↓
showConfigChangeNotification()
  ↓
Notification: "Type de véhicule mis à jour - Nouveau type: Moto 🏍️"
  ↓
adjustTrackingParameters("moto")
  ↓
Log: "🏍️ Mode Moto: tracking haute fréquence"
```

### 4. Arrêt (onDestroy)

```kotlin
onDestroy()
  ↓
agentRef.removeEventListener(configListener)
  ↓
Log: "🎧 Listener de configuration arrêté"
```

## 💾 Stockage local (SharedPreferences)

### Fichier: `gps_tracker`

**Clés:**
- `device_id` - ID de l'agent
- `vehicleType` - Type de véhicule
- `name` - Nom
- `phone` - Téléphone
- `companyId` - ID société

### Exemple

```kotlin
SharedPreferences: gps_tracker
{
  "device_id": "AGENT001",
  "vehicleType": "moto",
  "name": "Agent Test",
  "phone": "+242 06 123 4567",
  "companyId": "uid_societe_123"
}
```

### Avantages

- ✅ Accès hors ligne
- ✅ Persistance entre redémarrages
- ✅ Pas besoin de connexion pour lire la config
- ✅ Synchronisation automatique quand connexion revient

## 📱 Notification de changement

### Déclenchement

Quand `vehicleType` change dans Firebase:

```
Ancien: "voiture"
Nouveau: "moto"
→ Notification affichée
```

### Format de la notification

```
Titre: Type de véhicule mis à jour
Message: Nouveau type: Moto 🏍️
Icône: ℹ️
Priorité: HIGH
Auto-cancel: true
```

### Icônes par type

| Type | Icône | Label |
|------|-------|-------|
| moto | 🏍️ | Moto 🏍️ |
| voiture | 🚗 | Voiture 🚗 |
| camion | 🚚 | Camion 🚚 |

## 🎛️ Ajustement des paramètres

### Par type de véhicule

```kotlin
when (vehicleType) {
    "moto" -> {
        // Tracking haute fréquence
        // Idéal pour livraisons rapides
        Log: "🏍️ Mode Moto: tracking haute fréquence"
    }
    "voiture" -> {
        // Tracking standard
        Log: "🚗 Mode Voiture: tracking standard"
    }
    "camion" -> {
        // Tracking optimisé
        // Économie carburant
        Log: "🚚 Mode Camion: tracking optimisé"
    }
}
```

### Note

Les intervalles GPS sont gérés par **Firebase Remote Config**.
Cette fonction peut être étendue pour des ajustements spécifiques par véhicule.

## 🔍 Logs de débogage

### Commandes

```bash
# Tous les logs du listener
adb logcat | grep "🎧\|📥\|🚗\|💾"

# Logs de configuration
adb logcat LocationService:D *:S | grep config
```

### Logs typiques

**Démarrage:**
```
LocationService: 🎧 Listener de configuration démarré pour agent: AGENT001
```

**Réception de données:**
```
LocationService: 📥 Configuration reçue de Firebase: vehicleType=moto, name=Agent Test, companyId=uid_123
LocationService: 💾 Configuration sauvegardée localement
```

**Changement de type:**
```
LocationService: 🚗 Type de véhicule modifié: voiture → moto
LocationService: 📢 Notification affichée: Type de véhicule mis à jour - Nouveau type: Moto 🏍️
LocationService: 🏍️ Mode Moto: tracking haute fréquence
```

**Arrêt:**
```
LocationService: 🎧 Listener de configuration arrêté
```

## 🧪 Tests

### Test 1: Changement depuis le dashboard

**Étapes:**
1. App Android démarrée avec agent "AGENT001"
2. Dashboard → Fleet → Modifier agent
3. Changer type: Voiture → Moto
4. Sauvegarder

**Résultat attendu:**
- ✅ Notification sur le téléphone: "Type de véhicule mis à jour"
- ✅ Log: "🚗 Type de véhicule modifié: voiture → moto"
- ✅ SharedPreferences mis à jour
- ✅ Icône dans notification principale: 🏍️

### Test 2: Démarrage avec config existante

**Étapes:**
1. Agent configuré dans Firebase avec vehicleType="camion"
2. Démarrer l'app Android
3. Observer les logs

**Résultat attendu:**
- ✅ Log: "📥 Configuration reçue de Firebase: vehicleType=camion, ..."
- ✅ Log: "💾 Configuration sauvegardée localement"
- ✅ Notification affiche: 🚚

### Test 3: Mode hors ligne

**Étapes:**
1. App démarrée avec config en cache
2. Activer mode avion
3. Vérifier que l'app fonctionne

**Résultat attendu:**
- ✅ Config chargée depuis SharedPreferences
- ✅ App fonctionne normalement
- ✅ Type de véhicule affiché correctement

### Test 4: Reconnexion automatique

**Étapes:**
1. App démarrée
2. Couper Internet pendant 2 minutes
3. Rétablir Internet
4. Modifier config dans dashboard

**Résultat attendu:**
- ✅ Listener se reconnecte automatiquement
- ✅ Changement détecté
- ✅ Notification affichée

## 🔐 Sécurité

### Règles Firebase

```json
{
  "rules": {
    "agents": {
      ".read": "auth != null",
      "$agentId": {
        ".write": true
      }
    }
  }
}
```

**Note:** L'app Android n'est pas authentifiée, donc `.write: true` pour permettre l'envoi GPS.

### Données sensibles

- ✅ Pas de données sensibles dans la config
- ✅ SharedPreferences privées (pas accessibles par autres apps)
- ✅ Listener détaché à la destruction du service

## 📊 Notification principale mise à jour

### Avant

```
🛰️ GPS Tracker actif
📍 -4.77610, 11.86350
🚗 45.5 km/h • 📊 ±8m • #154
🔌 📶
```

### Après (avec type de véhicule)

```
🛰️ GPS Tracker actif
🏍️ 📍 -4.77610, 11.86350
🚗 45.5 km/h • 📊 ±8m • #154
🔌 📶
```

**Icône du véhicule affichée en premier!**

## 🎯 Cas d'usage

### Scénario 1: Changement de véhicule

```
1. Agent utilise une moto le matin
2. Dashboard: vehicleType = "moto"
3. App affiche: 🏍️
4. Après-midi, agent prend une voiture
5. Admin change dans dashboard: vehicleType = "voiture"
6. App reçoit le changement instantanément
7. Notification: "Type de véhicule mis à jour - Nouveau type: Voiture 🚗"
8. App affiche: 🚗
```

### Scénario 2: Nouvel agent

```
1. Admin crée agent dans dashboard
2. Agent entre son ID dans l'app
3. App démarre le listener
4. Config récupérée de Firebase
5. vehicleType, name, phone sauvegardés localement
6. App prête à fonctionner
```

### Scénario 3: Mise à jour du nom

```
1. Admin corrige le nom de l'agent dans dashboard
2. App reçoit la mise à jour
3. Nom sauvegardé dans SharedPreferences
4. Prochains envois GPS utilisent le nouveau nom
```

## 🐛 Dépannage

### Listener ne démarre pas

**Causes:**
- Agent ID non configuré
- Erreur de connexion Firebase

**Solutions:**
1. Vérifier que device_id est saisi
2. Vérifier les logs: `adb logcat | grep "🎧"`
3. Vérifier google-services.json

### Changements non détectés

**Causes:**
- Pas de connexion Internet
- Listener détaché

**Solutions:**
1. Vérifier la connexion
2. Redémarrer l'app
3. Vérifier les logs: `adb logcat | grep "📥"`

### Notification ne s'affiche pas

**Causes:**
- Notifications désactivées
- Pas de changement réel

**Solutions:**
1. Activer les notifications pour l'app
2. Vérifier que vehicleType a vraiment changé
3. Vérifier les logs: `adb logcat | grep "📢"`

## ✅ Checklist de validation

### Fonctionnalités
- [x] ValueEventListener sur agents/{id}
- [x] Récupération vehicleType, name, phone, companyId
- [x] Sauvegarde dans SharedPreferences
- [x] Détection changement vehicleType
- [x] Notification utilisateur
- [x] Ajustement paramètres
- [x] Logs détaillés
- [x] Détachement propre du listener
- [x] Icône véhicule dans notification
- [x] Reconnexion automatique

### Tests à effectuer
- [ ] Test changement depuis dashboard
- [ ] Test démarrage avec config
- [ ] Test mode hors ligne
- [ ] Test reconnexion
- [ ] Test notification
- [ ] Test SharedPreferences
- [ ] Test logs

## 🎉 Résultat

Le service GPS est maintenant:
- ✅ **Synchronisé** - Config en temps réel depuis dashboard
- ✅ **Intelligent** - Détecte les changements automatiquement
- ✅ **Résilient** - Fonctionne hors ligne avec cache local
- ✅ **Transparent** - Notifie l'utilisateur des changements
- ✅ **Flexible** - Peut ajuster les paramètres par véhicule

Configuration centralisée depuis le dashboard! 🎛️🚀
