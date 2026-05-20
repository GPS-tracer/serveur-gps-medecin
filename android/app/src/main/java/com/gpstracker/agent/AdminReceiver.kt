package com.gpstracker.agent

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.UserManager
import android.util.Log

/**
 * AdminReceiver — Device Owner / Device Admin Receiver
 *
 * Rôle : Point d'entrée MDM de l'application.
 * Activé lors de l'enrôlement QR Code en mode Device Owner (DO).
 *
 * Politiques appliquées automatiquement dès l'enrôlement :
 *  - DISALLOW_UNINSTALL_APPS       → empêche la désinstallation de toute app
 *  - DISALLOW_FACTORY_RESET        → bloque la réinitialisation usine
 *  - DISALLOW_ADD_USER             → empêche la création de nouveaux utilisateurs
 *  - DISALLOW_SAFE_BOOT            → bloque le démarrage en mode sans échec
 *  - DISALLOW_DEBUGGING_FEATURES   → désactive ADB en production
 *  - setLockTaskPackages           → verrouille l'écran sur notre app (kiosk mode)
 *  - setStatusBarDisabled          → masque la barre de statut (Android 6+)
 *  - setKeyguardDisabled           → supprime l'écran de verrouillage
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
    // Cycle de vie Device Owner
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Déclenché à la fin du provisioning QR Code (mode Device Owner).
     * C'est ici qu'on applique TOUTES les politiques de sécurité.
     */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        Log.i(TAG, "✅ Provisioning Device Owner terminé — Application des politiques de sécurité")

        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = getComponentName(context)

        applySecurityPolicies(context, dpm, adminComponent)
        enableKioskMode(context, dpm, adminComponent)

        // Lancer MainActivity après le provisioning
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)

        Log.i(TAG, "🚀 Application lancée après provisioning")
    }

    /**
     * Déclenché quand l'admin est activé (mode Device Admin classique).
     */
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i(TAG, "🔐 Device Admin activé")

        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = getComponentName(context)

        // Appliquer les politiques si on est Device Owner
        if (dpm.isDeviceOwnerApp(context.packageName)) {
            applySecurityPolicies(context, dpm, adminComponent)
            enableKioskMode(context, dpm, adminComponent)
            Log.i(TAG, "✅ Politiques Device Owner appliquées depuis onEnabled")
        }
    }

    /**
     * Tentative de désactivation de l'admin par l'utilisateur.
     * On retourne un message dissuasif — la désactivation reste bloquée
     * par les restrictions UserManager appliquées dans applySecurityPolicies().
     */
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence {
        Log.w(TAG, "⚠️ Tentative de désactivation de l'admin bloquée")
        return context.getString(R.string.admin_disable_warning)
    }

    /**
     * Déclenché si l'admin est quand même désactivé (ne devrait pas arriver
     * en mode Device Owner, mais on log pour audit).
     */
    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.e(TAG, "❌ ALERTE : Device Admin désactivé — Sécurité compromise")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Application des politiques de sécurité
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Applique l'ensemble des restrictions utilisateur et politiques MDM.
     * Appelé depuis onProfileProvisioningComplete ET onEnabled.
     */
    private fun applySecurityPolicies(
        context: Context,
        dpm: DevicePolicyManager,
        adminComponent: ComponentName
    ) {
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            Log.w(TAG, "⚠️ Pas Device Owner — politiques complètes non applicables")
            return
        }

        try {
            // ── Restrictions anti-désinstallation ──────────────────────────
            // Empêche l'utilisateur de désinstaller n'importe quelle application
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_UNINSTALL_APPS)
            Log.d(TAG, "🔒 DISALLOW_UNINSTALL_APPS appliqué")

            // ── Restrictions anti-reset ────────────────────────────────────
            // Bloque la réinitialisation usine depuis les paramètres
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_FACTORY_RESET)
            Log.d(TAG, "🔒 DISALLOW_FACTORY_RESET appliqué")

            // ── Restrictions multi-utilisateurs ───────────────────────────
            // Empêche la création de nouveaux comptes utilisateurs
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_ADD_USER)
            Log.d(TAG, "🔒 DISALLOW_ADD_USER appliqué")

            // ── Restrictions mode sans échec ───────────────────────────────
            // Bloque le démarrage en Safe Boot (contournement MDM)
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_SAFE_BOOT)
            Log.d(TAG, "🔒 DISALLOW_SAFE_BOOT appliqué")

            // ── Restrictions débogage ──────────────────────────────────────
            // Désactive ADB et les options développeur
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_DEBUGGING_FEATURES)
            Log.d(TAG, "🔒 DISALLOW_DEBUGGING_FEATURES appliqué")

            // ── Restrictions réseau ────────────────────────────────────────
            // Empêche la modification des paramètres réseau
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_CONFIG_WIFI)
            dpm.addUserRestriction(adminComponent, UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS)
            Log.d(TAG, "🔒 Restrictions réseau appliquées")

            // ── Désactiver l'écran de verrouillage ────────────────────────
            dpm.setKeyguardDisabled(adminComponent, true)
            Log.d(TAG, "🔒 Keyguard désactivé")

            // ── Désactiver la barre de statut (Android 6+) ────────────────
            @Suppress("DEPRECATION")
            dpm.setStatusBarDisabled(adminComponent, true)
            Log.d(TAG, "🔒 Barre de statut désactivée")

            Log.i(TAG, "✅ Toutes les politiques de sécurité ont été appliquées avec succès")

        } catch (e: SecurityException) {
            Log.e(TAG, "❌ Erreur application politiques: ${e.message}", e)
        }
    }

    /**
     * Active le mode kiosque (Lock Task Mode) pour verrouiller l'appareil
     * sur notre application uniquement.
     *
     * En mode kiosque :
     *  - L'utilisateur ne peut pas quitter l'app
     *  - Le bouton Home est désactivé
     *  - Le bouton Récents est désactivé
     *  - La barre de navigation est masquée
     */
    private fun enableKioskMode(
        context: Context,
        dpm: DevicePolicyManager,
        adminComponent: ComponentName
    ) {
        if (!dpm.isDeviceOwnerApp(context.packageName)) return

        try {
            // Autoriser notre package en Lock Task Mode
            dpm.setLockTaskPackages(adminComponent, arrayOf(context.packageName))
            Log.i(TAG, "🔒 Kiosk mode configuré pour: ${context.packageName}")
        } catch (e: SecurityException) {
            Log.e(TAG, "❌ Erreur activation kiosk mode: ${e.message}", e)
        }
    }
}
