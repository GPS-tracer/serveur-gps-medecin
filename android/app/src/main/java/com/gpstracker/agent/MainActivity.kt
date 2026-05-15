package com.gpstracker.agent

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputEditText
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener

/**
 * Flux d'enregistrement :
 *
 * 1. Au premier lancement, l'agent saisit son nom et téléphone.
 *    L'app génère automatiquement un device_id = ANDROID_ID (unique, sans permission).
 *    Elle s'enregistre dans Firebase sous : pending/{device_id}
 *    avec status = "pending" et les infos du téléphone (modèle, version Android, version app).
 *
 * 2. L'admin voit l'agent dans son dashboard (nœud "pending"),
 *    lui attribue une société, un type de véhicule et un secteur.
 *    Il déplace l'agent vers : societes/{uid_societe}/agents/{device_id}/config
 *    et met status = "active".
 *
 * 3. L'app détecte le passage à "active" via un ValueEventListener sur pending/{device_id}.
 *    Elle persiste le companyId, verrouille l'UI et démarre le tracking automatiquement.
 *
 * 4. À chaque démarrage suivant, si status = "active" et companyId connu,
 *    le tracking démarre directement sans interaction.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val APP_VERSION = "1.0.0"
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var tvStatus: TextView
    private lateinit var tvConfigStatus: TextView
    private lateinit var tvDeviceInfo: TextView
    private lateinit var etName: TextInputEditText
    private lateinit var etPhone: TextInputEditText
    private lateinit var btnRegister: Button
    private lateinit var layoutPending: LinearLayout
    private lateinit var layoutRegistration: LinearLayout

    private val db = FirebaseDatabase.getInstance().reference
    private var pendingListener: ValueEventListener? = null
    private var configListener: ValueEventListener? = null

    // Identifiant unique de l'appareil (ANDROID_ID — stable, sans permission)
    private lateinit var deviceId: String

    private val locationPermissions = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    )

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.all { it }) startTracking()
        else Toast.makeText(this, "Permission GPS requise", Toast.LENGTH_LONG).show()
    }

    private val bgPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { startTracking() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences("gps_tracker", MODE_PRIVATE)

        tvStatus         = findViewById(R.id.tvStatus)
        tvConfigStatus   = findViewById(R.id.tvConfigStatus)
        tvDeviceInfo     = findViewById(R.id.tvDeviceInfo)
        etName           = findViewById(R.id.etName)
        etPhone          = findViewById(R.id.etPhone)
        btnRegister      = findViewById(R.id.btnSave)
        layoutPending    = findViewById(R.id.layoutPending)
        layoutRegistration = findViewById(R.id.layoutRegistration)

        // Récupérer ou générer le device_id (ANDROID_ID)
        deviceId = getOrCreateDeviceId()

        // Afficher les infos de l'appareil
        showDeviceInfo()

        // Décider quel écran afficher selon l'état de l'agent
        when (getAgentStatus()) {
            AgentStatus.ACTIVE  -> onAgentActive()
            AgentStatus.PENDING -> onAgentPending()
            AgentStatus.NEW     -> showRegistrationScreen()
        }

        btnRegister.setOnClickListener { onRegisterClicked() }
    }

    // ─────────────────────────────────────────────────────────────
    // Gestion du device_id
    // ─────────────────────────────────────────────────────────────

    /**
     * Retourne le device_id persisté, ou le génère depuis ANDROID_ID.
     * ANDROID_ID est unique par appareil + par app, stable, sans permission.
     */
    private fun getOrCreateDeviceId(): String {
        var id = prefs.getString("device_id", null)
        if (id.isNullOrEmpty()) {
            id = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
            prefs.edit().putString("device_id", id).apply()
            Log.i(TAG, "📱 Nouveau device_id généré: $id")
        }
        return id!!
    }

    /**
     * Affiche le modèle, la version Android et la version app dans l'UI.
     */
    private fun showDeviceInfo() {
        val model   = "${Build.MANUFACTURER} ${Build.MODEL}"
        val android = "Android ${Build.VERSION.RELEASE}"
        val app     = "App v$APP_VERSION"
        tvDeviceInfo.text = "$model • $android • $app"
        Log.d(TAG, "📱 Device: $model | $android | ID: $deviceId")
    }

    // ─────────────────────────────────────────────────────────────
    // États de l'agent
    // ─────────────────────────────────────────────────────────────

    private enum class AgentStatus { NEW, PENDING, ACTIVE }

    private fun getAgentStatus(): AgentStatus {
        val status    = prefs.getString("agent_status", null)
        val companyId = prefs.getString("companyId", null)
        return when {
            status == "active" && !companyId.isNullOrEmpty() -> AgentStatus.ACTIVE
            status == "pending"                              -> AgentStatus.PENDING
            else                                             -> AgentStatus.NEW
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Écran 1 : Enregistrement (premier lancement)
    // ─────────────────────────────────────────────────────────────

    private fun showRegistrationScreen() {
        layoutRegistration.visibility = View.VISIBLE
        layoutPending.visibility      = View.GONE

        // Pré-remplir si données déjà saisies
        etName.setText(prefs.getString("name", ""))
        etPhone.setText(prefs.getString("phone", ""))

        tvConfigStatus.text = "📋 Enregistrez-vous pour commencer"
        tvConfigStatus.visibility = View.VISIBLE
        tvStatus.text = "⏸ Non enregistré"

        Log.d(TAG, "📋 Écran d'enregistrement affiché")
    }

    private fun onRegisterClicked() {
        val name  = etName.text.toString().trim()
        val phone = etPhone.text.toString().trim()

        if (name.isEmpty()) {
            etName.error = "Requis"
            return
        }
        if (phone.isEmpty()) {
            etPhone.error = "Requis"
            return
        }

        // Sauvegarder localement
        prefs.edit()
            .putString("name",  name)
            .putString("phone", phone)
            .apply()

        // Enregistrer dans Firebase sous pending/{device_id}
        registerAgentInFirebase(name, phone)
    }

    /**
     * Crée l'entrée de l'agent dans Firebase sous le nœud "pending".
     * L'admin verra cet agent dans son dashboard et pourra lui attribuer une société.
     *
     * Chemin: pending/{device_id}
     */
    private fun registerAgentInFirebase(name: String, phone: String) {
        btnRegister.isEnabled = false
        btnRegister.text = "Enregistrement..."

        val model        = "${Build.MANUFACTURER} ${Build.MODEL}"
        val androidVer   = Build.VERSION.RELEASE
        val sdkInt       = Build.VERSION.SDK_INT
        val ts           = System.currentTimeMillis()

        val agentData = mapOf(
            "name"           to name,
            "phone"          to phone,
            "deviceId"       to deviceId,
            "deviceModel"    to model,
            "androidVersion" to androidVer,
            "sdkVersion"     to sdkInt,
            "appVersion"     to APP_VERSION,
            "registeredAt"   to ts,
            "status"         to "pending"
        )

        db.child("pending/$deviceId").setValue(agentData)
            .addOnSuccessListener {
                Log.i(TAG, "✅ Agent enregistré dans Firebase: pending/$deviceId")
                prefs.edit().putString("agent_status", "pending").apply()

                // Passer à l'écran d'attente et écouter l'activation par l'admin
                onAgentPending()
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ Erreur enregistrement: ${e.message}", e)
                btnRegister.isEnabled = true
                btnRegister.text = "S'enregistrer"
                Toast.makeText(this, "Erreur réseau, réessayez", Toast.LENGTH_LONG).show()
            }
    }

    // ─────────────────────────────────────────────────────────────
    // Écran 2 : En attente d'activation par l'admin
    // ─────────────────────────────────────────────────────────────

    private fun onAgentPending() {
        layoutRegistration.visibility = View.GONE
        layoutPending.visibility      = View.VISIBLE

        tvStatus.text = "⏳ En attente d'activation"
        tvConfigStatus.text = "🔔 Votre compte est en cours de validation par l'administrateur"
        tvConfigStatus.visibility = View.VISIBLE

        Log.d(TAG, "⏳ Écran d'attente affiché, écoute activation admin...")

        // Écouter le nœud pending/{device_id} pour détecter l'activation
        listenForActivation()
    }

    /**
     * Écoute pending/{device_id} en temps réel.
     * Quand l'admin attribue une société et met status = "active",
     * l'app récupère le companyId et démarre le tracking automatiquement.
     */
    private fun listenForActivation() {
        pendingListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (!snapshot.exists()) return

                val status    = snapshot.child("status").getValue(String::class.java)
                val companyId = snapshot.child("companyId").getValue(String::class.java)

                Log.d(TAG, "📡 pending/$deviceId → status=$status, companyId=$companyId")

                if (status == "active" && !companyId.isNullOrEmpty()) {
                    // L'admin a activé l'agent → persister et démarrer
                    prefs.edit()
                        .putString("agent_status", "active")
                        .putString("companyId",    companyId)
                        .apply()

                    Log.i(TAG, "🎉 Agent activé par l'admin! companyId=$companyId")
                    onAgentActive()
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Erreur listener activation: ${error.message}")
            }
        }

        db.child("pending/$deviceId").addValueEventListener(pendingListener!!)
    }

    // ─────────────────────────────────────────────────────────────
    // Écran 3 : Agent actif — tracking + intégrité config
    // ─────────────────────────────────────────────────────────────

    private fun onAgentActive() {
        layoutRegistration.visibility = View.GONE
        layoutPending.visibility      = View.GONE

        tvStatus.text = "✅ Tracking actif"
        tvConfigStatus.text = "🔒 Configuration gérée par l'administrateur"
        tvConfigStatus.visibility = View.VISIBLE

        // Détacher le listener pending si encore actif
        pendingListener?.let {
            db.child("pending/$deviceId").removeEventListener(it)
            pendingListener = null
        }

        // Attacher le listener d'intégrité sur la config
        val societeId = prefs.getString("companyId", null)
        if (!societeId.isNullOrEmpty()) {
            attachIntegrityListener(deviceId, societeId)
        }

        // Démarrer le tracking GPS
        checkPermissionsAndStart()
    }

    // ─────────────────────────────────────────────────────────────
    // Vérification d'intégrité config (Device Owner)
    // ─────────────────────────────────────────────────────────────

    /**
     * Attache un ValueEventListener permanent sur societes/{uid}/agents/{id}/config.
     * Vérifie name, phone, vehicleType ET sector à chaque changement distant.
     */
    private fun attachIntegrityListener(deviceId: String, societeId: String) {
        Log.d(TAG, "🔍 Listener intégrité: societes/$societeId/agents/$deviceId/config")

        configListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (!snapshot.exists()) {
                    Log.w(TAG, "Config introuvable: societes/$societeId/agents/$deviceId/config")
                    return
                }

                val firebaseName        = snapshot.child("name").getValue(String::class.java)
                val firebasePhone       = snapshot.child("phone").getValue(String::class.java)
                val firebaseVehicleType = snapshot.child("vehicleType").getValue(String::class.java)
                val firebaseSector      = snapshot.child("sector").getValue(String::class.java)

                val localName        = prefs.getString("name", "")
                val localPhone       = prefs.getString("phone", "")
                val localVehicleType = prefs.getString("vehicleType", "")
                val localSector      = prefs.getString("sector", "")

                val violations = mutableListOf<String>()
                if (firebaseName        != null && firebaseName        != localName)        violations.add("name: '$localName' → '$firebaseName'")
                if (firebasePhone       != null && firebasePhone       != localPhone)       violations.add("phone: '$localPhone' → '$firebasePhone'")
                if (firebaseVehicleType != null && firebaseVehicleType != localVehicleType) violations.add("vehicleType: '$localVehicleType' → '$firebaseVehicleType'")
                if (firebaseSector      != null && firebaseSector      != localSector)      violations.add("sector: '$localSector' → '$firebaseSector'")

                if (violations.isNotEmpty()) {
                    Log.w(TAG, "⚠️ Violation intégrité (${violations.size} champ(s)):")
                    violations.forEach { Log.w(TAG, "  - $it") }
                    forceSyncWithFirebase(firebaseName, firebasePhone, firebaseVehicleType, firebaseSector)
                } else {
                    Log.d(TAG, "✅ Intégrité OK")
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.e(TAG, "Erreur listener intégrité: ${error.message}")
            }
        }

        db.child("societes/$societeId/agents/$deviceId/config")
            .addValueEventListener(configListener!!)
    }

    /**
     * Force la resynchronisation immédiate avec Firebase (source de vérité).
     * Écrase les SharedPreferences locales et redémarre le service si actif.
     */
    private fun forceSyncWithFirebase(
        name: String?,
        phone: String?,
        vehicleType: String?,
        sector: String?
    ) {
        Log.i(TAG, "🔄 Resynchronisation forcée avec Firebase...")

        prefs.edit().apply {
            if (name        != null) putString("name",        name)
            if (phone       != null) putString("phone",       phone)
            if (vehicleType != null) putString("vehicleType", vehicleType)
            if (sector      != null) putString("sector",      sector)
            apply()
        }

        Toast.makeText(this, "⚠️ Configuration resynchronisée avec le serveur", Toast.LENGTH_LONG).show()

        if (LocationService.isRunning) {
            Log.i(TAG, "🔄 Redémarrage du service pour appliquer la nouvelle config...")
            stopService(Intent(this, LocationService::class.java))
            tvStatus.postDelayed({ startTracking() }, 1000)
        }

        Log.i(TAG, "✅ Resynchronisation terminée: vehicleType=$vehicleType, sector=$sector")
    }

    // ─────────────────────────────────────────────────────────────
    // Permissions et tracking
    // ─────────────────────────────────────────────────────────────

    private fun checkPermissionsAndStart() {
        val allGranted = locationPermissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

        if (!allGranted) {
            permissionLauncher.launch(locationPermissions)
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val bgGranted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!bgGranted) {
                bgPermissionLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                return
            }
        }

        startTracking()
    }

    private fun startTracking() {
        val intent = Intent(this, LocationService::class.java)
        ContextCompat.startForegroundService(this, intent)
        tvStatus.text = "✅ Tracking actif"
        Toast.makeText(this, "Tracking démarré", Toast.LENGTH_SHORT).show()
    }

    // ─────────────────────────────────────────────────────────────
    // Cycle de vie
    // ─────────────────────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        tvStatus.text = if (LocationService.isRunning) "✅ Tracking actif" else tvStatus.text
    }

    override fun onDestroy() {
        super.onDestroy()

        pendingListener?.let {
            db.child("pending/$deviceId").removeEventListener(it)
        }

        configListener?.let {
            val societeId = prefs.getString("companyId", null)
            if (!societeId.isNullOrEmpty()) {
                db.child("societes/$societeId/agents/$deviceId/config").removeEventListener(it)
                Log.d(TAG, "🎧 Listeners détachés")
            }
        }
    }
}
