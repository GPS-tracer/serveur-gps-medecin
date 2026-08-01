package com.gpstracker.agent

import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * AutostartGuideActivity — Guide d'optimisation batterie par marque.
 *
 * Affiché depuis MainActivity quand l'agent est actif.
 * Explique comment autoriser le démarrage automatique de l'app
 * sur les ROM agressives (Xiaomi MIUI, Huawei EMUI, Oppo ColorOS,
 * Vivo FuntouchOS, Samsung One UI).
 *
 * Chaque carte est cliquable pour afficher/masquer le détail
 * des étapes (expand/collapse).
 */
class AutostartGuideActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "AutostartGuide"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_autostart_guide)

        supportActionBar?.apply {
            title = "📱 Guide démarrage automatique"
            setDisplayHomeAsUpEnabled(true)
        }

        setupExpandableCards()
    }

    // ─────────────────────────────────────────────────────────────
    // Gestion expand/collapse des cartes par marque
    // ─────────────────────────────────────────────────────────────

    private fun setupExpandableCards() {
        setupCard(R.id.cardHeaderXiaomi,  R.id.cardBodyXiaomi)
        setupCard(R.id.cardHeaderHuawei,  R.id.cardBodyHuawei)
        setupCard(R.id.cardHeaderOppo,    R.id.cardBodyOppo)
        setupCard(R.id.cardHeaderVivo,    R.id.cardBodyVivo)
        setupCard(R.id.cardHeaderSamsung, R.id.cardBodySamsung)
    }

    /**
     * Associe un header cliquable à son body (expand/collapse).
     * Au tap : bascule la visibilité du body et met à jour l'indicateur ▶ / ▼.
     */
    private fun setupCard(headerId: Int, bodyId: Int) {
        val header = findViewById<LinearLayout>(headerId)
        val body   = findViewById<LinearLayout>(bodyId)
        val arrow  = header.findViewWithTag<TextView>("arrow")

        header.setOnClickListener {
            if (body.visibility == View.GONE) {
                body.visibility = View.VISIBLE
                arrow?.text = "▼"
            } else {
                body.visibility = View.GONE
                arrow?.text = "▶"
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Navigation retour
    // ─────────────────────────────────────────────────────────────

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }
}
