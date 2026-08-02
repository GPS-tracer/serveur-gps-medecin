package com.gpstracker.agent

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.util.Log

/**
 * NetworkMonitor — Surveillance de la connectivité réseau.
 *
 * Utilise NetworkCallback (API 24+) pour détecter les changements
 * de connectivité de façon fiable en arrière-plan.
 * Fallback sur ConnectivityManager.activeNetworkInfo pour API 21–23.
 *
 * Usage :
 *   val monitor = NetworkMonitor(context)
 *   monitor.start(
 *     onAvailable  = { /* réseau dispo — synchro cache */ },
 *     onLost       = { /* réseau perdu — mode cache    */ }
 *   )
 *   // plus tard :
 *   monitor.stop()
 */
class NetworkMonitor(private val context: Context) {

    companion object {
        private const val TAG = "NetworkMonitor"
    }

    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // ─────────────────────────────────────────────────────────
    // État courant
    // ─────────────────────────────────────────────────────────

    /**
     * Retourne true si une connexion Internet active est disponible.
     */
    val isAvailable: Boolean
        get() {
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val network      = connectivityManager.activeNetwork ?: return false
                val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            } else {
                @Suppress("DEPRECATION")
                connectivityManager.activeNetworkInfo?.isConnected == true
            }
        }

    // ─────────────────────────────────────────────────────────
    // Démarrage / Arrêt
    // ─────────────────────────────────────────────────────────

    /**
     * Démarre la surveillance réseau.
     *
     * @param onAvailable Appelé quand le réseau devient disponible.
     * @param onLost      Appelé quand le réseau est perdu.
     */
    fun start(onAvailable: () -> Unit, onLost: () -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            val request = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()

            networkCallback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    Log.i(TAG, "📶 Réseau disponible")
                    onAvailable()
                }

                override fun onLost(network: Network) {
                    Log.w(TAG, "📵 Réseau perdu")
                    onLost()
                }
            }

            connectivityManager.registerNetworkCallback(request, networkCallback!!)
            Log.d(TAG, "NetworkCallback démarré (API ${Build.VERSION.SDK_INT})")
        } else {
            // API 21–23 : pas de NetworkCallback fiable — on lit l'état une seule fois
            Log.d(TAG, "API < 24 : surveillance passive uniquement")
        }
    }

    /**
     * Arrête la surveillance et libère les ressources.
     */
    fun stop() {
        networkCallback?.let {
            try {
                connectivityManager.unregisterNetworkCallback(it)
                Log.d(TAG, "NetworkCallback arrêté")
            } catch (e: Exception) {
                Log.w(TAG, "Erreur arrêt NetworkCallback : ${e.message}")
            }
            networkCallback = null
        }
    }
}
