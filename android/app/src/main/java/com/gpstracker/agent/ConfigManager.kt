package com.gpstracker.agent

import android.content.Context
import android.content.SharedPreferences
import android.util.Log

/**
 * Gestionnaire de configuration métier selon le type de véhicule
 * 
 * Gère:
 * - Coefficients d'émission CO2 par type de véhicule
 * - Mode haute fréquence pour secteur scolaire
 * - Calculs de distance et consommation
 * - Synchronisation avec Firebase
 */
class ConfigManager(private val context: Context) {

    companion object {
        private const val TAG = "ConfigManager"
        private const val PREFS_NAME = "gps_tracker"
        
        // Coefficients d'émission CO2 (g/km)
        private const val CO2_MOTO = 80f
        private const val CO2_VOITURE = 150f
        private const val CO2_CAMION = 250f
        private const val CO2_SCOLAIRE = 0f // Désactivé
        
        // Modes de tracking
        private const val MODE_NORMAL = "normal"
        private const val MODE_HIGH_FREQUENCY = "high_frequency"
        
        // Intervalles GPS (ms)
        private const val INTERVAL_NORMAL = 10_000L // 10 secondes
        private const val INTERVAL_HIGH_FREQUENCY = 5_000L // 5 secondes (scolaire)
    }

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    
    // Configuration actuelle
    private var vehicleType: String? = null
    private var sector: String? = null
    private var co2Coefficient: Float = 0f
    private var trackingMode: String = MODE_NORMAL
    private var gpsInterval: Long = INTERVAL_NORMAL
    private var co2Enabled: Boolean = true
    
    // Statistiques
    private var totalDistanceKm: Float = 0f
    private var totalCO2Kg: Float = 0f

    init {
        loadConfiguration()
    }

    /**
     * Charge la configuration depuis SharedPreferences
     */
    private fun loadConfiguration() {
        vehicleType = prefs.getString("vehicleType", null)
        sector = prefs.getString("sector", null)
        
        applyConfiguration()
        
        Log.d(TAG, "Configuration chargée: vehicleType=$vehicleType, sector=$sector")
    }

    /**
     * Met à jour la configuration depuis Firebase
     */
    fun updateFromFirebase(vehicleType: String?, sector: String?) {
        val oldVehicleType = this.vehicleType
        val oldSector = this.sector
        
        this.vehicleType = vehicleType
        this.sector = sector
        
        // Sauvegarder dans SharedPreferences
        prefs.edit().apply {
            if (vehicleType != null) putString("vehicleType", vehicleType)
            if (sector != null) putString("sector", sector)
            apply()
        }
        
        // Appliquer la nouvelle configuration
        applyConfiguration()
        
        // Logger les changements
        if (oldVehicleType != vehicleType || oldSector != sector) {
            Log.i(TAG, "⚙️ Configuration mise à jour: " +
                    "vehicleType=$oldVehicleType→$vehicleType, " +
                    "sector=$oldSector→$sector")
            logCurrentConfig()
        }
    }

    /**
     * Applique la configuration selon le type de véhicule et le secteur
     */
    private fun applyConfiguration() {
        // Priorité au secteur scolaire
        if (sector == "Scolaire" || sector == "scolaire") {
            applyScolaireMode()
            return
        }
        
        // Sinon, appliquer selon le type de véhicule
        when (vehicleType?.lowercase()) {
            "moto" -> applyMotoMode()
            "voiture" -> applyVoitureMode()
            "camion" -> applyCamionMode()
            else -> applyDefaultMode()
        }
    }

    /**
     * Mode Moto: Émissions faibles, tracking standard
     */
    private fun applyMotoMode() {
        co2Coefficient = CO2_MOTO
        co2Enabled = true
        trackingMode = MODE_NORMAL
        gpsInterval = INTERVAL_NORMAL
        
        Log.d(TAG, "🏍️ Mode Moto activé: CO2=${co2Coefficient}g/km, interval=${gpsInterval}ms")
    }

    /**
     * Mode Voiture: Émissions moyennes, tracking standard
     */
    private fun applyVoitureMode() {
        co2Coefficient = CO2_VOITURE
        co2Enabled = true
        trackingMode = MODE_NORMAL
        gpsInterval = INTERVAL_NORMAL
        
        Log.d(TAG, "🚗 Mode Voiture activé: CO2=${co2Coefficient}g/km, interval=${gpsInterval}ms")
    }

    /**
     * Mode Camion: Émissions élevées, tracking standard
     */
    private fun applyCamionMode() {
        co2Coefficient = CO2_CAMION
        co2Enabled = true
        trackingMode = MODE_NORMAL
        gpsInterval = INTERVAL_NORMAL
        
        Log.d(TAG, "🚚 Mode Camion activé: CO2=${co2Coefficient}g/km, interval=${gpsInterval}ms")
    }

    /**
     * Mode Scolaire: Pas de CO2, haute fréquence pour précision maximale
     */
    private fun applyScolaireMode() {
        co2Coefficient = CO2_SCOLAIRE
        co2Enabled = false
        trackingMode = MODE_HIGH_FREQUENCY
        gpsInterval = INTERVAL_HIGH_FREQUENCY
        
        Log.d(TAG, "🎒 Mode Scolaire activé: CO2 désactivé, haute fréquence (${gpsInterval}ms)")
    }

    /**
     * Mode par défaut si type inconnu
     */
    private fun applyDefaultMode() {
        co2Coefficient = CO2_VOITURE // Par défaut: voiture
        co2Enabled = true
        trackingMode = MODE_NORMAL
        gpsInterval = INTERVAL_NORMAL
        
        Log.d(TAG, "⚙️ Mode par défaut activé: CO2=${co2Coefficient}g/km")
    }

    /**
     * Calcule les émissions CO2 pour une distance donnée
     * 
     * @param distanceMeters Distance en mètres
     * @return Émissions CO2 en grammes (0 si désactivé)
     */
    fun calculateCO2(distanceMeters: Float): Float {
        if (!co2Enabled || distanceMeters <= 0) {
            return 0f
        }
        
        val distanceKm = distanceMeters / 1000f
        val co2Grams = distanceKm * co2Coefficient
        
        // Mettre à jour les statistiques
        totalDistanceKm += distanceKm
        totalCO2Kg += co2Grams / 1000f
        
        return co2Grams
    }

    /**
     * Calcule la consommation de carburant estimée
     * 
     * @param distanceMeters Distance en mètres
     * @return Consommation en litres (estimation)
     */
    fun calculateFuelConsumption(distanceMeters: Float): Float {
        if (distanceMeters <= 0) return 0f
        
        val distanceKm = distanceMeters / 1000f
        
        // Consommation moyenne par type (L/100km)
        val consumption100km = when (vehicleType?.lowercase()) {
            "moto" -> 3.5f
            "voiture" -> 7.0f
            "camion" -> 25.0f
            else -> 7.0f
        }
        
        return (distanceKm * consumption100km) / 100f
    }

    /**
     * Retourne l'intervalle GPS recommandé selon la configuration
     */
    fun getRecommendedGpsInterval(): Long {
        return gpsInterval
    }

    /**
     * Vérifie si le mode haute fréquence est actif
     */
    fun isHighFrequencyMode(): Boolean {
        return trackingMode == MODE_HIGH_FREQUENCY
    }

    /**
     * Vérifie si les calculs CO2 sont activés
     */
    fun isCO2Enabled(): Boolean {
        return co2Enabled
    }

    /**
     * Retourne le coefficient CO2 actuel
     */
    fun getCO2Coefficient(): Float {
        return co2Coefficient
    }

    /**
     * Retourne le type de véhicule actuel
     */
    fun getVehicleType(): String? {
        return vehicleType
    }

    /**
     * Retourne le secteur actuel
     */
    fun getSector(): String? {
        return sector
    }

    /**
     * Retourne le mode de tracking actuel
     */
    fun getTrackingMode(): String {
        return trackingMode
    }

    /**
     * Retourne les statistiques totales
     */
    fun getStatistics(): Map<String, Any> {
        return mapOf(
            "totalDistanceKm" to totalDistanceKm,
            "totalCO2Kg" to totalCO2Kg,
            "co2Coefficient" to co2Coefficient,
            "co2Enabled" to co2Enabled,
            "trackingMode" to trackingMode,
            "vehicleType" to (vehicleType ?: "unknown"),
            "sector" to (sector ?: "unknown")
        )
    }

    /**
     * Réinitialise les statistiques
     */
    fun resetStatistics() {
        totalDistanceKm = 0f
        totalCO2Kg = 0f
        
        prefs.edit().apply {
            putFloat("totalDistanceKm", 0f)
            putFloat("totalCO2Kg", 0f)
            apply()
        }
        
        Log.d(TAG, "📊 Statistiques réinitialisées")
    }

    /**
     * Sauvegarde les statistiques dans SharedPreferences
     */
    fun saveStatistics() {
        prefs.edit().apply {
            putFloat("totalDistanceKm", totalDistanceKm)
            putFloat("totalCO2Kg", totalCO2Kg)
            apply()
        }
        
        Log.d(TAG, "💾 Statistiques sauvegardées: ${totalDistanceKm.format(2)}km, ${totalCO2Kg.format(3)}kg CO2")
    }

    /**
     * Charge les statistiques depuis SharedPreferences
     */
    fun loadStatistics() {
        totalDistanceKm = prefs.getFloat("totalDistanceKm", 0f)
        totalCO2Kg = prefs.getFloat("totalCO2Kg", 0f)
        
        Log.d(TAG, "📊 Statistiques chargées: ${totalDistanceKm.format(2)}km, ${totalCO2Kg.format(3)}kg CO2")
    }

    /**
     * Génère un rapport de configuration
     */
    fun getConfigReport(): String {
        return buildString {
            appendLine("=== Configuration GPS Tracker ===")
            appendLine("Type de véhicule: ${vehicleType ?: "Non défini"}")
            appendLine("Secteur: ${sector ?: "Non défini"}")
            appendLine("Mode tracking: $trackingMode")
            appendLine("Intervalle GPS: ${gpsInterval}ms")
            appendLine("CO2 activé: $co2Enabled")
            if (co2Enabled) {
                appendLine("Coefficient CO2: ${co2Coefficient}g/km")
            }
            appendLine("=== Statistiques ===")
            appendLine("Distance totale: ${totalDistanceKm.format(2)} km")
            if (co2Enabled) {
                appendLine("CO2 total: ${totalCO2Kg.format(3)} kg")
            }
        }
    }

    /**
     * Log la configuration actuelle
     */
    private fun logCurrentConfig() {
        Log.i(TAG, """
            ╔════════════════════════════════════════╗
            ║     Configuration GPS Tracker          ║
            ╠════════════════════════════════════════╣
            ║ Type véhicule: ${vehicleType?.padEnd(20) ?: "Non défini".padEnd(20)} ║
            ║ Secteur: ${sector?.padEnd(26) ?: "Non défini".padEnd(26)} ║
            ║ Mode: ${trackingMode.padEnd(29)} ║
            ║ Intervalle GPS: ${gpsInterval.toString().padEnd(19)}ms ║
            ║ CO2 activé: ${co2Enabled.toString().padEnd(24)} ║
            ║ Coefficient CO2: ${co2Coefficient.toString().padEnd(17)}g/km ║
            ╚════════════════════════════════════════╝
        """.trimIndent())
    }

    /**
     * Extension pour formater les nombres
     */
    private fun Float.format(digits: Int) = "%.${digits}f".format(this)
}
