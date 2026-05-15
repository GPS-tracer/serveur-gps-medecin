package com.gpstracker.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.Location
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

/**
 * Service de géolocalisation en arrière-plan
 * 
 * Fonctionnalités:
 * - Suivi GPS haute précision (PRIORITY_HIGH_ACCURACY)
 * - Envoi automatique vers Firebase Realtime Database
 * - Intervalle configurable via Firebase Remote Config
 * - Notification persistante (Android 14+ compatible)
 * - Redémarrage automatique (START_STICKY)
 * - Gestion intelligente de la batterie (< 15% = mode économie)
 * - Cache local si pas de connexion Internet
 * - Synchronisation automatique quand le réseau revient
 */
class LocationService : Service() {

    companion object {
        var isRunning = false
        private const val TAG = "LocationService"
        private const val CHANNEL_ID = "gps_tracker_channel"
        private const val NOTIF_ID = 1
        
        // Valeurs par défaut (si Remote Config échoue)
        private const val DEFAULT_INTERVAL_MS = 10_000L // 10 secondes
        private const val DEFAULT_MIN_DISTANCE_METERS = 5f // 5 mètres
        private const val DEFAULT_MAX_HISTORY_POINTS = 1000 // Limiter l'historique
        
        // Gestion batterie
        private const val LOW_BATTERY_THRESHOLD = 15 // 15%
        private const val LOW_BATTERY_INTERVAL_MULTIPLIER = 3 // x3 l'intervalle
        
        // Cache local
        private const val PREFS_CACHE = "location_cache"
        private const val KEY_CACHED_LOCATIONS = "cached_locations"
        private const val MAX_CACHED_LOCATIONS = 500 // Maximum 500 positions en cache
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var locationThread: HandlerThread
    private lateinit var remoteConfig: FirebaseRemoteConfig
    private lateinit var wakeLock: PowerManager.WakeLock
    private lateinit var configManager: ConfigManager
    
    private val db = FirebaseDatabase.getInstance().reference
    
    // Listener pour la configuration Firebase
    private var configListener: com.google.firebase.database.ValueEventListener? = null
    
    // Configuration dynamique
    private var updateIntervalMs = DEFAULT_INTERVAL_MS
    private var minDistanceMeters = DEFAULT_MIN_DISTANCE_METERS
    private var maxHistoryPoints = DEFAULT_MAX_HISTORY_POINTS
    
    // Configuration agent
    private var currentVehicleType: String? = null
    private var currentAgentName: String? = null
    private var currentAgentPhone: String? = null
    private var currentCompanyId: String? = null
    
    // Gestion batterie et réseau
    private var isLowBattery = false
    private var isNetworkAvailable = true
    private var batteryReceiver: BroadcastReceiver? = null
    private var networkReceiver: BroadcastReceiver? = null
    
    // Statistiques
    private var locationUpdateCount = 0
    private var lastLocationTime = 0L
    private var totalDistance = 0f
    private var lastLocation: Location? = null
    private var cachedLocationsCount = 0

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "Service créé")
        isRunning = true
        
        // Initialiser le ConfigManager
        configManager = ConfigManager(this)
        configManager.loadStatistics()
        
        // Acquérir un WakeLock partiel pour éviter que le CPU s'endorme
        val powerManager = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "GPSTracker::LocationWakeLock"
        )
        wakeLock.acquire(10*60*1000L /*10 minutes*/)
        
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Initialisation du GPS..."))
        
        // Enregistrer les receivers pour batterie et réseau
        registerBatteryReceiver()
        registerNetworkReceiver()
        
        // Vérifier l'état initial
        checkBatteryLevel()
        checkNetworkStatus()
        
        // Écouter les changements de configuration Firebase
        startConfigListener()
        
        // Charger la configuration Remote Config
        initRemoteConfig()
    }

    /**
     * Initialise Firebase Remote Config pour les paramètres dynamiques
     */
    private fun initRemoteConfig() {
        remoteConfig = FirebaseRemoteConfig.getInstance()
        
        val configSettings = FirebaseRemoteConfigSettings.Builder()
            .setMinimumFetchIntervalInSeconds(3600) // 1 heure
            .build()
        
        remoteConfig.setConfigSettingsAsync(configSettings)
        
        // Valeurs par défaut
        val defaults = mapOf(
            "gps_update_interval_seconds" to 10L,
            "gps_min_distance_meters" to 5L,
            "gps_max_history_points" to 1000L,
            "gps_high_accuracy" to true
        )
        remoteConfig.setDefaultsAsync(defaults)
        
        // Récupérer les valeurs depuis Firebase
        remoteConfig.fetchAndActivate()
            .addOnCompleteListener { task ->
                if (task.isSuccessful) {
                    Log.d(TAG, "Remote Config récupéré avec succès")
                    applyRemoteConfig()
                } else {
                    Log.w(TAG, "Échec Remote Config, utilisation des valeurs par défaut")
                    applyRemoteConfig()
                }
                startLocationUpdates()
            }
    }

    /**
     * Applique les paramètres de Remote Config
     */
    private fun applyRemoteConfig() {
        updateIntervalMs = remoteConfig.getLong("gps_update_interval_seconds") * 1000
        minDistanceMeters = remoteConfig.getLong("gps_min_distance_meters").toFloat()
        maxHistoryPoints = remoteConfig.getLong("gps_max_history_points").toInt()
        
        Log.d(TAG, "Configuration appliquée: interval=${updateIntervalMs}ms, " +
                "minDistance=${minDistanceMeters}m, maxHistory=$maxHistoryPoints")
    }

    /**
     * Enregistre le receiver pour surveiller le niveau de batterie
     */
    private fun registerBatteryReceiver() {
        batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                checkBatteryLevel()
            }
        }
        
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        registerReceiver(batteryReceiver, filter)
        Log.d(TAG, "Battery receiver enregistré")
    }

    /**
     * Enregistre le receiver pour surveiller la connexion réseau
     */
    private fun registerNetworkReceiver() {
        networkReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                checkNetworkStatus()
                
                // Si le réseau revient, synchroniser le cache
                if (isNetworkAvailable) {
                    syncCachedLocations()
                }
            }
        }
        
        val filter = IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION)
        registerReceiver(networkReceiver, filter)
        Log.d(TAG, "Network receiver enregistré")
    }

    /**
     * Vérifie le niveau de batterie et ajuste l'intervalle si nécessaire
     */
    private fun checkBatteryLevel() {
        val batteryStatus = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        
        if (level >= 0 && scale > 0) {
            val batteryPct = (level * 100 / scale.toFloat()).toInt()
            val wasLowBattery = isLowBattery
            isLowBattery = batteryPct <= LOW_BATTERY_THRESHOLD
            
            if (isLowBattery != wasLowBattery) {
                if (isLowBattery) {
                    Log.w(TAG, "🔋 Batterie faible ($batteryPct%) - Mode économie activé")
                    updateNotification("🔋 Mode économie batterie ($batteryPct%)")
                    
                    // Redémarrer le GPS avec le nouvel intervalle
                    if (::fusedClient.isInitialized) {
                        restartLocationUpdates()
                    }
                } else {
                    Log.i(TAG, "🔋 Batterie OK ($batteryPct%) - Mode normal")
                    updateNotification("🔋 Batterie OK ($batteryPct%)")
                    
                    // Redémarrer le GPS avec l'intervalle normal
                    if (::fusedClient.isInitialized) {
                        restartLocationUpdates()
                    }
                }
            }
        }
    }

    /**
     * Vérifie l'état de la connexion réseau
     */
    private fun checkNetworkStatus() {
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        
        val wasAvailable = isNetworkAvailable
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork
            val capabilities = connectivityManager.getNetworkCapabilities(network)
            isNetworkAvailable = capabilities != null && (
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
            )
        } else {
            @Suppress("DEPRECATION")
            val networkInfo = connectivityManager.activeNetworkInfo
            @Suppress("DEPRECATION")
            isNetworkAvailable = networkInfo?.isConnected == true
        }
        
        if (isNetworkAvailable != wasAvailable) {
            if (isNetworkAvailable) {
                Log.i(TAG, "📶 Réseau disponible - Synchronisation du cache...")
                updateNotification("📶 Réseau rétabli - Synchronisation...")
                syncCachedLocations()
            } else {
                Log.w(TAG, "📵 Réseau indisponible - Mode cache activé")
                updateNotification("📵 Mode hors ligne - Cache local")
            }
        }
    }

    /**
     * Redémarre les mises à jour GPS avec le nouvel intervalle
     */
    private fun restartLocationUpdates() {
        if (::fusedClient.isInitialized && ::locationCallback.isInitialized) {
            fusedClient.removeLocationUpdates(locationCallback)
            startLocationUpdates()
        }
    }

    /**
     * Démarre l'écoute des changements de configuration Firebase
     * Chemin: societes/{uid_societe}/agents/{id_agent}/config
     */
    private fun startConfigListener() {
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        val agentId = prefs.getString("device_id", null)
        val societeId = prefs.getString("companyId", null)
        
        if (agentId.isNullOrEmpty()) {
            Log.w(TAG, "Agent ID non configuré, listener config non démarré")
            return
        }
        
        if (societeId.isNullOrEmpty()) {
            Log.w(TAG, "Société ID non configuré, listener config non démarré")
            return
        }
        
        // Charger la config locale existante
        loadLocalConfig()
        
        // Référence Firebase: societes/{uid_societe}/agents/{id_agent}/config
        val configRef = db.child("societes/$societeId/agents/$agentId/config")
        
        configListener = object : com.google.firebase.database.ValueEventListener {
            override fun onDataChange(snapshot: com.google.firebase.database.DataSnapshot) {
                if (!snapshot.exists()) {
                    Log.w(TAG, "Config introuvable: societes/$societeId/agents/$agentId/config")
                    return
                }
                
                try {
                    // Récupérer les champs de configuration
                    val vehicleType = snapshot.child("vehicleType").getValue(String::class.java)
                    val name = snapshot.child("name").getValue(String::class.java)
                    val phone = snapshot.child("phone").getValue(String::class.java)
                    val sector = snapshot.child("sector").getValue(String::class.java)
                    
                    Log.d(TAG, "📥 Configuration reçue de Firebase: " +
                            "vehicleType=$vehicleType, name=$name, sector=$sector, societeId=$societeId")
                    
                    // Mettre à jour le ConfigManager avec le nouveau type et secteur
                    configManager.updateFromFirebase(vehicleType, sector)
                    
                    // Vérifier si le type de véhicule a changé
                    val vehicleTypeChanged = vehicleType != null &&
                                            vehicleType != currentVehicleType &&
                                            currentVehicleType != null
                    
                    // Mettre à jour les variables locales
                    currentVehicleType = vehicleType
                    currentAgentName = name
                    currentAgentPhone = phone
                    currentCompanyId = societeId
                    
                    // Sauvegarder dans SharedPreferences pour accès hors-ligne
                    saveLocalConfig(vehicleType, name, phone, societeId, sector)
                    
                    // Si le type de véhicule a changé, déclencher la mise à jour
                    if (vehicleTypeChanged) {
                        onVehicleTypeChanged(vehicleType)
                    }
                    
                    // Si mode haute fréquence activé (scolaire), redémarrer le GPS
                    if (configManager.isHighFrequencyMode()) {
                        Log.i(TAG, "🎒 Mode haute fréquence détecté, redémarrage GPS...")
                        restartLocationUpdates()
                    }
                    
                } catch (e: Exception) {
                    Log.e(TAG, "Erreur lecture config Firebase: ${e.message}", e)
                }
            }
            
            override fun onCancelled(error: com.google.firebase.database.DatabaseError) {
                Log.e(TAG, "Erreur listener config: ${error.message}")
            }
        }
        
        // Attacher le listener — se déclenche au démarrage ET à chaque modification
        configRef.addValueEventListener(configListener!!)
        Log.d(TAG, "🎧 Listener config démarré: societes/$societeId/agents/$agentId/config")
    }

    /**
     * Charge la configuration locale depuis SharedPreferences (accès hors-ligne)
     */
    private fun loadLocalConfig() {
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        currentVehicleType = prefs.getString("vehicleType", null)
        currentAgentName = prefs.getString("name", null)
        currentAgentPhone = prefs.getString("phone", null)
        currentCompanyId = prefs.getString("companyId", null)
        
        // Restaurer aussi le secteur dans le ConfigManager
        val sector = prefs.getString("sector", null)
        if (currentVehicleType != null || sector != null) {
            configManager.updateFromFirebase(currentVehicleType, sector)
        }
        
        Log.d(TAG, "Configuration locale chargée: vehicleType=$currentVehicleType, sector=$sector")
    }

    /**
     * Sauvegarde la configuration dans SharedPreferences pour accès hors-ligne
     */
    private fun saveLocalConfig(vehicleType: String?, name: String?, phone: String?, companyId: String?, sector: String? = null) {
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        prefs.edit().apply {
            if (vehicleType != null) putString("vehicleType", vehicleType)
            if (name != null) putString("name", name)
            if (phone != null) putString("phone", phone)
            if (companyId != null) putString("companyId", companyId)
            if (sector != null) putString("sector", sector)
            apply()
        }
        
        Log.d(TAG, "💾 Configuration sauvegardée localement (hors-ligne ready)")
    }

    /**
     * Appelée quand le type de véhicule change
     */
    private fun onVehicleTypeChanged(newVehicleType: String?) {
        Log.i(TAG, "🚗 Type de véhicule modifié: $currentVehicleType → $newVehicleType")
        
        // Afficher une notification à l'utilisateur
        val vehicleLabel = when (newVehicleType) {
            "moto" -> "Moto 🏍️"
            "voiture" -> "Voiture 🚗"
            "camion" -> "Camion 🚚"
            else -> newVehicleType ?: "Inconnu"
        }
        
        showConfigChangeNotification(
            "Type de véhicule mis à jour",
            "Nouveau type: $vehicleLabel"
        )
        
        // Ajuster les paramètres selon le type de véhicule
        adjustTrackingParameters(newVehicleType)
    }

    /**
     * Ajuste les paramètres de tracking selon le type de véhicule
     */
    private fun adjustTrackingParameters(vehicleType: String?) {
        when (vehicleType) {
            "moto" -> {
                // Moto: tracking plus fréquent (livraisons rapides)
                Log.d(TAG, "🏍️ Mode Moto: tracking haute fréquence")
                // Les paramètres sont déjà gérés par Remote Config
            }
            "voiture" -> {
                // Voiture: tracking standard
                Log.d(TAG, "🚗 Mode Voiture: tracking standard")
            }
            "camion" -> {
                // Camion: tracking moins fréquent (économie carburant)
                Log.d(TAG, "🚚 Mode Camion: tracking optimisé")
            }
            else -> {
                Log.d(TAG, "Type de véhicule inconnu: $vehicleType")
            }
        }
        
        // Note: Les intervalles sont gérés par Remote Config
        // Cette fonction peut être étendue pour des ajustements spécifiques
    }

    /**
     * Affiche une notification de changement de configuration
     */
    private fun showConfigChangeNotification(title: String, message: String) {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIF_ID + 1, notification)
        
        Log.d(TAG, "📢 Notification affichée: $title - $message")
    }

    /**
     * Démarre les mises à jour de localisation
     */
    private fun startLocationUpdates() {
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        
        // Thread dédié pour le GPS (ne pas bloquer le thread principal)
        if (!::locationThread.isInitialized || !locationThread.isAlive) {
            locationThread = HandlerThread("LocationThread").apply {
                priority = Thread.MAX_PRIORITY
                start()
            }
        }

        // Ajuster l'intervalle selon le niveau de batterie ET le mode tracking
        val baseInterval = if (configManager.isHighFrequencyMode()) {
            configManager.getRecommendedGpsInterval()
        } else {
            updateIntervalMs
        }
        
        val effectiveInterval = if (isLowBattery && !configManager.isHighFrequencyMode()) {
            // Mode économie seulement si pas en mode haute fréquence
            baseInterval * LOW_BATTERY_INTERVAL_MULTIPLIER
        } else {
            baseInterval
        }

        Log.d(TAG, "Intervalle GPS: ${effectiveInterval}ms " +
                "(batterie faible: $isLowBattery, haute fréquence: ${configManager.isHighFrequencyMode()})")

        // Configuration de la requête de localisation
        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            effectiveInterval
        ).apply {
            setMinUpdateIntervalMillis(effectiveInterval / 2)
            setMinUpdateDistanceMeters(minDistanceMeters)
            setWaitForAccurateLocation(true)
            setMaxUpdateDelayMillis(effectiveInterval * 2)
        }.build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    processLocation(location)
                }
            }
            
            override fun onLocationAvailability(availability: LocationAvailability) {
                if (!availability.isLocationAvailable) {
                    Log.w(TAG, "GPS non disponible")
                    updateNotification("⚠️ GPS non disponible")
                }
            }
        }

        try {
            fusedClient.requestLocationUpdates(
                request,
                locationCallback,
                locationThread.looper
            )
            Log.d(TAG, "Mises à jour GPS démarrées")
        } catch (e: SecurityException) {
            Log.e(TAG, "Permission GPS manquante", e)
            stopSelf()
        }
    }

    /**
     * Traite une nouvelle position GPS
     */
    private fun processLocation(location: Location) {
        locationUpdateCount++
        lastLocationTime = System.currentTimeMillis()
        
        // Calculer la distance parcourue
        var distanceMeters = 0f
        lastLocation?.let { previous ->
            distanceMeters = previous.distanceTo(location)
            totalDistance += distanceMeters
            
            // Calculer le CO2 avec ConfigManager
            val co2Grams = configManager.calculateCO2(distanceMeters)
            if (co2Grams > 0) {
                Log.d(TAG, "🌱 CO2 émis: ${co2Grams.format(2)}g pour ${distanceMeters.format(1)}m")
            }
        }
        lastLocation = location
        
        // Envoyer à Firebase
        sendToFirebase(location)
        
        // Mettre à jour la notification
        val speed = if (location.hasSpeed()) location.speed * 3.6f else 0f // m/s -> km/h
        val accuracy = if (location.hasAccuracy()) location.accuracy else 0f
        
        val batteryIcon = if (isLowBattery) "🔋" else "🔌"
        val networkIcon = if (isNetworkAvailable) "📶" else "📵"
        val cacheInfo = if (cachedLocationsCount > 0) " • 💾 $cachedLocationsCount" else ""
        
        val vehicleIcon = when (currentVehicleType) {
            "moto" -> "🏍️"
            "voiture" -> "🚗"
            "camion" -> "🚚"
            else -> ""
        }
        
        // Ajouter indicateur mode haute fréquence
        val modeIndicator = if (configManager.isHighFrequencyMode()) " 🎒" else ""
        
        updateNotification(
            "$vehicleIcon$modeIndicator 📍 ${location.latitude.format(5)}, ${location.longitude.format(5)}\n" +
            "🚗 ${speed.format(1)} km/h • 📊 ±${accuracy.format(0)}m • #$locationUpdateCount\n" +
            "$batteryIcon $networkIcon$cacheInfo"
        )
        
        Log.d(TAG, "Position #$locationUpdateCount: lat=${location.latitude}, " +
                "lng=${location.longitude}, speed=${speed}km/h, accuracy=${accuracy}m")
    }

    /**
     * Envoie les données vers Firebase Realtime Database
     * Chemin: societes/{uid_societe}/agents/{id_agent}
     * Si pas de réseau, met en cache localement
     */
    private fun sendToFirebase(location: Location) {
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        val agentId = prefs.getString("device_id", null)
        val societeId = prefs.getString("companyId", null)
        
        if (agentId.isNullOrEmpty()) {
            Log.w(TAG, "Agent ID non configuré")
            return
        }
        
        if (societeId.isNullOrEmpty()) {
            Log.w(TAG, "Société ID non configuré")
            return
        }
        
        val name = prefs.getString("name", "")
        val phone = prefs.getString("phone", "")
        val ts = System.currentTimeMillis()

        // Chemin correct: societes/{uid_societe}/agents/{id_agent}
        val prefix = "societes/$societeId/agents/$agentId"
        
        // Données principales
        val updates = mutableMapOf<String, Any>(
            "$prefix/lat" to location.latitude,
            "$prefix/lng" to location.longitude,
            "$prefix/lastUpdate" to ts,
            "$prefix/speed" to if (location.hasSpeed()) location.speed else 0f,
            "$prefix/accuracy" to if (location.hasAccuracy()) location.accuracy else 0f,
            "$prefix/altitude" to if (location.hasAltitude()) location.altitude else 0.0,
            "$prefix/bearing" to if (location.hasBearing()) location.bearing else 0f,
            "$prefix/provider" to (location.provider ?: "unknown"),
            "$prefix/totalDistance" to totalDistance,
            "$prefix/updateCount" to locationUpdateCount
        )
        
        // Métadonnées
        if (!name.isNullOrEmpty()) updates["$prefix/name"] = name
        if (!phone.isNullOrEmpty()) updates["$prefix/phone"] = phone
        
        // Historique avec limitation
        updates["$prefix/history/$ts"] = mapOf(
            "lat" to location.latitude,
            "lng" to location.longitude,
            "speed" to if (location.hasSpeed()) location.speed else 0f,
            "accuracy" to if (location.hasAccuracy()) location.accuracy else 0f
        )
        
        // Si pas de réseau, mettre en cache
        if (!isNetworkAvailable) {
            cacheLocation(agentId, societeId, location, ts)
            Log.d(TAG, "📵 Position mise en cache (pas de réseau)")
            return
        }
        
        // Envoyer à Firebase
        db.updateChildren(updates)
            .addOnSuccessListener {
                Log.d(TAG, "✅ Données envoyées à Firebase avec succès")
                
                // Nettoyer l'historique si trop de points
                cleanupHistory(societeId, agentId)
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Erreur Firebase: ${e.message}", e)
                
                // En cas d'erreur, mettre en cache aussi
                cacheLocation(agentId, societeId, location, ts)
            }
    }

    /**
     * Met une position en cache local (SharedPreferences)
     */
    private fun cacheLocation(agentId: String, societeId: String, location: Location, timestamp: Long) {
        val cachePrefs = getSharedPreferences(PREFS_CACHE, MODE_PRIVATE)
        val cachedJson = cachePrefs.getString(KEY_CACHED_LOCATIONS, "[]")
        
        try {
            var cachedArray = JSONArray(cachedJson)
            
            // Limiter le nombre de positions en cache
            if (cachedArray.length() >= MAX_CACHED_LOCATIONS) {
                Log.w(TAG, "Cache plein (${cachedArray.length()}), suppression des anciennes positions")
                // Garder seulement les 400 dernières
                val newArray = JSONArray()
                for (i in (cachedArray.length() - 400) until cachedArray.length()) {
                    newArray.put(cachedArray.getJSONObject(i))
                }
                cachedArray = newArray
            }
            
            // Ajouter la nouvelle position avec societeId
            val locationObj = JSONObject().apply {
                put("agentId", agentId)
                put("societeId", societeId)
                put("lat", location.latitude)
                put("lng", location.longitude)
                put("speed", if (location.hasSpeed()) location.speed else 0f)
                put("accuracy", if (location.hasAccuracy()) location.accuracy else 0f)
                put("altitude", if (location.hasAltitude()) location.altitude else 0.0)
                put("bearing", if (location.hasBearing()) location.bearing else 0f)
                put("provider", location.provider ?: "unknown")
                put("timestamp", timestamp)
            }
            
            cachedArray.put(locationObj)
            
            // Sauvegarder
            cachePrefs.edit().putString(KEY_CACHED_LOCATIONS, cachedArray.toString()).apply()
            cachedLocationsCount = cachedArray.length()
            
            Log.d(TAG, "Position ajoutée au cache ($cachedLocationsCount positions)")
            updateNotification("📵 Cache: $cachedLocationsCount positions")
            
        } catch (e: Exception) {
            Log.e(TAG, "Erreur cache: ${e.message}", e)
        }
    }

    /**
     * Synchronise les positions en cache vers Firebase
     */
    private fun syncCachedLocations() {
        val cachePrefs = getSharedPreferences(PREFS_CACHE, MODE_PRIVATE)
        val cachedJson = cachePrefs.getString(KEY_CACHED_LOCATIONS, "[]")
        
        try {
            val cachedArray = JSONArray(cachedJson)
            val count = cachedArray.length()
            
            if (count == 0) {
                Log.d(TAG, "Aucune position en cache à synchroniser")
                return
            }
            
            Log.i(TAG, "🔄 Synchronisation de $count positions en cache...")
            updateNotification("🔄 Synchronisation de $count positions...")
            
            var syncedCount = 0
            var errorCount = 0
            
            for (i in 0 until count) {
                val locationObj = cachedArray.getJSONObject(i)
                val agentId = locationObj.getString("agentId")
                val societeId = locationObj.optString("societeId", "")
                val ts = locationObj.getLong("timestamp")
                
                // Chemin correct: societes/{uid_societe}/agents/{id_agent}
                val prefix = if (societeId.isNotEmpty()) {
                    "societes/$societeId/agents/$agentId"
                } else {
                    "societes/unknown/agents/$agentId"
                }
                
                val updates = mutableMapOf<String, Any>(
                    "$prefix/lat" to locationObj.getDouble("lat"),
                    "$prefix/lng" to locationObj.getDouble("lng"),
                    "$prefix/lastUpdate" to ts,
                    "$prefix/speed" to locationObj.getDouble("speed"),
                    "$prefix/accuracy" to locationObj.getDouble("accuracy"),
                    "$prefix/altitude" to locationObj.getDouble("altitude"),
                    "$prefix/bearing" to locationObj.getDouble("bearing"),
                    "$prefix/provider" to locationObj.getString("provider"),
                    "$prefix/history/$ts" to mapOf(
                        "lat" to locationObj.getDouble("lat"),
                        "lng" to locationObj.getDouble("lng"),
                        "speed" to locationObj.getDouble("speed"),
                        "accuracy" to locationObj.getDouble("accuracy")
                    )
                )
                
                db.updateChildren(updates)
                    .addOnSuccessListener {
                        syncedCount++
                        if (syncedCount == count) {
                            // Toutes les positions synchronisées
                            cachePrefs.edit().remove(KEY_CACHED_LOCATIONS).apply()
                            cachedLocationsCount = 0
                            Log.i(TAG, "✅ Synchronisation terminée: $syncedCount/$count positions")
                            updateNotification("✅ Synchronisation réussie")
                        }
                    }
                    .addOnFailureListener { e ->
                        errorCount++
                        Log.e(TAG, "Erreur sync position $i: ${e.message}")
                    }
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Erreur synchronisation: ${e.message}", e)
        }
    }

    /**
     * Nettoie l'historique pour ne garder que les N derniers points
     * Chemin: societes/{uid_societe}/agents/{id_agent}/history
     */
    private fun cleanupHistory(societeId: String, agentId: String) {
        val historyRef = db.child("societes/$societeId/agents/$agentId/history")
        
        historyRef.orderByKey().limitToFirst(1).get()
            .addOnSuccessListener { snapshot ->
                val count = snapshot.childrenCount
                if (count > maxHistoryPoints) {
                    // Supprimer les anciens points
                    val toDelete = count - maxHistoryPoints
                    historyRef.orderByKey().limitToFirst(toDelete.toInt()).get()
                        .addOnSuccessListener { oldData ->
                            oldData.children.forEach { child ->
                                child.ref.removeValue()
                            }
                            Log.d(TAG, "Nettoyage historique: $toDelete points supprimés")
                        }
                }
            }
    }

    /**
     * Construit la notification persistante
     */
    private fun buildNotification(text: String): Notification {
        // Intent pour ouvrir l'app au clic
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        
        // Action pour arrêter le service
        val stopIntent = Intent(this, LocationService::class.java).apply {
            action = "STOP_SERVICE"
        }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🛰️ GPS Tracker actif")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pendingIntent)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Arrêter",
                stopPendingIntent
            )
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .build()
    }

    /**
     * Met à jour la notification
     */
    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.notify(NOTIF_ID, buildNotification(text))
    }

    /**
     * Crée le canal de notification (Android 8+)
     */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Service de géolocalisation",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notification persistante pour le suivi GPS en arrière-plan"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
            
            Log.d(TAG, "Canal de notification créé")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Gérer l'action d'arrêt
        if (intent?.action == "STOP_SERVICE") {
            Log.d(TAG, "Arrêt du service demandé")
            stopSelf()
            return START_NOT_STICKY
        }
        
        Log.d(TAG, "Service démarré/redémarré")
        
        // START_STICKY: le système redémarre automatiquement le service
        // si il est tué pour libérer de la mémoire
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "Service détruit")
        
        isRunning = false
        
        // Arrêter les mises à jour GPS
        if (::fusedClient.isInitialized) {
            fusedClient.removeLocationUpdates(locationCallback)
        }
        
        // Arrêter le thread
        if (::locationThread.isInitialized) {
            locationThread.quitSafely()
        }
        
        // Libérer le WakeLock
        if (::wakeLock.isInitialized && wakeLock.isHeld) {
            wakeLock.release()
        }
        
        // Détacher le listener de configuration
        configListener?.let {
            val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
            val agentId = prefs.getString("device_id", null)
            val societeId = prefs.getString("companyId", null)
            if (!agentId.isNullOrEmpty() && !societeId.isNullOrEmpty()) {
                db.child("societes/$societeId/agents/$agentId/config").removeEventListener(it)
                Log.d(TAG, "🎧 Listener de configuration arrêté")
            }
        }
        
        // Désenregistrer les receivers
        batteryReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (e: Exception) {
                Log.e(TAG, "Erreur unregister battery receiver: ${e.message}")
            }
        }
        
        networkReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (e: Exception) {
                Log.e(TAG, "Erreur unregister network receiver: ${e.message}")
            }
        }
        
        // Sauvegarder les statistiques
        saveStatistics()
    }

    /**
     * Sauvegarde les statistiques de la session
     * Chemin: societes/{uid_societe}/agents/{id_agent}/lastSession
     */
    private fun saveStatistics() {
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        val agentId = prefs.getString("device_id", null) ?: return
        val societeId = prefs.getString("companyId", null) ?: return
        
        // Sauvegarder les statistiques du ConfigManager
        configManager.saveStatistics()
        
        val sessionData = mapOf(
            "endTime" to System.currentTimeMillis(),
            "totalUpdates" to locationUpdateCount,
            "totalDistance" to totalDistance,
            "duration" to (System.currentTimeMillis() - lastLocationTime)
        )
        
        // Ajouter les statistiques CO2 si activées
        val stats = configManager.getStatistics()
        val sessionDataWithCO2 = sessionData.toMutableMap()
        if (configManager.isCO2Enabled()) {
            sessionDataWithCO2["totalCO2Kg"] = stats["totalCO2Kg"] as Float
            sessionDataWithCO2["co2Coefficient"] = stats["co2Coefficient"] as Float
        }
        sessionDataWithCO2["trackingMode"] = stats["trackingMode"] as String
        
        // Chemin correct: societes/{uid_societe}/agents/{id_agent}/lastSession
        db.child("societes/$societeId/agents/$agentId/lastSession").setValue(sessionDataWithCO2)
            .addOnSuccessListener {
                Log.d(TAG, "Statistiques sauvegardées: $locationUpdateCount updates, " +
                        "${totalDistance.format(2)}m parcourus")
                if (configManager.isCO2Enabled()) {
                    Log.d(TAG, "CO2 total: ${(stats["totalCO2Kg"] as Float).format(3)}kg")
                }
            }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /**
     * Extension pour formater les nombres
     */
    private fun Float.format(digits: Int) = "%.${digits}f".format(this)
    private fun Double.format(digits: Int) = "%.${digits}f".format(this)
}
