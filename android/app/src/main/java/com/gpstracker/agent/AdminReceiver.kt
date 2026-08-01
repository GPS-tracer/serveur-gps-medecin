package com.gpstracker.agent

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * AdminReceiver — Device Admin Receiver
 *
 * Rôle : Point d'entrée des droits administrateur de l'application.
 *
 * ── Mode réel (APK classique, cas de tous les clients) ────────────────────
 * L'app est installée via téléchargement APK direct.
 * Elle obtient les droits Device Admin (niveau 1), PAS Device Owner (niveau 2).
 *
 * Ce que Device Admin permet RÉELLEMENT dans ce contexte :
 *  - Détecter une tentative de désactivation/désinstallation → onDisableRequested()
 *  - Détecter une désactivation forcée réussie              → onDisabled()
 *  - Envoyer une alerte Firebase instantanée dans les deux cas
 *  - Afficher un message dissuasif à l'utilisateur
 *
 * Ce qui NE fonctionne PAS sans Device Owner (retiré du code) :
 *  - DISALLOW_UNINSTALL_APPS, DISALLOW_FACTORY_RESET, DISALLOW_SAFE_BOOT, etc.
 *  - setKeyguardDisabled, setStatusBarDisabled, setLockTaskPackages (kiosk mode)
 *  - wipeData() (reset usine)
 *  - onProfileProvisioningComplete() (jamais déclenché sans provisioning QR Code)
 *
 * ── Résumé honnête ─────────────────────────────────────────────────────────
 * Protection = DÉTECTION + ALERTE INSTANTANÉE, pas blocage physique.
 * Un voleur débrouillard peut désactiver l'admin et désinstaller l'app.
 * Mais le propriétaire reçoit une alerte avec la dernière position connue
 * AVANT que la désinstallation soit terminée — fenêtre d'action réelle.
 */
class AdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "AdminReceiver"

        /**
         * Retourne le ComponentName de cet AdminReceiver.
         * Utilisé partout où DevicePolicyManager en a besoin.
         */
        fun getComponentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, AdminReceiver::class.java)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Activation de l'admin
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Déclenché quand l'utilisateur accorde les droits Device Admin à l'app.
     * En APK classique, aucune politique MDM n'est applicable ici.
     */
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "🔐 Device Admin activé")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Détection des tentatives de désactivation — cœur de la protection
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Déclenché quand l'utilisateur tente de désactiver les droits admin
     * (via Paramètres → Sécurité → Administrateurs de l'appareil).
     *
     * Ce callback s'exécute AVANT la désactivation effective.
     * C'est la fenêtre la plus fiable pour envoyer l'alerte Firebase.
     *
     * Retourne un message dissuasif affiché à l'utilisateur.
     */
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        Log.w(TAG, "⚠️ Tentative de désactivation de l'admin — Alerte Firebase envoyée")
        signalerTentativeDesinstallation(context)
        return context.getString(R.string.admin_disable_warning)
    }

    /**
     * Déclenché si la désactivation de l'admin a réussi (droits retirés).
     * À ce stade le voleur peut désinstaller l'app librement.
     * On envoie quand même une alerte — utile si onDisableRequested a échoué.
     */
    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.e(TAG, "❌ ALERTE CRITIQUE : Device Admin désactivé — Sécurité compromise")
        signalerTentativeDesinstallation(context)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Envoi de l'alerte
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Démarre DestructionMonitorService pour envoyer l'alerte Firebase.
     * En fallback (si le service ne peut pas démarrer), écrit directement dans Firebase.
     */
    private fun signalerTentativeDesinstallation(context: Context) {
        // Marquer le flag pour que le service envoie l'alerte dès son démarrage
        DestructionMonitorService.uninstallAttemptDetected = true

        val serviceIntent = Intent(context, DestructionMonitorService::class.java)
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Impossible de démarrer DestructionMonitorService : ${e.message}")

            // Fallback : écriture directe dans Firebase
            val prefs   = context.getSharedPreferences("gps_tracker", android.content.Context.MODE_PRIVATE)
            val agentId = prefs.getString("device_id", "unknown") ?: "unknown"
            val cId     = prefs.getString("companyId", "unknown") ?: "unknown"
            val db      = com.google.firebase.database.FirebaseDatabase.getInstance().reference

            FirebaseAuthHelper.ensureSignedIn(onReady = {
                db.child("uninstall_alerts/$agentId").setValue(mapOf(
                    "agentId"   to agentId,
                    "ownerId"   to cId,
                    "companyId" to cId,
                    "timestamp" to System.currentTimeMillis(),
                    "message"   to "Désactivation admin forcée détectée (fallback direct)",
                    "status"    to "active"
                ))
            })
        }
    }
}
