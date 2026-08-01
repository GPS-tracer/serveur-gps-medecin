package com.gpstracker.agent

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * AutostartHelpActivity — Guide de configuration du démarrage automatique.
 *
 * Détecte automatiquement la marque du téléphone (Build.MANUFACTURER) et
 * affiche les instructions précises pour cette marque.
 *
 * Marques supportées :
 *  - Xiaomi / Redmi / POCO (MIUI)
 *  - Huawei / Honor (EMUI / MagicUI)
 *  - Oppo / Realme (ColorOS)
 *  - Vivo (FuntouchOS)
 *  - Samsung (One UI)
 *  - Générique — pour toutes les autres marques
 *
 * Accessible depuis MainActivity quand le tracking est actif,
 * via le bouton "Guide de démarrage automatique".
 */
class AutostartHelpActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "AutostartHelp"
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Vues
    // ─────────────────────────────────────────────────────────────────────────

    private lateinit var tvMarque:               TextView
    private lateinit var tvIntro:                TextView

    // Blocs d'instructions par marque
    private lateinit var layoutXiaomi:           LinearLayout
    private lateinit var layoutHuawei:           LinearLayout
    private lateinit var layoutOppo:             LinearLayout
    private lateinit var layoutVivo:             LinearLayout
    private lateinit var layoutSamsung:          LinearLayout
    private lateinit var layoutGenerique:        LinearLayout

    // Bouton raccourci vers les paramètres de l'app
    private lateinit var btnOuvrirParametres:    Button
    private lateinit var btnFermer:              Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_autostart_help)

        bindViews()
        afficherInstructionsMarque()
        setupBoutons()
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Binding des vues
    // ─────────────────────────────────────────────────────────────────────────

    private fun bindViews() {
        tvMarque              = findViewById(R.id.tvMarque)
        tvIntro               = findViewById(R.id.tvIntro)

        layoutXiaomi          = findViewById(R.id.layoutXiaomi)
        layoutHuawei          = findViewById(R.id.layoutHuawei)
        layoutOppo            = findViewById(R.id.layoutOppo)
        layoutVivo            = findViewById(R.id.layoutVivo)
        layoutSamsung         = findViewById(R.id.layoutSamsung)
        layoutGenerique       = findViewById(R.id.layoutGenerique)

        btnOuvrirParametres   = findViewById(R.id.btnOuvrirParametres)
        btnFermer             = findViewById(R.id.btnFermer)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Détection de la marque et affichage des instructions
    // ─────────────────────────────────────────────────────────────────────────

    private fun afficherInstructionsMarque() {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val model        = Build.MODEL.lowercase()

        Log.i(TAG, "📱 Détection marque: manufacturer=$manufacturer, model=$model")

        // Masquer tous les blocs d'abord
        listOf(layoutXiaomi, layoutHuawei, layoutOppo, layoutVivo, layoutSamsung, layoutGenerique)
            .forEach { it.visibility = View.GONE }

        when {
            // ── Xiaomi / Redmi / POCO ──────────────────────────────────────
            manufacturer.contains("xiaomi") ||
            manufacturer.contains("redmi")  ||
            model.contains("redmi")         ||
            model.contains("poco") -> {
                tvMarque.text = "📱 Xiaomi / Redmi / POCO (MIUI)"
                layoutXiaomi.visibility = View.VISIBLE
                Log.d(TAG, "Marque détectée : Xiaomi/Redmi/POCO")
            }

            // ── Huawei / Honor ─────────────────────────────────────────────
            manufacturer.contains("huawei") ||
            manufacturer.contains("honor") -> {
                tvMarque.text = "📱 Huawei / Honor (EMUI / MagicUI)"
                layoutHuawei.visibility = View.VISIBLE
                Log.d(TAG, "Marque détectée : Huawei/Honor")
            }

            // ── Oppo / Realme ──────────────────────────────────────────────
            manufacturer.contains("oppo")   ||
            manufacturer.contains("realme") ||
            model.contains("realme") -> {
                tvMarque.text = "📱 Oppo / Realme (ColorOS)"
                layoutOppo.visibility = View.VISIBLE
                Log.d(TAG, "Marque détectée : Oppo/Realme")
            }

            // ── Vivo ───────────────────────────────────────────────────────
            manufacturer.contains("vivo") -> {
                tvMarque.text = "📱 Vivo (FuntouchOS)"
                layoutVivo.visibility = View.VISIBLE
                Log.d(TAG, "Marque détectée : Vivo")
            }

            // ── Samsung ────────────────────────────────────────────────────
            manufacturer.contains("samsung") -> {
                tvMarque.text = "📱 Samsung (One UI)"
                layoutSamsung.visibility = View.VISIBLE
                Log.d(TAG, "Marque détectée : Samsung")
            }

            // ── Générique (autres marques) ─────────────────────────────────
            else -> {
                val label = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
                tvMarque.text = "📱 $label"
                layoutGenerique.visibility = View.VISIBLE
                Log.d(TAG, "Marque non reconnue : $manufacturer — affichage guide générique")
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Boutons
    // ─────────────────────────────────────────────────────────────────────────

    private fun setupBoutons() {
        // Ouvre directement les paramètres de l'application GPS Tracker
        btnOuvrirParametres.setOnClickListener {
            Log.d(TAG, "Ouverture des paramètres de l'app")
            try {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Impossible d'ouvrir les paramètres : ${e.message}")
            }
        }

        // Ferme cet écran et retourne à MainActivity
        btnFermer.setOnClickListener {
            Log.d(TAG, "Fermeture de l'écran d'aide autostart")
            finish()
        }
    }
}
