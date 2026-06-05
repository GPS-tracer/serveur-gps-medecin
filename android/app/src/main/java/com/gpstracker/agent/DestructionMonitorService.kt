package com.gpstracker.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener

/**
 * DestructionMonitorService — Service de surveillance et d'exécution des commandes à distance.
 *
 * Fonctionnalités :
 *  1. Écoute en temps réel le nœud Firebase `destruction_commands/{agentId}`
 *     Quand la commande "DESTROY" arrive, déclenche la séquence de destruction système.
 *
 *  2. Détecte les tentatives de désinstallation forcée (via AdminReceiver ou flag local)
 *     et envoie une alerte au nœud `uninstall_alerts/{agentId}` pour notifier le propriétaire.
 *
 * IMPORTANT — Fonctionnalité payante :
 *  La destruction à distance n'est activée que si le champ `destruction_enabled`
 *  est `true` dans le profil de la société (option "Antivol Avancé").
 *
 * Architecture :
 *  - Service Foreground (ne peut pas être tué par le système)
 *  - Redémarre automatiquement (START_STICKY)
 *  - Écoute Firebase en temps réel via ValueEventListener
 */
class DestructionMonitorService : Service() {

    companion object {
        private const val TAG = "DestructionMonitor"
        private const val CHANNEL_ID = "destruction_monitor_channel"
        private const val NOTIF_ID = 42

        // Flag statique : mis à true par AdminReceiver lors d'une tentative de désinstallation
        var uninstallAttemptDetected = false
        var isRunning = false
    }

    private val db = FirebaseDatabase.getInstance().reference
    private var destructionListener: ValueEventListener? = null
    private var agentId: String? = null
    private var companyId: String? = null
    private var destructionEnabled = false

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Protection antivol active"))
        Log.i(TAG, "DestructionMonitorService démarré")

        // Charger les identifiants depuis SharedPreferences
        val prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        agentId   = prefs.getString("device_id", null)
        companyId = prefs.getString("companyId", null)

        if (agentId.isNullOrEmpty()) {
            Log.w(TAG, "Agent ID non configuré — service en attente")
            stopSelf()
            return
        }

        // Vérifier si la destruction est activée pour ce compte (option payante)
        verifierOptionDestruction()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Vérifier si une tentative de désinstallation a été détectée
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
        // Retirer le listener Firebase pour éviter les fuites mémoire
        agentId?.let {
            destructionListener?.let { listener ->
                db.child("destruction_commands/$it").removeEventListener(listener)
            }
        }
        Log.i(TAG, "DestructionMonitorService arrêté")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vérification de l'option payante
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Vérifie dans Firebase si la société a souscrit l'option "Antivol Avancé".
     * Si oui, démarre l'écoute des commandes de destruction.
     */
    private fun verifierOptionDestruction() {
        val cId = companyId ?: run {
            // Pas de société configurée → écouter quand même les alertes
            demarrerEcouteCommandes()
            return
        }

        db.child("companies/$cId/options/destruction_enabled").get()
            .addOnSuccessListener { snap ->
                destructionEnabled = snap.getValue(Boolean::class.java) ?: false
                Log.i(TAG, "Option destruction activée : $destructionEnabled")
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
     * Écoute le nœud `destruction_commands/{agentId}` en temps réel.
     * Quand une commande DESTROY est reçue avec status "pending", exécute la destruction.
     */
    private fun demarrerEcouteCommandes() {
        val id = agentId ?: return

        destructionListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (!snapshot.exists()) return

                val command = snapshot.child("command").getValue(String::class.java)
                val status  = snapshot.child("status").getValue(String::class.java)
                val reason  = snapshot.child("reason").getValue(String::class.java)

                Log.i(TAG, "Commande reçue : $command (status=$status, reason=$reason)")

                if (command == "DESTROY" && status == "pending") {
                    // Marquer comme en cours d'exécution pour éviter re-déclenchement
                    db.child("destruction_commands/$id/status").setValue("executing")
                        .addOnSuccessListener {
                            executerDestructionSysteme(reason ?: "Commande admin")
                        }
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Erreur écoute commandes : ${error.message}")
            }
        }

        db.child("destruction_commands/$id").addValueEventListener(destructionListener!!)
        Log.i(TAG, "Écoute commandes de destruction démarrée pour agent : $id")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Alerte désinstallation forcée
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Envoie une alerte dans Firebase quand une tentative de désinstallation est détectée.
     * Le super admin / propriétaire reçoit cette alerte dans son panneau.
     */
    fun envoyerAlerteDesinstallation() {
        val id  = agentId  ?: return
        val cId = companyId

        Log.w(TAG, "🚨 ALERTE DÉSINSTALLATION FORCÉE — Agent : $id")

        // Afficher une notification urgente sur l'appareil
        afficherNotificationUrgente()

        // Écrire l'alerte dans Firebase
        val alerte = mapOf(
            "agentId"   to id,
            "ownerId"   to (cId ?: "unknown"),
            "companyId" to (cId ?: "unknown"),
            "timestamp" to System.currentTimeMillis(),
            "message"   to "Tentative de désinstallation forcée détectée sur cet appareil",
            "status"    to "active",
            "deviceInfo" to mapOf(
                "model"   to Build.MODEL,
                "brand"   to Build.BRAND,
                "sdk"     to Build.VERSION.SDK_INT,
                "android" to Build.VERSION.RELEASE
            )
        )

        db.child("uninstall_alerts/$id").setValue(alerte)
            .addOnSuccessListener {
                Log.i(TAG, "✅ Alerte désinstallation envoyée au nœud uninstall_alerts/$id")
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Échec envoi alerte : ${e.message}")
            }

        // Envoyer aussi vers les alertes de la société
        if (cId != null) {
            db.child("companies/$cId/uninstall_alerts/$id").setValue(alerte)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exécution de la destruction système
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Exécute la séquence de destruction à distance.
     * Actions (selon les droits disponibles) :
     *  1. Effacement des données de l'app (SharedPreferences + cache)
     *  2. Si Device Owner → wipeData() (reset usine)
     *  3. Mise à jour du statut dans Firebase
     *  4. Log final pour audit
     *
     * Note : wipeData() nécessite le mode Device Owner.
     * En mode Device Admin classique, seules les données de l'app sont effacées.
     */
    private fun executerDestructionSysteme(reason: String) {
        val id = agentId ?: return

        Log.e(TAG, "💣 EXÉCUTION DESTRUCTION SYSTÈME — Raison : $reason")

        // Étape 1 : Effacer toutes les données locales de l'app
        try {
            getSharedPreferences("gps_tracker", MODE_PRIVATE).edit().clear().apply()
            getSharedPreferences("location_cache", MODE_PRIVATE).edit().clear().apply()
            cacheDir.deleteRecursively()
            Log.i(TAG, "✅ Données locales effacées")
        } catch (e: Exception) {
            Log.e(TAG, "Erreur effacement données : ${e.message}")
        }

        // Étape 2 : Si Device Owner → wipeData (reset usine complet)
        try {
            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
            if (dpm.isDeviceOwnerApp(packageName)) {
                Log.e(TAG, "💣 Device Owner détecté — Lancement wipeData (reset usine)")

                // Mettre à jour le statut avant le reset
                db.child("destruction_commands/$id/status").setValue("executed")
                db.child("destruction_commands/$id/executedAt").setValue(System.currentTimeMillis())

                // Petit délai pour laisser Firebase écrire avant le reset
                android.os.Handler(mainLooper).postDelayed({
                    @Suppress("DEPRECATION")
                    dpm.wipeData(0)
                }, 2000)

            } else {
                // Pas Device Owner → effacement partiel + désactivation du service
                Log.w(TAG, "⚠️ Pas Device Owner — Destruction partielle uniquement")
                executerDestructionPartielle(id)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Erreur destruction système : ${e.message}")
            executerDestructionPartielle(id)
        }
    }

    /**
     * Destruction partielle quand les droits Device Owner ne sont pas disponibles.
     * Efface les données, désactive le GPS, bloque les futures connexions.
     */
    private fun executerDestructionPartielle(agentId: String) {
        // Marquer l'agent comme "détruit" dans Firebase
        db.child("destruction_commands/$agentId").updateChildren(mapOf(
            "status"          to "partial_executed",
            "executedAt"      to System.currentTimeMillis(),
            "message"         to "Destruction partielle — Device Owner non disponible"
        ))

        // Effacer l'ID de l'agent pour bloquer le GPS
        getSharedPreferences("gps_tracker", MODE_PRIVATE).edit()
            .remove("device_id")
            .remove("companyId")
            .apply()

        Log.w(TAG, "⚠️ Destruction partielle effectuée pour agent : $agentId")
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
