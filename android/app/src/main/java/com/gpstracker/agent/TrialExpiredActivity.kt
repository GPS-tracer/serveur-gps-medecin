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
 * Cette Activity est non-annulable (pas de bouton retour) pour forcer le choix.
 */
class TrialExpiredActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var trialManager: TrialManager

    private lateinit var btnPayer:      Button
    private lateinit var btnGratuit:    Button
    private lateinit var progressBar:   ProgressBar
    private lateinit var tvPlanGratuit: TextView

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

    // ── Bouton "Payer et continuer" ───────────────────────────
    private fun onPayerClicked() {
        // Ouvrir le lien de paiement Chariow dans le navigateur
        val uri = android.net.Uri.parse("https://chariow.com")
        val intent = Intent(Intent.ACTION_VIEW, uri)
        startActivity(intent)

        // Note : la vérification du paiement se fera via Firebase
        // (le backend met à jour subscription_type = "premium" après confirmation)
        // L'app détectera le changement au prochain démarrage via syncFromFirebase()
    }

    // ── Bouton "Continuer gratuitement" ──────────────────────
    private fun onGratuitClicked() {
        setLoading(true)

        val uid = prefs.getString("uid", null)
        if (uid.isNullOrEmpty()) {
            // Fallback : activer localement sans Firebase
            trialManager.activerVersionGratuite("")
            goToMain()
            return
        }

        trialManager.activerVersionGratuite(uid)

        // Petit délai pour laisser Firebase écrire
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
