package com.gpstracker.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Démarre automatiquement les services GPS et de protection antivol au démarrage du téléphone.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs    = context.getSharedPreferences("gps_tracker", Context.MODE_PRIVATE)
            val deviceId = prefs.getString("device_id", null)

            // Ne démarre que si un device ID a été configuré
            if (!deviceId.isNullOrEmpty()) {
                // Démarrage du service GPS de géolocalisation
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, LocationService::class.java)
                )

                // [DESTRUCTION] — Démarrage du service de protection antivol
                // Écoute les commandes de destruction et les tentatives de désinstallation
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, DestructionMonitorService::class.java)
                )
            }
        }
    }
}
