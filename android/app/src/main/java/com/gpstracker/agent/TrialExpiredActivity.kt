package com.gpstracker.agent

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * TrialExpiredActivity — Popup d'expiration de la période d'essai.
 *
 * Affiché quand les 30 jours d'essai sont dépassés pour un compte Particulier.
 *
 * Deux choix :
 *  1. "Payer et continuer" → redirige vers le paiement (Chariow / Mobile Money)
 *  2. "Continuer gratuitement" → active la version gratuite limitée et démarre le tracking
 *
 * onResume() — vérifie si le paiement a été effectué pendant que l'utilisateur
 * était sur Chariow. Si oui, démarre MainActivity directement sans interaction.
 *
 * Cette Activity est non-annulable (pas de bouton retour) pour forcer le choix.
 */
class TrialExpiredActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var trialManager: TrialManager

    private lateinit var btnPayer:      Button
    private lateinit var btnGratuit:    Button
    private lateinit var progressBar:   ProgressBar
    private lateinit var tvPlanGratuit: TextView

    // Flag pour éviter de lancer plusieurs vérifications en parallèle
    private var verificationEnCours = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_trial_expired)

        prefs        = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        trialManager = TrialManager(this)

        btnPayer      = findViewById(R.id.btnPayer)
        btnGratuit    = findViewById(R.id.btnGratuit)
        progressBar   = findViewById(R.id.progressBar)
        tvPlanGratuit = findViewById(R.id.tvPlanGratuit)

        btnPayer.setOnClickListener   { onPayerClicked() }
        btnGratuit.setOnClickListener { onGratuitClicked() }
    }

    // ─────────────────────────────────────────────────────────
    // onResume — vérifier si le paiement a été effectué
    // ─────────────────────────────────────────────────────────

    /**
     * Appelé à chaque retour dans l'app (depuis Chariow ou depuis l'arrière-plan).
     * Si le statut Firebase est passé à PREMIUM, on démarre MainActivity directement.
     */
    override fun onResume() {
        super.onResume()

        if (verificationEnCours) return
        val uid = prefs.getString("uid", null) ?: return

        verificationEnCours = true
        setLoading(true)

        trialManager.syncFromFirebase(uid) { status ->
            runOnUiThread {
                verificationEnCours = false
                setLoading(false)

                when (status) {
                    TrialManager.TrialStatus.PREMIUM -> {
                        // Paiement confirmé — démarrer l'app
                        android.widget.Toast.makeText(
                            this,
                            "✅ Paiement confirmé ! Bienvenue en Premium.",
                            android.widget.Toast.LENGTH_LONG
                        ).show()
                        goToMain()
                    }
                    TrialManager.TrialStatus.FREE_LIMITED -> {
                        // L'utilisateur a déjà choisi la version gratuite
                        goToMain()
                    }
                    else -> {
                        // Trial toujours expiré — rester sur cet écran
                    }
                }
            }
        }
    }

    // ── Bouton "Payer et continuer" ───────────────────────────
    private fun onPayerClicked() {
        // Ouvrir le lien de paiement Chariow dans le navigateur
        val uri = android.net.Uri.parse("https://chariow.com")
        val intent = Intent(Intent.ACTION_VIEW, uri)
        startActivity(intent)
        // onResume() sera appelé automatiquement au retour
        // et détectera si le paiement a été confirmé
    }

    // ── Bouton "Continuer gratuitement" ──────────────────────
    private fun onGratuitClicked() {
        setLoading(true)

        val uid = prefs.getString("uid", null)
        if (uid.isNullOrEmpty()) {
            trialManager.activerVersionGratuite("")
            goToMain()
            return
        }

        trialManager.activerVersionGratuite(uid)

        btnGratuit.postDelayed({
            setLoading(false)
            goToMain()
        }, 800)
    }

    private fun setLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        btnPayer.isEnabled     = !loading
        btnGratuit.isEnabled   = !loading
    }

    private fun goToMain() {
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        startActivity(intent)
        finish()
    }

    // Empêcher le retour arrière — l'utilisateur DOIT faire un choix
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Ne rien faire — forcer le choix
    }
}
