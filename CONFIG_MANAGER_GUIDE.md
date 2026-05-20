# ConfigManager - Gestion métier par type de véhicule

## 🎯 Objectif

Classe Kotlin qui gère la logique métier selon le type de véhicule et le secteur d'activité, avec calculs automatiques de CO2 et ajustements de tracking.

## 📋 Fonctionnalités

### 1. Coefficients d'émission CO2

| Type véhicule | CO2 (g/km) | Mode |
|---------------|------------|------|
| Moto 🏍️ | 80 | Normal |
| Voiture 🚗 | 150 | Normal |
| Camion 🚚 | 250 | Normal |
| Scolaire 🎒 | 0 (désactivé) | Haute fréquence |

### 2. Modes de tracking

**Mode Normal:**
- Intervalle: 10 secondes
- Calculs CO2: Activés
- Usage: Moto, Voiture, Camion

**Mode Haute Fréquence:**
- Intervalle: 5 secondes
- Calculs CO2: Désactivés
- Usage: Secteur scolaire (précision maximale)

## 🏗️ Architecture

```
Firebase Realtime Database
         ↓
   LocationService
         ↓
    ConfigManager
         ↓
   ┌──────────────┐
   │ Configuration│
   │   - Type     │
   │   - Secteur  │
   │   - CO2      │
   │   - Mode     │
   └──────────────┘
         ↓
   ┌──────────────┐
   │   Calculs    │
   │   - CO2      │
   │   - Carburant│
   │   - Distance │
   └──────────────┘
         ↓
   SharedPreferences
```

## 📊 Flux de données

### 1. Initialisation

```kotlin
// Dans LocationService.onCreate()
configManager = ConfigManager(this)
configManager.loadStatistics()
```

### 2. Mise à jour depuis Firebase

```kotlin
// Quand données reçues de Firebase
configManager.updateFromFirebase(vehicleType, sector)
  ↓
applyConfiguration()
  ↓
Si secteur == "Scolaire":
  - applyScolaireMode()
  - CO2 désactivé
  - Intervalle 5s
Sinon selon vehicleType:
  - applyMotoMode() → 80g/km
  - applyVoitureMode() → 150g/km
  - applyCamionMode() → 250g/km
```

### 3. Calcul CO2 en temps réel

```kotlin
// À chaque position GPS
val distanceMeters = previous.distanceTo(current)
val co2Grams = configManager.calculateCO2(distanceMeters)
  ↓
Si CO2 activé:
  distanceKm = distanceMeters / 1000
  co2Grams = distanceKm × coefficient
  totalCO2 += co2Grams
```

## 🔧 API du ConfigManager

### Méthodes principales

#### updateFromFirebase()
```kotlin
configManager.updateFromFirebase(
    vehicleType = "moto",
    sector = "Livraison"
)
```
Met à jour la configuration depuis Firebase.

#### calculateCO2()
```kotlin
val co2Grams = configManager.calculateCO2(distanceMeters = 1000f)
// Retourne: 80g pour moto, 150g pour voiture, 0 pour scolaire
```
Calcule les émissions CO2 pour une distance.

#### calculateFuelConsumption()
```kotlin
val liters = configManager.calculateFuelConsumption(distanceMeters = 10000f)
// Retourne: estimation en litres
```
Calcule la consommation de carburant estimée.

#### getRecommendedGpsInterval()
```kotlin
val interval = configManager.getRecommendedGpsInterval()
// Retourne: 10000ms (normal) ou 5000ms (haute fréquence)
```
Retourne l'intervalle GPS recommandé.

#### isHighFrequencyMode()
```kotlin
if (configManager.isHighFrequencyMode()) {
    // Mode scolaire actif
}
```
Vérifie si le mode haute fréquence est actif.

#### isCO2Enabled()
```kotlin
if (configManager.isCO2Enabled()) {
    // Calculs CO2 activés
}
```
Vérifie si les calculs CO2 sont activés.

#### getStatistics()
```kotlin
val stats = configManager.getStatistics()
// Retourne:
// {
//   "totalDistanceKm": 125.5,
//   "totalCO2Kg": 18.825,
//   "co2Coefficient": 150.0,
//   "co2Enabled": true,
//   "trackingMode": "normal",
//   "vehicleType": "voiture",
//   "sector": "Livraison"
// }
```
Retourne les statistiques complètes.

#### getConfigReport()
```kotlin
val report = configManager.getConfigReport()
println(report)
```
Génère un rapport de configuration formaté.

## 📱 Exemples d'utilisation

### Exemple 1: Moto de livraison

```kotlin
// Configuration
vehicleType = "moto"
sector = "Livraison"

// Résultat
CO2: 80g/km
Intervalle GPS: 10s
Mode: Normal

// Calcul pour 10km
Distance: 10 km
CO2 émis: 800g (0.8kg)
Carburant: ~0.35L
```

### Exemple 2: Voiture de taxi

```kotlin
// Configuration
vehicleType = "voiture"
sector = "Transport"

// Résultat
CO2: 150g/km
Intervalle GPS: 10s
Mode: Normal

// Calcul pour 50km
Distance: 50 km
CO2 émis: 7500g (7.5kg)
Carburant: ~3.5L
```

### Exemple 3: Bus scolaire

```kotlin
// Configuration
vehicleType = "camion" // ou n'importe quel type
sector = "Scolaire"

// Résultat
CO2: Désactivé (0g/km)
Intervalle GPS: 5s (haute fréquence)
Mode: High Frequency

// Priorité à la précision pour la sécurité des élèves
Tracking très précis
Pas de calcul CO2
```

### Exemple 4: Camion de transport

```kotlin
// Configuration
vehicleType = "camion"
sector = "Logistique"

// Résultat
CO2: 250g/km
Intervalle GPS: 10s
Mode: Normal

// Calcul pour 200km
Distance: 200 km
CO2 émis: 50000g (50kg)
Carburant: ~50L
```

## 🔍 Logs de débogage

### Commandes

```bash
# Logs ConfigManager
adb logcat | grep ConfigManager

# Logs CO2
adb logcat | grep "🌱"

# Logs configuration
adb logcat | grep "⚙️"
```

### Logs typiques

**Initialisation:**
```
ConfigManager: Configuration chargée: vehicleType=moto, sector=null
```

**Mise à jour:**
```
ConfigManager: ⚙️ Configuration mise à jour: vehicleType=null→moto, sector=null→Livraison
ConfigManager: 🏍️ Mode Moto activé: CO2=80.0g/km, interval=10000ms
ConfigManager: ╔════════════════════════════════════════╗
ConfigManager: ║     Configuration GPS Tracker          ║
ConfigManager: ╠════════════════════════════════════════╣
ConfigManager: ║ Type véhicule: moto                    ║
ConfigManager: ║ Secteur: Livraison                     ║
ConfigManager: ║ Mode: normal                           ║
ConfigManager: ║ Intervalle GPS: 10000ms                ║
ConfigManager: ║ CO2 activé: true                       ║
ConfigManager: ║ Coefficient CO2: 80.0g/km              ║
ConfigManager: ╚════════════════════════════════════════╝
```

**Calcul CO2:**
```
LocationService: 🌱 CO2 émis: 12.50g pour 156.2m
```

**Mode scolaire:**
```
ConfigManager: 🎒 Mode Scolaire activé: CO2 désactivé, haute fréquence (5000ms)
LocationService: 🎒 Mode haute fréquence détecté, redémarrage GPS...
```

**Statistiques:**
```
ConfigManager: 💾 Statistiques sauvegardées: 125.50km, 18.825kg CO2
```

## 📊 Notification mise à jour

### Mode normal (Moto)
```
🏍️ 📍 -4.77610, 11.86350
🚗 45.5 km/h • 📊 ±8m • #154
🔌 📶
```

### Mode haute fréquence (Scolaire)
```
🎒 📍 -4.77610, 11.86350
🚗 25.0 km/h • 📊 ±5m • #312
🔌 📶
```

**Icône 🎒 indique le mode haute fréquence!**

## 🧪 Tests

### Test 1: Changement Voiture → Moto

**Étapes:**
1. Agent configuré avec vehicleType="voiture"
2. Dashboard: changer en "moto"
3. Observer les logs

**Résultat attendu:**
```
ConfigManager: ⚙️ Configuration mise à jour: vehicleType=voiture→moto
ConfigManager: 🏍️ Mode Moto activé: CO2=80.0g/km
LocationService: 🚗 Type de véhicule modifié: voiture → moto
```

### Test 2: Activation mode scolaire

**Étapes:**
1. Dashboard: créer société avec sector="Scolaire"
2. Ajouter agent
3. Démarrer l'app
4. Observer les logs et notification

**Résultat attendu:**
```
ConfigManager: 🎒 Mode Scolaire activé: CO2 désactivé, haute fréquence (5000ms)
LocationService: Intervalle GPS: 5000ms (haute fréquence: true)
Notification: 🎒 📍 ...
```

### Test 3: Calcul CO2

**Étapes:**
1. Configurer vehicleType="voiture" (150g/km)
2. Se déplacer de 1km
3. Observer les logs

**Résultat attendu:**
```
LocationService: 🌱 CO2 émis: 150.00g pour 1000.0m
```

### Test 4: Statistiques

**Étapes:**
1. Utiliser l'app pendant 1h
2. Arrêter le service
3. Vérifier Firebase: `agents/{id}/lastSession`

**Résultat attendu:**
```json
{
  "lastSession": {
    "endTime": 1234567890,
    "totalUpdates": 360,
    "totalDistance": 25000,
    "duration": 3600000,
    "totalCO2Kg": 3.75,
    "co2Coefficient": 150.0,
    "trackingMode": "normal"
  }
}
```

## 💾 Stockage

### SharedPreferences: gps_tracker

```
vehicleType: "moto"
sector: "Livraison"
totalDistanceKm: 125.5
totalCO2Kg: 10.04
```

### Firebase: agents/{id}/lastSession

```json
{
  "endTime": 1234567890,
  "totalUpdates": 360,
  "totalDistance": 25000,
  "duration": 3600000,
  "totalCO2Kg": 3.75,
  "co2Coefficient": 150.0,
  "trackingMode": "normal"
}
```

## 🎯 Cas d'usage réels

### Cas 1: Flotte de livraison (Motos)

```
Configuration:
- vehicleType: "moto"
- sector: "Livraison"

Résultat:
- CO2: 80g/km (faible)
- Tracking: 10s (standard)
- Idéal pour livraisons urbaines

Journée type (100km):
- CO2 total: 8kg
- Carburant: ~3.5L
- Coût environnemental: Faible
```

### Cas 2: Transport scolaire

```
Configuration:
- vehicleType: n'importe lequel
- sector: "Scolaire"

Résultat:
- CO2: Désactivé (pas pertinent)
- Tracking: 5s (haute précision)
- Priorité: Sécurité des élèves

Avantages:
- Trajet très précis
- Parents peuvent suivre en temps réel
- Alertes si déviation de route
```

### Cas 3: Logistique (Camions)

```
Configuration:
- vehicleType: "camion"
- sector: "Logistique"

Résultat:
- CO2: 250g/km (élevé)
- Tracking: 10s (standard)
- Suivi impact environnemental

Journée type (300km):
- CO2 total: 75kg
- Carburant: ~75L
- Permet optimisation routes
```

## 🐛 Dépannage

### CO2 toujours à 0

**Causes:**
- Mode scolaire actif
- vehicleType non défini

**Solutions:**
1. Vérifier sector != "Scolaire"
2. Vérifier vehicleType défini
3. Logs: `adb logcat | grep "CO2 activé"`

### Mode haute fréquence non actif

**Causes:**
- Sector != "Scolaire"

**Solutions:**
1. Vérifier sector dans Firebase
2. Logs: `adb logcat | grep "Mode Scolaire"`

### Statistiques non sauvegardées

**Causes:**
- Service arrêté brutalement
- Erreur Firebase

**Solutions:**
1. Arrêter proprement le service
2. Vérifier connexion Firebase
3. Logs: `adb logcat | grep "Statistiques"`

## ✅ Checklist de validation

### Fonctionnalités
- [x] Coefficients CO2 par véhicule
- [x] Mode scolaire (CO2 désactivé)
- [x] Mode haute fréquence (5s)
- [x] Calcul CO2 en temps réel
- [x] Calcul consommation carburant
- [x] Statistiques totales
- [x] Sauvegarde SharedPreferences
- [x] Sauvegarde Firebase
- [x] Logs détaillés
- [x] Rapport de configuration

### Tests à effectuer
- [ ] Test moto (80g/km)
- [ ] Test voiture (150g/km)
- [ ] Test camion (250g/km)
- [ ] Test scolaire (CO2 désactivé, 5s)
- [ ] Test calculs CO2
- [ ] Test statistiques
- [ ] Test changement type
- [ ] Test mode haute fréquence

## 🎉 Résultat

Le ConfigManager apporte:
- ✅ **Logique métier centralisée**
- ✅ **Calculs CO2 automatiques**
- ✅ **Mode scolaire sécurisé**
- ✅ **Statistiques détaillées**
- ✅ **Configuration flexible**
- ✅ **Extensible** pour futurs besoins

Gestion professionnelle par type de véhicule! 🚗🏍️🚚🎒
