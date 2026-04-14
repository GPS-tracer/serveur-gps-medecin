package com.gpstracker.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Démarre automatiquement le service GPS au démarrage du téléphone.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs = context.getSharedPreferences("gps_tracker", Context.MODE_PRIVATE)
            val deviceId = prefs.getString("device_id", null)
            // Ne démarre que si un device ID a été configuré
            if (!deviceId.isNullOrEmpty()) {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, LocationService::class.java)
                )
            }
        }
    }
}
