package com.gpstracker.agent

import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.ktx.auth
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.ktx.Firebase

/**
 * Écran d'accueil — Premier lancement de l'application.
 *
 * Quatre parcours :
 *
 * A) ENTREPRISE / INSTITUTION
 *    L'agent saisit un "Code Entreprise" (= companyId Firebase).
 *    Vérifie companies/{code} → associe le téléphone → status "pending".
 *
 * B) PARTICULIER
 *    Crée un compte Firebase Auth individuel → particuliers/{uid}.
 *
 * C) ÉTUDIANT
 *    Saisit un code parent/établissement → lié sous
 *    companies/{parentId}/eleves_lies/{deviceId}.
 *    type_compte = "etudiant"
 *
 * D) ÉLÈVE (primaire / secondaire)
 *    Saisit un code parent → lié sous
 *    companies/{parentId}/eleves_lies/{deviceId}.
 *    type_compte = "eleve"
 */
class OnboardingActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "OnboardingActivity"
        private const val APP_VERSION = "1.0.0"
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var deviceId: String
    private val db   = FirebaseDatabase.getInstance().reference
    private val auth: FirebaseAuth by lazy { Firebase.auth }

    // ── Vues principales ──────────────────────────────────────
    private lateinit var layoutChoix:        LinearLayout
    private lateinit var layoutEntreprise:   LinearLayout
    private lateinit var layoutParticulier:  LinearLayout
    private lateinit var layoutEtudiant:     LinearLayout
    private lateinit var layoutEleve:        LinearLayout
    private lateinit var progressBar:        ProgressBar
    private lateinit var tvError:            TextView

    // ── Entreprise ────────────────────────────────────────────
    private lateinit var etCodeEntreprise:    TextInputEditText
    private lateinit var tilCodeEntreprise:   TextInputLayout
    private lateinit var etNomAgent:          TextInputEditText
    private lateinit var etPhoneAgent:        TextInputEditText
    private lateinit var btnValiderCode:      Button
    private lateinit var btnRetourEntreprise: Button

    // ── Particulier ───────────────────────────────────────────
    private lateinit var etNomParticulier:     TextInputEditText
    private lateinit var etEmailParticulier:   TextInputEditText
    private lateinit var etMdpParticulier:     TextInputEditText
    private lateinit var btnCreerCompte:       Button
    private lateinit var btnRetourParticulier: Button

    // ── Étudiant ──────────────────────────────────────────────
    private lateinit var etCodeEtudiant:    TextInputEditText
    private lateinit var tilCodeEtudiant:   TextInputLayout
    private lateinit var etNomEtudiant:     TextInputEditText
    private lateinit var etNumeroEtudiant:  TextInputEditText
    private lateinit var btnValiderEtudiant: Button
    private lateinit var btnRetourEtudiant: Button

    // ── Élève ─────────────────────────────────────────────────
    private lateinit var etCodeEleve:    TextInputEditText
    private lateinit var tilCodeEleve:   TextInputLayout
    private lateinit var etNomEleve:     TextInputEditText
    private lateinit var etClasseEleve:  TextInputEditText
    private lateinit var btnValiderEleve: Button
    private lateinit var btnRetourEleve: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)

        prefs    = getSharedPreferences("gps_tracker", MODE_PRIVATE)
        deviceId = getOrCreateDeviceId()

        bindViews()
        showChoixScreen()
    }

    // ─────────────────────────────────────────────────────────
    // Binding des vues
    // ─────────────────────────────────────────────────────────
    private fun bindViews() {
        layoutChoix        = findViewById(R.id.layoutChoix)
        layoutEntreprise   = findViewById(R.id.layoutEntreprise)
        layoutParticulier  = findViewById(R.id.layoutParticulier)
        layoutEtudiant     = findViewById(R.id.layoutEtudiant)
        layoutEleve        = findViewById(R.id.layoutEleve)
        progressBar        = findViewById(R.id.progressBar)
        tvError            = findViewById(R.id.tvError)

        // Entreprise
        tilCodeEntreprise   = findViewById(R.id.tilCodeEntreprise)
        etCodeEntreprise    = findViewById(R.id.etCodeEntreprise)
        etNomAgent          = findViewById(R.id.etNomAgent)
        etPhoneAgent        = findViewById(R.id.etPhoneAgent)
        btnValiderCode      = findViewById(R.id.btnValiderCode)
        btnRetourEntreprise = findViewById(R.id.btnRetourEntreprise)

        // Particulier
        etNomParticulier     = findViewById(R.id.etNomParticulier)
        etEmailParticulier   = findViewById(R.id.etEmailParticulier)
        etMdpParticulier     = findViewById(R.id.etMdpParticulier)
        btnCreerCompte       = findViewById(R.id.btnCreerCompte)
        btnRetourParticulier = findViewById(R.id.btnRetourParticulier)

        // Étudiant
        tilCodeEtudiant    = findViewById(R.id.tilCodeEtudiant)
        etCodeEtudiant     = findViewById(R.id.etCodeEtudiant)
        etNomEtudiant      = findViewById(R.id.etNomEtudiant)
        etNumeroEtudiant   = findViewById(R.id.etNumeroEtudiant)
        btnValiderEtudiant = findViewById(R.id.btnValiderEtudiant)
        btnRetourEtudiant  = findViewById(R.id.btnRetourEtudiant)

        // Élève
        tilCodeEleve    = findViewById(R.id.tilCodeEleve)
        etCodeEleve     = findViewById(R.id.etCodeEleve)
        etNomEleve      = findViewById(R.id.etNomEleve)
        etClasseEleve   = findViewById(R.id.etClasseEleve)
        btnValiderEleve = findViewById(R.id.btnValiderEleve)
        btnRetourEleve  = findViewById(R.id.btnRetourEleve)

        // Boutons de choix
        findViewById<Button>(R.id.btnChoixEntreprise).setOnClickListener { showEntrepriseScreen() }
        findViewById<Button>(R.id.btnChoixParticulier).setOnClickListener { showParticulierScreen() }
        findViewById<Button>(R.id.btnChoixEtudiant).setOnClickListener   { showEtudiantScreen() }
        findViewById<Button>(R.id.btnChoixEleve).setOnClickListener      { showEleveScreen() }

        btnRetourEntreprise.setOnClickListener  { showChoixScreen() }
        btnRetourParticulier.setOnClickListener { showChoixScreen() }
        btnRetourEtudiant.setOnClickListener    { showChoixScreen() }
        btnRetourEleve.setOnClickListener       { showChoixScreen() }

        btnValiderCode.setOnClickListener      { onValiderCodeEntreprise() }
        btnCreerCompte.setOnClickListener      { onCreerCompteParticulier() }
        btnValiderEtudiant.setOnClickListener  { onValiderCodeScolaire("etudiant") }
        btnValiderEleve.setOnClickListener     { onValiderCodeScolaire("eleve") }
    }

    // ─────────────────────────────────────────────────────────
    // Navigation entre écrans
    // ─────────────────────────────────────────────────────────
    private fun showChoixScreen() {
        layoutChoix.visibility       = View.VISIBLE
        layoutEntreprise.visibility  = View.GONE
        layoutParticulier.visibility = View.GONE
        layoutEtudiant.visibility    = View.GONE
        layoutEleve.visibility       = View.GONE
        hideError()
    }

    private fun showEntrepriseScreen() {
        layoutChoix.visibility       = View.GONE
        layoutEntreprise.visibility  = View.VISIBLE
        layoutParticulier.visibility = View.GONE
        layoutEtudiant.visibility    = View.GONE
        layoutEleve.visibility       = View.GONE
        hideError()
    }

    private fun showParticulierScreen() {
        layoutChoix.visibility       = View.GONE
        layoutEntreprise.visibility  = View.GONE
        layoutParticulier.visibility = View.VISIBLE
        layoutEtudiant.visibility    = View.GONE
        layoutEleve.visibility       = View.GONE
        hideError()
    }

    private fun showEtudiantScreen() {
        layoutChoix.visibility       = View.GONE
        layoutEntreprise.visibility  = View.GONE
        layoutParticulier.visibility = View.GONE
        layoutEtudiant.visibility    = View.VISIBLE
        layoutEleve.visibility       = View.GONE
        hideError()
    }

    private fun showEleveScreen() {
        layoutChoix.visibility       = View.GONE
        layoutEntreprise.visibility  = View.GONE
        layoutParticulier.visibility = View.GONE
        layoutEtudiant.visibility    = View.GONE
        layoutEleve.visibility       = View.VISIBLE
        hideError()
    }

    // ─────────────────────────────────────────────────────────
    // PARCOURS A : Entreprise / Institution
    // ─────────────────────────────────────────────────────────
    private fun onValiderCodeEntreprise() {
        val code  = etCodeEntreprise.text.toString().trim()
        val name  = etNomAgent.text.toString().trim()
        val phone = etPhoneAgent.text.toString().trim()

        if (code.isEmpty()) { tilCodeEntreprise.error = "Le code entreprise est obligatoire"; return }
        tilCodeEntreprise.error = null
        if (name.isEmpty())  { etNomAgent.error  = "Votre nom est obligatoire"; return }
        if (phone.isEmpty()) { etPhoneAgent.error = "Votre numéro est obligatoire"; return }

        setLoading(true); hideError()

        db.child("companies/$code").get()
            .addOnSuccessListener { snapshot ->
                setLoading(false)
                if (!snapshot.exists()) {
                    showError("Votre compte n'existe pas. Veuillez contacter votre administrateur.")
                    return@addOnSuccessListener
                }

                val companyName = snapshot.child("companyName").getValue(String::class.java) ?: ""
                val sector      = snapshot.child("sector").getValue(String::class.java) ?: ""

                prefs.edit().apply {
                    putString("companyId",    code)
                    putString("companyName",  companyName)
                    putString("sector",       sector)
                    putString("name",         name)
                    putString("phone",        phone)
                    putString("account_type", "entreprise")
                    apply()
                }
                registerAgentPending(name, phone, code, companyName, sector)
            }
            .addOnFailureListener { e ->
                setLoading(false)
                showError("Erreur réseau. Vérifiez votre connexion et réessayez.")
                Log.e(TAG, "Erreur vérification code: ${e.message}", e)
            }
    }

    private fun registerAgentPending(name: String, phone: String, companyId: String, companyName: String, sector: String) {
        setLoading(true)
        val agentData = mapOf(
            "name"           to name,
            "phone"          to phone,
            "deviceId"       to deviceId,
            "deviceModel"    to "${Build.MANUFACTURER} ${Build.MODEL}",
            "androidVersion" to Build.VERSION.RELEASE,
            "sdkVersion"     to Build.VERSION.SDK_INT,
            "appVersion"     to APP_VERSION,
            "companyId"      to companyId,
            "companyName"    to companyName,
            "sector"         to sector,
            "registeredAt"   to System.currentTimeMillis(),
            "status"         to "pending",
            "accountType"    to "entreprise"
        )
        db.child("pending/$deviceId").setValue(agentData)
            .addOnSuccessListener {
                setLoading(false)
                prefs.edit().putString("agent_status", "pending").apply()
                Log.i(TAG, "✅ Agent enregistré: pending/$deviceId")
                goToMain()
            }
            .addOnFailureListener { e ->
                setLoading(false)
                showError("Erreur lors de l'enregistrement. Réessayez.")
                Log.e(TAG, "Erreur enregistrement pending: ${e.message}", e)
            }
    }

    // ─────────────────────────────────────────────────────────
    // PARCOURS B : Particulier
    // ─────────────────────────────────────────────────────────
    private fun onCreerCompteParticulier() {
        val nom   = etNomParticulier.text.toString().trim()
        val email = etEmailParticulier.text.toString().trim()
        val mdp   = etMdpParticulier.text.toString()

        if (nom.isEmpty())   { etNomParticulier.error   = "Votre nom est obligatoire"; return }
        if (email.isEmpty() || !android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            etEmailParticulier.error = "Email invalide"; return
        }
        if (mdp.length < 6) { etMdpParticulier.error = "Minimum 6 caractères"; return }

        setLoading(true); hideError()

        auth.createUserWithEmailAndPassword(email, mdp)
            .addOnSuccessListener { result ->
                val uid = result.user?.uid ?: run { setLoading(false); showError("Erreur création compte."); return@addOnSuccessListener }
                val userData = mapOf(
                    "name"           to nom,
                    "email"          to email,
                    "deviceId"       to deviceId,
                    "deviceModel"    to "${Build.MANUFACTURER} ${Build.MODEL}",
                    "androidVersion" to Build.VERSION.RELEASE,
                    "appVersion"     to APP_VERSION,
                    "createdAt"      to System.currentTimeMillis(),
                    "status"         to "active",
                    "accountType"    to "particulier"
                )
                db.child("particuliers/$uid").setValue(userData)
                    .addOnSuccessListener {
                        setLoading(false)
                        prefs.edit().apply {
                            putString("uid",          uid)
                            putString("name",         nom)
                            putString("email",        email)
                            putString("agent_status", "active")
                            putString("account_type", "particulier")
                            putString("companyId",    uid)
                            apply()
                        }
                        val trialManager = TrialManager(this)
                        trialManager.enregistrerDateInscription(uid)
                        Toast.makeText(this, "Compte créé ! Bienvenue $nom 🎉\n30 jours d'essai gratuit activés.", Toast.LENGTH_LONG).show()
                        goToMain()
                    }
                    .addOnFailureListener { e -> setLoading(false); showError("Erreur enregistrement. Réessayez."); Log.e(TAG, e.message ?: "") }
            }
            .addOnFailureListener { e ->
                setLoading(false)
                val msg = when {
                    e.message?.contains("email-already-in-use") == true -> "Cet email est déjà utilisé."
                    e.message?.contains("weak-password")        == true -> "Mot de passe trop faible (min. 6 caractères)."
                    e.message?.contains("invalid-email")        == true -> "Adresse email invalide."
                    e.message?.contains("network")              == true -> "Erreur réseau. Vérifiez votre connexion."
                    else -> "Erreur : ${e.message}"
                }
                showError(msg)
            }
    }

    // ─────────────────────────────────────────────────────────
    // PARCOURS C & D : Étudiant / Élève
    // Même logique — seul le type_compte diffère.
    // Le code saisi est l'UID du compte parent (dashboard web).
    // ─────────────────────────────────────────────────────────
    private fun onValiderCodeScolaire(typeCompte: String) {
        val isEtudiant = typeCompte == "etudiant"

        val code = if (isEtudiant) etCodeEtudiant.text.toString().trim()
                   else            etCodeEleve.text.toString().trim()
        val nom  = if (isEtudiant) etNomEtudiant.text.toString().trim()
                   else            etNomEleve.text.toString().trim()
        val extra = if (isEtudiant) etNumeroEtudiant.text.toString().trim()
                    else            etClasseEleve.text.toString().trim()

        // Validation
        if (code.isEmpty()) {
            if (isEtudiant) tilCodeEtudiant.error = "Le code est obligatoire"
            else            tilCodeEleve.error    = "Le code parent est obligatoire"
            return
        }
        if (isEtudiant) tilCodeEtudiant.error = null else tilCodeEleve.error = null
        if (nom.isEmpty()) {
            if (isEtudiant) etNomEtudiant.error = "Votre nom est obligatoire"
            else            etNomEleve.error    = "Le nom de l'élève est obligatoire"
            return
        }

        setLoading(true); hideError()

        // Vérifier que le code parent existe dans companies/{code}
        db.child("companies/$code").get()
            .addOnSuccessListener { snapshot ->
                setLoading(false)
                if (!snapshot.exists()) {
                    showError("Code invalide. Demandez à votre parent ou établissement de vous fournir le bon code.")
                    return@addOnSuccessListener
                }

                val parentName = snapshot.child("companyName").getValue(String::class.java) ?: ""

                // Persister localement
                prefs.edit().apply {
                    putString("companyId",    code)       // parentId = companyId
                    putString("companyName",  parentName)
                    putString("name",         nom)
                    putString("account_type", typeCompte)
                    putString("agent_status", "active")
                    if (isEtudiant) putString("numero_etudiant", extra)
                    else            putString("classe", extra)
                    apply()
                }

                // Enregistrer sous companies/{parentId}/eleves_lies/{deviceId}
                val eleveData = mapOf(
                    "nom"            to nom,
                    "typeCompte"     to typeCompte,
                    "deviceId"       to deviceId,
                    "deviceModel"    to "${Build.MANUFACTURER} ${Build.MODEL}",
                    "androidVersion" to Build.VERSION.RELEASE,
                    "appVersion"     to APP_VERSION,
                    "registeredAt"   to System.currentTimeMillis(),
                    "status"         to "active",
                    "extra"          to extra,   // numéro étudiant ou classe
                )

                db.child("companies/$code/eleves_lies/$deviceId").setValue(eleveData)
                    .addOnSuccessListener {
                        Log.i(TAG, "✅ $typeCompte enregistré sous companies/$code/eleves_lies/$deviceId")
                        val label = if (isEtudiant) "étudiant" else "élève"
                        Toast.makeText(this, "Bienvenue $nom ! Votre suivi $label est activé. 🎓", Toast.LENGTH_LONG).show()
                        goToMain()
                    }
                    .addOnFailureListener { e ->
                        showError("Erreur enregistrement. Réessayez.")
                        Log.e(TAG, "Erreur Firebase $typeCompte: ${e.message}", e)
                    }
            }
            .addOnFailureListener { e ->
                setLoading(false)
                showError("Erreur réseau. Vérifiez votre connexion.")
                Log.e(TAG, "Erreur vérification code $typeCompte: ${e.message}", e)
            }
    }

    // ─────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────
    private fun getOrCreateDeviceId(): String {
        var id = prefs.getString("device_id", null)
        if (id.isNullOrEmpty()) {
            id = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            prefs.edit().putString("device_id", id).apply()
        }
        return id!!
    }

    private fun setLoading(loading: Boolean) {
        progressBar.visibility         = if (loading) View.VISIBLE else View.GONE
        btnValiderCode.isEnabled       = !loading
        btnCreerCompte.isEnabled       = !loading
        btnValiderEtudiant.isEnabled   = !loading
        btnValiderEleve.isEnabled      = !loading
        btnRetourEntreprise.isEnabled  = !loading
        btnRetourParticulier.isEnabled = !loading
        btnRetourEtudiant.isEnabled    = !loading
        btnRetourEleve.isEnabled       = !loading
    }

    private fun showError(message: String) {
        tvError.text       = message
        tvError.visibility = View.VISIBLE
    }

    private fun hideError() {
        tvError.text       = ""
        tvError.visibility = View.GONE
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}

