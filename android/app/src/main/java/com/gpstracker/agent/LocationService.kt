package com.gpstracker.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.google.firebase.database.FirebaseDatabase

class LocationService : Service() {

    companion object {
        var isRunning = false
        private const val CHANNEL_ID = "gps_tracker_channel"
        private const val NOTIF_ID = 1
        /** Intervalle entre envois (ms) */
        private const val INTERVAL_MS = 10_000L
    }

    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private val db = FirebaseDatabase.getInstance().reference

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Démarrage GPS…"))
        startLocationUpdates()
    }

    private fun startLocationUpdates() {
        fusedClient = LocationServices.getFusedLocationProviderClient(this)

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
            .setMinUpdateIntervalMillis(INTERVAL_MS / 2)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { sendToFirebase(it) }
            }
        }

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
        } catch (_: SecurityException) {
            stopSelf()
        }
    }

    private fun sendToFirebase(location: Location) {
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        val agentId = prefs.getString("device_id", null) ?: return
        val name = prefs.getString("name", "")
        val phone = prefs.getString("phone", "")
        val ts = System.currentTimeMillis()

        val prefix = "agents/$agentId"
        val updates = mutableMapOf<String, Any>(
            "$prefix/lat" to location.latitude,
            "$prefix/lng" to location.longitude,
            "$prefix/lastUpdate" to ts,
            "$prefix/history/$ts/lat" to location.latitude,
            "$prefix/history/$ts/lng" to location.longitude,
        )
        if (!name.isNullOrEmpty()) updates["$prefix/name"] = name
        if (!phone.isNullOrEmpty()) updates["$prefix/phone"] = phone

        db.updateChildren(updates)

        updateNotification("📍 ${location.latitude.format(5)}, ${location.longitude.format(5)}")
    }

    private fun Double.format(digits: Int) = "%.${digits}f".format(this)

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GPS Tracker actif")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIF_ID, buildNotification(text))
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "GPS Tracker",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Tracking GPS en arrière-plan" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY // redémarre automatiquement si tué par le système
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        fusedClient.removeLocationUpdates(locationCallback)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
