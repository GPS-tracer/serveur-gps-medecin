package com.gpstracker.agent

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity

/**
 * SplashActivity — Premier écran affiché au lancement.
 *
 * Affiche le logo GPS Tracker pendant 1.5 secondes, puis :
 *  - Pour les comptes Particulier : vérifie le statut du trial via TrialManager.
 *    Si expiré → TrialExpiredActivity (choix payer / version gratuite).
 *    Sinon    → MainActivity.
 *  - Pour tous les autres types (entreprise, étudiant, élève, non configuré)
 *    → MainActivity directement.
 */
class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        Handler(Looper.getMainLooper()).postDelayed({
            verifierTrialEtRediriger()
        }, 1500)
    }

    private fun verifierTrialEtRediriger() {
        val prefs       = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        val accountType = prefs.getString("account_type", null)

        // Seuls les comptes particulier sont soumis au trial
        if (accountType != "particulier") {
            goTo(MainActivity::class.java)
            return
        }

        // Vérifier d'abord localement (rapide), puis sync Firebase en arrière-plan
        val trialManager = TrialManager(this)
        val statusLocal  = trialManager.getTrialStatus()

        if (statusLocal == TrialManager.TrialStatus.TRIAL_EXPIRED) {
            // Expiré localement → afficher le popup immédiatement
            goTo(TrialExpiredActivity::class.java)
            return
        }

        // Trial potentiellement actif → sync Firebase pour confirmer
        val uid = prefs.getString("uid", null)
        if (uid.isNullOrEmpty()) {
            // Pas d'UID → compte pas encore configuré, laisser passer
            goTo(MainActivity::class.java)
            return
        }

        trialManager.syncFromFirebase(uid) { statusFirebase ->
            runOnUiThread {
                if (statusFirebase == TrialManager.TrialStatus.TRIAL_EXPIRED) {
                    goTo(TrialExpiredActivity::class.java)
                } else {
                    goTo(MainActivity::class.java)
                }
            }
        }
    }

    private fun goTo(destination: Class<*>) {
        startActivity(Intent(this, destination))
        finish()
    }
}

