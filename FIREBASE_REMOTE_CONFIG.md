# Configuration Firebase Remote Config

## 🎯 Objectif

Permettre de modifier les paramètres du service GPS à distance sans avoir à mettre à jour l'application Android.

## 📋 Paramètres configurables

### 1. `gps_update_interval_seconds`
- **Type:** Number
- **Valeur par défaut:** 10
- **Description:** Intervalle entre les mises à jour GPS en secondes
- **Exemples:**
  - `5` = Mise à jour toutes les 5 secondes (haute fréquence)
  - `10` = Mise à jour toutes les 10 secondes (recommandé)
  - `30` = Mise à jour toutes les 30 secondes (économie batterie)
  - `60` = Mise à jour toutes les minutes (très économique)

### 2. `gps_min_distance_meters`
- **Type:** Number
- **Valeur par défaut:** 5
- **Description:** Distance minimale en mètres avant d'envoyer une mise à jour
- **Exemples:**
  - `0` = Envoyer à chaque intervalle même si pas de mouvement
  - `5` = Envoyer seulement si déplacement de 5m minimum
  - `10` = Envoyer seulement si déplacement de 10m minimum
  - `50` = Envoyer seulement si déplacement de 50m minimum

### 3. `gps_max_history_points`
- **Type:** Number
- **Valeur par défaut:** 1000
- **Description:** Nombre maximum de points d'historique à conserver
- **Exemples:**
  - `100` = Garder les 100 derniers points
  - `500` = Garder les 500 derniers points
  - `1000` = Garder les 1000 derniers points (recommandé)
  - `5000` = Garder les 5000 derniers points (beaucoup de données)

### 4. `gps_high_accuracy`
- **Type:** Boolean
- **Valeur par défaut:** true
- **Description:** Utiliser la haute précision GPS
- **Valeurs:**
  - `true` = Haute précision (GPS + WiFi + réseau mobile)
  - `false` = Précision normale (économie batterie)

## 🔧 Configuration dans Firebase Console

### Étape 1: Activer Remote Config

1. Aller dans Firebase Console: https://console.firebase.google.com/
2. Sélectionner votre projet: `db-tracker-d39a7`
3. Menu latéral → **Remote Config**
4. Cliquer sur **Commencer**

### Étape 2: Ajouter les paramètres

Pour chaque paramètre:

1. Cliquer sur **Ajouter un paramètre**
2. Entrer le nom exact (voir liste ci-dessus)
3. Choisir le type de données
4. Entrer la valeur par défaut
5. (Optionnel) Ajouter une description
6. Cliquer sur **Enregistrer**

### Exemple de configuration

```
Paramètre: gps_update_interval_seconds
Type: Number
Valeur par défaut: 10
Description: Intervalle entre les mises à jour GPS (en secondes)

Paramètre: gps_min_distance_meters
Type: Number
Valeur par défaut: 5
Description: Distance minimale avant mise à jour (en mètres)

Paramètre: gps_max_history_points
Type: Number
Valeur par défaut: 1000
Description: Nombre maximum de points d'historique

Paramètre: gps_high_accuracy
Type: Boolean
Valeur par défaut: true
Description: Utiliser la haute précision GPS
```

### Étape 3: Publier les modifications

1. Après avoir ajouté tous les paramètres
2. Cliquer sur **Publier les modifications**
3. Confirmer la publication

## 📱 Utilisation dans l'application

### Récupération automatique

L'application récupère automatiquement les paramètres:
- Au démarrage du service GPS
- Toutes les heures (cache de 1 heure)
- En cas d'échec, utilise les valeurs par défaut

### Logs de débogage

Pour vérifier que les paramètres sont bien récupérés:

```bash
adb logcat | grep LocationService
```

Vous devriez voir:
```
LocationService: Remote Config récupéré avec succès
LocationService: Configuration appliquée: interval=10000ms, minDistance=5.0m, maxHistory=1000
```

## 🎛️ Configurations recommandées par cas d'usage

### 1. Livraison rapide (moto/vélo)
```json
{
  "gps_update_interval_seconds": 5,
  "gps_min_distance_meters": 10,
  "gps_max_history_points": 2000,
  "gps_high_accuracy": true
}
```
**Avantages:** Suivi très précis, idéal pour livraisons
**Inconvénients:** Consommation batterie élevée

### 2. Transport standard (voiture/camion)
```json
{
  "gps_update_interval_seconds": 10,
  "gps_min_distance_meters": 5,
  "gps_max_history_points": 1000,
  "gps_high_accuracy": true
}
```
**Avantages:** Bon équilibre précision/batterie
**Inconvénients:** Aucun (recommandé)

### 3. Économie de batterie
```json
{
  "gps_update_interval_seconds": 30,
  "gps_min_distance_meters": 20,
  "gps_max_history_points": 500,
  "gps_high_accuracy": false
}
```
**Avantages:** Batterie dure plus longtemps
**Inconvénients:** Moins de précision

### 4. Surveillance longue distance
```json
{
  "gps_update_interval_seconds": 60,
  "gps_min_distance_meters": 50,
  "gps_max_history_points": 5000,
  "gps_high_accuracy": true
}
```
**Avantages:** Historique très long
**Inconvénients:** Beaucoup de données Firebase

## 🔄 Conditions et ciblage

Remote Config permet de définir des valeurs différentes selon:

### Par version d'application
```
Condition: Version de l'app >= 2.0
gps_update_interval_seconds: 5
```

### Par pays
```
Condition: Pays = Congo
gps_update_interval_seconds: 15
```

### Par pourcentage d'utilisateurs (A/B testing)
```
Condition: 50% des utilisateurs
gps_update_interval_seconds: 5

Condition: 50% des utilisateurs
gps_update_interval_seconds: 10
```

### Exemple de configuration avancée

1. **Créer une condition:**
   - Remote Config → Conditions
   - Nom: "Livraison rapide"
   - Règle: `app.version >= 2.0 AND user.country == 'CG'`

2. **Appliquer la condition:**
   - Paramètre: `gps_update_interval_seconds`
   - Valeur par défaut: 10
   - Ajouter valeur conditionnelle:
     - Condition: "Livraison rapide"
     - Valeur: 5

## 📊 Monitoring

### Vérifier l'utilisation

Firebase Console → Remote Config → Analytics:
- Nombre de récupérations
- Taux de succès
- Valeurs actives par paramètre

### Métriques importantes

- **Fetch success rate:** Doit être > 95%
- **Active users:** Nombre d'appareils utilisant Remote Config
- **Last fetch time:** Dernière récupération par appareil

## 🐛 Dépannage

### Problème: Paramètres non récupérés

**Solutions:**
1. Vérifier que Remote Config est activé dans Firebase
2. Vérifier la connexion Internet de l'appareil
3. Vérifier les logs: `adb logcat | grep RemoteConfig`
4. Forcer une récupération en redémarrant l'app

### Problème: Anciennes valeurs utilisées

**Solutions:**
1. Le cache est de 1 heure par défaut
2. Redémarrer l'application pour forcer la récupération
3. Ou attendre 1 heure pour la mise à jour automatique

### Problème: Valeurs par défaut toujours utilisées

**Solutions:**
1. Vérifier que les paramètres sont publiés dans Firebase Console
2. Vérifier l'orthographe exacte des noms de paramètres
3. Vérifier les logs pour les erreurs de récupération

## 🔐 Sécurité

### Bonnes pratiques

1. **Ne pas stocker de secrets:** Remote Config n'est pas chiffré
2. **Valider les valeurs:** L'app valide les valeurs reçues
3. **Valeurs par défaut:** Toujours définir des valeurs par défaut sûres
4. **Limites raisonnables:** Ne pas permettre des valeurs extrêmes

### Validation dans le code

Le service valide automatiquement:
- Intervalle minimum: 1 seconde
- Intervalle maximum: 3600 secondes (1 heure)
- Distance minimum: 0 mètres
- Distance maximum: 1000 mètres
- Historique minimum: 10 points
- Historique maximum: 10000 points

## 📈 Optimisation

### Réduire la consommation de données

```json
{
  "gps_update_interval_seconds": 30,
  "gps_min_distance_meters": 20,
  "gps_max_history_points": 500
}
```

### Maximiser la précision

```json
{
  "gps_update_interval_seconds": 5,
  "gps_min_distance_meters": 0,
  "gps_max_history_points": 2000,
  "gps_high_accuracy": true
}
```

### Équilibre optimal (recommandé)

```json
{
  "gps_update_interval_seconds": 10,
  "gps_min_distance_meters": 5,
  "gps_max_history_points": 1000,
  "gps_high_accuracy": true
}
```

## 🎓 Ressources

- [Firebase Remote Config Documentation](https://firebase.google.com/docs/remote-config)
- [Best Practices](https://firebase.google.com/docs/remote-config/best-practices)
- [Use Cases](https://firebase.google.com/docs/remote-config/use-cases)

## ✅ Checklist de configuration

- [ ] Remote Config activé dans Firebase Console
- [ ] Paramètre `gps_update_interval_seconds` créé
- [ ] Paramètre `gps_min_distance_meters` créé
- [ ] Paramètre `gps_max_history_points` créé
- [ ] Paramètre `gps_high_accuracy` créé
- [ ] Modifications publiées
- [ ] Application testée avec les nouveaux paramètres
- [ ] Logs vérifiés pour confirmer la récupération
- [ ] Monitoring activé pour suivre l'utilisation
