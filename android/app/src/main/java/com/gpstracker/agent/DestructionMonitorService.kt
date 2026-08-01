package com.gpstracker.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener

/**
 * DestructionMonitorService — Service de surveillance antivol.
 *
 * ── Ce qui fonctionne réellement (APK classique, sans Device Owner) ────────
 *
 *  1. ALERTE DÉSINSTALLATION
 *     Quand AdminReceiver détecte une tentative de désactivation admin,
 *     ce service envoie immédiatement une alerte dans Firebase :
 *       → uninstall_alerts/{agentId}
 *       → companies/{companyId}/uninstall_alerts/{agentId}
 *     Le dashboard admin affiche l'alerte en temps réel.
 *
 *  2. DESTRUCTION À DISTANCE (partielle)
 *     Le dashboard écrit destruction_commands/{agentId} avec status "pending".
 *     Ce service écoute ce nœud en temps réel et exécute :
 *       → Effacement de toutes les données locales de l'app (SharedPrefs + cache)
 *       → L'app ne peut plus tracker ni s'identifier après ça
 *     Statut écrit dans Firebase : "partial_executed"
 *
 * ── Ce qui NE fonctionne PAS sans Device Owner (supprimé) ─────────────────
 *  - wipeData() → reset usine complet — nécessite Device Owner
 *  Conservé : la logique détecte toujours si Device Owner devient disponible
 *  (enrôlement MDM futur), auquel cas wipeData() sera automatiquement utilisé.
 *
 * ── Architecture ───────────────────────────────────────────────────────────
 *  - Service Foreground (résiste à la mise en veille système)
 *  - START_STICKY (redémarre automatiquement si tué)
 *  - Écoute Firebase en temps réel via ValueEventListener
 *  - Option payante : destruction_enabled dans companies/{id}/options
 */
class DestructionMonitorService : Service() {

    companion object {
        private const val TAG         = "DestructionMonitor"
        private const val CHANNEL_ID  = "destruction_monitor_channel"
        private const val NOTIF_ID    = 42

        // Flag positionné par AdminReceiver avant de démarrer ce service
        var uninstallAttemptDetected = false
        var isRunning                = false
    }

    private val db = FirebaseDatabase.getInstance().reference
    private var destructionListener: ValueEventListener? = null
    private var agentId:   String?  = null
    private var companyId: String?  = null

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Protection antivol active"))
        Log.i(TAG, "DestructionMonitorService démarré")

        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        agentId   = prefs.getString("device_id", null)
        companyId = prefs.getString("companyId", null)

        if (agentId.isNullOrEmpty()) {
            Log.w(TAG, "Agent ID non configuré — service arrêté")
            stopSelf()
            return
        }

        verifierOptionDestruction()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // AdminReceiver a positionné ce flag avant de démarrer le service
        if (uninstallAttemptDetected) {
            envoyerAlerteDesinstallation()
            uninstallAttemptDetected = false
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        agentId?.let { id ->
            destructionListener?.let { listener ->
                db.child("destruction_commands/$id").removeEventListener(listener)
            }
        }
        Log.i(TAG, "DestructionMonitorService arrêté")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vérification de l'option payante
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Vérifie si la société a souscrit l'option "Antivol Avancé".
     * L'écoute des commandes est démarrée dans tous les cas —
     * la vérification sert uniquement à logger l'état de l'option.
     */
    private fun verifierOptionDestruction() {
        val cId = companyId ?: run {
            demarrerEcouteCommandes()
            return
        }

        FirebaseAuthHelper.ensureSignedIn(
            onReady = { lireOptionDestruction(cId) },
            onError = {
                Log.w(TAG, "Auth anonyme impossible — écoute démarrée quand même")
                demarrerEcouteCommandes()
            }
        )
    }

    private fun lireOptionDestruction(cId: String) {
        db.child("companies/$cId/options/destruction_enabled").get()
            .addOnSuccessListener { snap ->
                val enabled = snap.getValue(Boolean::class.java) ?: false
                Log.i(TAG, "Option destruction activée : $enabled")
                demarrerEcouteCommandes()
            }
            .addOnFailureListener {
                Log.w(TAG, "Impossible de vérifier l'option destruction — écoute démarrée quand même")
                demarrerEcouteCommandes()
            }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Écoute temps réel des commandes de destruction Firebase
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Écoute destruction_commands/{agentId} en temps réel.
     * Déclenche la destruction quand command="DESTROY" et status="pending".
     * Le statut est passé à "executing" avant l'action pour éviter tout re-déclenchement.
     */
    private fun demarrerEcouteCommandes() {
        val id = agentId ?: return

        destructionListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (!snapshot.exists()) return

                val command = snapshot.child("command").getValue(String::class.java)
                val status  = snapshot.child("status").getValue(String::class.java)
                val reason  = snapshot.child("reason").getValue(String::class.java)

                Log.i(TAG, "Commande reçue : $command (status=$status)")

                if (command == "DESTROY" && status == "pending") {
                    db.child("destruction_commands/$id/status").setValue("executing")
                        .addOnSuccessListener {
                            executerDestruction(reason ?: "Commande admin")
                        }
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Erreur écoute commandes : ${error.message}")
            }
        }

        db.child("destruction_commands/$id").addValueEventListener(destructionListener!!)
        Log.i(TAG, "Écoute commandes démarrée pour agent : $id")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Alerte désinstallation forcée
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Envoie une alerte dans Firebase quand une tentative de désactivation
     * des droits admin est détectée (via AdminReceiver).
     *
     * Écrit dans :
     *  - uninstall_alerts/{agentId}                        → dashboard super admin
     *  - companies/{companyId}/uninstall_alerts/{agentId}  → dashboard propriétaire
     */
    fun envoyerAlerteDesinstallation() {
        val id  = agentId  ?: return
        val cId = companyId

        Log.w(TAG, "🚨 ALERTE DÉSINSTALLATION FORCÉE — Agent : $id")
        afficherNotificationUrgente()

        FirebaseAuthHelper.ensureSignedIn(onReady = { envoyerAlerteApresAuth(id, cId) })
    }

    private fun envoyerAlerteApresAuth(id: String, cId: String?) {
        val alerte = mapOf(
            "agentId"    to id,
            "ownerId"    to (cId ?: "unknown"),
            "companyId"  to (cId ?: "unknown"),
            "timestamp"  to System.currentTimeMillis(),
            "message"    to "Tentative de désinstallation forcée détectée sur cet appareil",
            "status"     to "active",
            "deviceInfo" to mapOf(
                "model"   to Build.MODEL,
                "brand"   to Build.BRAND,
                "sdk"     to Build.VERSION.SDK_INT,
                "android" to Build.VERSION.RELEASE
            )
        )

        db.child("uninstall_alerts/$id").setValue(alerte)
            .addOnSuccessListener { Log.i(TAG, "✅ Alerte envoyée → uninstall_alerts/$id") }
            .addOnFailureListener { e -> Log.e(TAG, "❌ Échec alerte : ${e.message}") }

        if (cId != null) {
            db.child("companies/$cId/uninstall_alerts/$id").setValue(alerte)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Destruction
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Exécute la séquence de destruction à distance.
     *
     * Étape 1 (toujours) — Effacement des données locales :
     *   SharedPreferences "gps_tracker" + "location_cache" + cache disque.
     *   Après ça, l'app ne peut plus tracker ni s'identifier.
     *   Statut Firebase : "partial_executed"
     *
     * Étape 2 (Device Owner uniquement, futur enrôlement MDM) :
     *   wipeData() → reset usine complet.
     *   Statut Firebase : "executed"
     *   Non disponible en APK classique — détecté dynamiquement.
     */
    private fun executerDestruction(reason: String) {
        val id = agentId ?: return
        Log.e(TAG, "💣 DESTRUCTION DÉCLENCHÉE — Raison : $reason")

        // Étape 1 : Effacer toutes les données locales (fonctionne toujours)
        try {
            getSharedPreferences("gps_tracker",     MODE_PRIVATE).edit().clear().apply()
            getSharedPreferences("location_cache",  MODE_PRIVATE).edit().clear().apply()
            cacheDir.deleteRecursively()
            Log.i(TAG, "✅ Données locales effacées")
        } catch (e: Exception) {
            Log.e(TAG, "Erreur effacement données : ${e.message}")
        }

        // Étape 2 : Vérifier si Device Owner disponible (enrôlement MDM)
        try {
            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager

            if (dpm.isDeviceOwnerApp(packageName)) {
                // Device Owner disponible → reset usine complet
                Log.e(TAG, "💣 Device Owner détecté — wipeData (reset usine)")

                db.child("destruction_commands/$id/status").setValue("executed")
                db.child("destruction_commands/$id/executedAt").setValue(System.currentTimeMillis())

                // Délai pour laisser Firebase écrire avant le reset
                android.os.Handler(mainLooper).postDelayed({
                    @Suppress("DEPRECATION")
                    dpm.wipeData(0)
                }, 2000)

            } else {
                // APK classique — destruction partielle (données effacées à l'étape 1)
                Log.w(TAG, "⚠️ Device Owner non disponible — destruction partielle effectuée")
                db.child("destruction_commands/$id").updateChildren(mapOf(
                    "status"     to "partial_executed",
                    "executedAt" to System.currentTimeMillis(),
                    "message"    to "Données app effacées — Device Owner non disponible pour reset usine"
                ))
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erreur vérification Device Owner : ${e.message}")
            db.child("destruction_commands/$id").updateChildren(mapOf(
                "status"     to "partial_executed",
                "executedAt" to System.currentTimeMillis(),
                "message"    to "Données app effacées (exception : ${e.message})"
            ))
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Notifications
    // ─────────────────────────────────────────────────────────────────────────

    private fun afficherNotificationUrgente() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("⚠️ Alerte Sécurité GPS Tracker")
            .setContentText("Tentative de désinstallation détectée. Le propriétaire a été alerté.")
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(false)
            .setOngoing(true)
            .build()
        manager.notify(NOTIF_ID + 10, notif)
    }

    private fun buildNotification(message: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("GPS Tracker — Antivol")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "GPS Tracker — Protection Antivol",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Service de protection contre la désinstallation"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
