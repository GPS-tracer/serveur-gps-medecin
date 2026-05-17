package com.gpstracker.agent

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.google.firebase.database.FirebaseDatabase

/**
 * TrialManager — Gestionnaire de la période d'essai pour les comptes Particulier.
 *
 * Logique :
 *  - À la création du compte, date_inscription est enregistrée dans Firebase
 *    sous utilisateurs_particuliers/{uid}/date_inscription (timestamp ms).
 *  - À chaque démarrage, on calcule les jours écoulés depuis date_inscription.
 *  - Pendant 30 jours → TRIAL_ACTIVE  (accès complet)
 *  - Après 30 jours  → TRIAL_EXPIRED (popup + choix payer / version gratuite)
 *  - Si l'utilisateur a payé → PREMIUM
 *  - Si l'utilisateur a choisi la version gratuite → FREE_LIMITED
 *
 * Restrictions version gratuite :
 *  - Historique limité à 24h (au lieu de 30 jours)
 *  - Intervalle GPS x3 (économie batterie / bande passante)
 *  - Pas d'export de rapports
 */
class TrialManager(private val context: Context) {

    companion object {
        private const val TAG = "TrialManager"

        const val TRIAL_DURATION_DAYS = 30L

        // Clés SharedPreferences
        const val KEY_DATE_INSCRIPTION  = "date_inscription"
        const val KEY_SUBSCRIPTION_TYPE = "subscription_type"

        // Types d'abonnement
        const val TYPE_TRIAL         = "trial"         // essai en cours
        const val TYPE_PREMIUM       = "premium"       // payé
        const val TYPE_FREE_LIMITED  = "free_limited"  // gratuit limité
        const val TYPE_ENTERPRISE    = "entreprise"    // compte entreprise (pas de trial)

        // Restrictions version gratuite
        const val FREE_HISTORY_HOURS        = 24      // heures d'historique
        const val FREE_GPS_INTERVAL_FACTOR  = 3       // multiplicateur intervalle GPS
        const val FREE_MAX_HISTORY_POINTS   = 100     // points max dans l'historique

        private const val PREFS_NAME = "gps_tracker"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val db = FirebaseDatabase.getInstance().reference

    // ─────────────────────────────────────────────────────────
    // État du trial
    // ─────────────────────────────────────────────────────────

    enum class TrialStatus {
        TRIAL_ACTIVE,    // Essai en cours (< 30 jours)
        TRIAL_EXPIRED,   // Essai expiré, choix non encore fait
        PREMIUM,         // Abonnement payé
        FREE_LIMITED,    // Version gratuite limitée
        ENTERPRISE,      // Compte entreprise (pas de restriction trial)
        NOT_APPLICABLE   // Pas un compte particulier
    }

    /**
     * Calcule le statut actuel de l'abonnement.
     * À appeler au démarrage de l'app.
     */
    fun getTrialStatus(): TrialStatus {
        val accountType = prefs.getString("account_type", null)

        // Les comptes entreprise ne sont pas soumis au trial
        if (accountType == "entreprise") return TrialStatus.ENTERPRISE
        if (accountType == null)         return TrialStatus.NOT_APPLICABLE

        val subscriptionType = prefs.getString(KEY_SUBSCRIPTION_TYPE, TYPE_TRIAL)

        return when (subscriptionType) {
            TYPE_PREMIUM      -> TrialStatus.PREMIUM
            TYPE_FREE_LIMITED -> TrialStatus.FREE_LIMITED
            else -> {
                // Vérifier si le trial est encore valide
                val dateInscription = prefs.getLong(KEY_DATE_INSCRIPTION, 0L)
                if (dateInscription == 0L) {
                    // Date non trouvée localement → considérer comme trial actif
                    // (sera corrigé par la synchro Firebase)
                    Log.w(TAG, "date_inscription non trouvée localement")
                    return TrialStatus.TRIAL_ACTIVE
                }

                val joursEcoules = getJoursEcoules(dateInscription)
                Log.d(TAG, "Jours écoulés depuis inscription: $joursEcoules / $TRIAL_DURATION_DAYS")

                if (joursEcoules <= TRIAL_DURATION_DAYS) {
                    TrialStatus.TRIAL_ACTIVE
                } else {
                    TrialStatus.TRIAL_EXPIRED
                }
            }
        }
    }

    /**
     * Retourne le nombre de jours restants dans le trial.
     * Retourne 0 si expiré.
     */
    fun getJoursRestants(): Long {
        val dateInscription = prefs.getLong(KEY_DATE_INSCRIPTION, 0L)
        if (dateInscription == 0L) return TRIAL_DURATION_DAYS
        val joursEcoules = getJoursEcoules(dateInscription)
        return maxOf(0L, TRIAL_DURATION_DAYS - joursEcoules)
    }

    /**
     * Retourne le pourcentage du trial consommé (0–100).
     */
    fun getTrialProgressPercent(): Int {
        val joursRestants = getJoursRestants()
        return ((TRIAL_DURATION_DAYS - joursRestants) * 100 / TRIAL_DURATION_DAYS).toInt()
    }

    // ─────────────────────────────────────────────────────────
    // Actions utilisateur
    // ─────────────────────────────────────────────────────────

    /**
     * L'utilisateur a choisi la version gratuite limitée.
     * Persiste localement et dans Firebase.
     */
    fun activerVersionGratuite(uid: String) {
        prefs.edit().putString(KEY_SUBSCRIPTION_TYPE, TYPE_FREE_LIMITED).apply()

        db.child("utilisateurs_particuliers/$uid/subscription").setValue(
            mapOf(
                "type"        to TYPE_FREE_LIMITED,
                "activatedAt" to System.currentTimeMillis()
            )
        ).addOnSuccessListener {
            Log.i(TAG, "✅ Version gratuite activée pour $uid")
        }
    }

    /**
     * L'utilisateur a payé (appelé après confirmation de paiement).
     * Persiste localement et dans Firebase.
     */
    fun activerPremium(uid: String) {
        prefs.edit().putString(KEY_SUBSCRIPTION_TYPE, TYPE_PREMIUM).apply()

        db.child("utilisateurs_particuliers/$uid/subscription").setValue(
            mapOf(
                "type"        to TYPE_PREMIUM,
                "activatedAt" to System.currentTimeMillis()
            )
        ).addOnSuccessListener {
            Log.i(TAG, "✅ Premium activé pour $uid")
        }
    }

    /**
     * Enregistre la date d'inscription au moment de la création du compte.
     * Appelé une seule fois depuis OnboardingActivity.
     */
    fun enregistrerDateInscription(uid: String) {
        val now = System.currentTimeMillis()
        prefs.edit().apply {
            putLong(KEY_DATE_INSCRIPTION, now)
            putString(KEY_SUBSCRIPTION_TYPE, TYPE_TRIAL)
            apply()
        }

        // Persister dans Firebase
        db.child("utilisateurs_particuliers/$uid").updateChildren(
            mapOf(
                "date_inscription"  to now,
                "subscription_type" to TYPE_TRIAL,
                "trial_expires_at"  to (now + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000L)
            )
        ).addOnSuccessListener {
            Log.i(TAG, "✅ Date inscription enregistrée: $now (expire dans $TRIAL_DURATION_DAYS jours)")
        }.addOnFailureListener { e ->
            Log.e(TAG, "Erreur enregistrement date inscription: ${e.message}")
        }
    }

    /**
     * Synchronise le statut d'abonnement depuis Firebase.
     * À appeler au démarrage pour s'assurer que les données locales sont à jour.
     */
    fun syncFromFirebase(uid: String, onComplete: (TrialStatus) -> Unit) {
        db.child("utilisateurs_particuliers/$uid").get()
            .addOnSuccessListener { snapshot ->
                if (!snapshot.exists()) {
                    onComplete(getTrialStatus())
                    return@addOnSuccessListener
                }

                // Récupérer date_inscription depuis Firebase (source de vérité)
                val dateInscription = snapshot.child("date_inscription").getValue(Long::class.java)
                val subscriptionType = snapshot.child("subscription_type").getValue(String::class.java)
                    ?: snapshot.child("subscription/type").getValue(String::class.java)

                if (dateInscription != null) {
                    prefs.edit().putLong(KEY_DATE_INSCRIPTION, dateInscription).apply()
                }
                if (subscriptionType != null) {
                    prefs.edit().putString(KEY_SUBSCRIPTION_TYPE, subscriptionType).apply()
                }

                val status = getTrialStatus()
                Log.d(TAG, "Sync Firebase → status=$status, subscriptionType=$subscriptionType")
                onComplete(status)
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Erreur sync Firebase: ${e.message}")
                // En cas d'erreur réseau, utiliser les données locales
                onComplete(getTrialStatus())
            }
    }

    // ─────────────────────────────────────────────────────────
    // Restrictions version gratuite
    // ─────────────────────────────────────────────────────────

    /**
     * Retourne l'intervalle GPS effectif selon le plan.
     * Version gratuite → intervalle x3
     */
    fun getGpsIntervalFactor(): Int {
        return when (getTrialStatus()) {
            TrialStatus.FREE_LIMITED -> FREE_GPS_INTERVAL_FACTOR
            else                     -> 1
        }
    }

    /**
     * Retourne le nombre max de points d'historique selon le plan.
     */
    fun getMaxHistoryPoints(): Int {
        return when (getTrialStatus()) {
            TrialStatus.FREE_LIMITED -> FREE_MAX_HISTORY_POINTS
            else                     -> 1000
        }
    }

    /**
     * Retourne la durée max de l'historique en heures selon le plan.
     */
    fun getHistoryMaxHours(): Int {
        return when (getTrialStatus()) {
            TrialStatus.FREE_LIMITED -> FREE_HISTORY_HOURS
            else                     -> 24 * 30 // 30 jours
        }
    }

    /**
     * Vérifie si l'export de rapports est autorisé.
     */
    fun canExportReports(): Boolean {
        return when (getTrialStatus()) {
            TrialStatus.FREE_LIMITED -> false
            else                     -> true
        }
    }

    /**
     * Retourne un label lisible du plan actuel.
     */
    fun getPlanLabel(): String {
        return when (getTrialStatus()) {
            TrialStatus.TRIAL_ACTIVE  -> "🟢 Essai gratuit (${getJoursRestants()} jours restants)"
            TrialStatus.TRIAL_EXPIRED -> "🔴 Essai expiré"
            TrialStatus.PREMIUM       -> "⭐ Premium"
            TrialStatus.FREE_LIMITED  -> "🆓 Version gratuite limitée"
            TrialStatus.ENTERPRISE    -> "🏢 Compte entreprise"
            TrialStatus.NOT_APPLICABLE -> ""
        }
    }

    // ─────────────────────────────────────────────────────────
    // Helpers privés
    // ─────────────────────────────────────────────────────────

    private fun getJoursEcoules(dateInscription: Long): Long {
        val maintenant = System.currentTimeMillis()
        val diffMs     = maintenant - dateInscription
        return diffMs / (1000L * 60 * 60 * 24)
    }
}
