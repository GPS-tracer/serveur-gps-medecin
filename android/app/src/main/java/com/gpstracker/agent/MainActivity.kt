package com.gpstracker.agent

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
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

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
    }

    private lateinit var prefs: SharedPreferences
    private lateinit var tvStatus: TextView
    private lateinit var tvConfigStatus: TextView
    private lateinit var etDeviceId: TextInputEditText
    private lateinit var etName: TextInputEditText
    private lateinit var etPhone: TextInputEditText
    private lateinit var btnSave: Button

    private val db = FirebaseDatabase.getInstance().reference
    private var configListener: ValueEventListener? = null
    private var isConfigLocked = false

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
        tvStatus = findViewById(R.id.tvStatus)
        tvConfigStatus = findViewById(R.id.tvConfigStatus)
        etDeviceId = findViewById(R.id.etDeviceId)
        etName = findViewById(R.id.etName)
        etPhone = findViewById(R.id.etPhone)
        btnSave = findViewById(R.id.btnSave)

        // Charger les données locales
        loadLocalData()
        
        // Vérifier l'intégrité de la configuration
        checkConfigIntegrity()
        
        // Mettre à jour le statut
        updateStatus()

        btnSave.setOnClickListener {
            if (isConfigLocked) {
                showLockedDialog()
                return@setOnClickListener
            }
            
            val deviceId = etDeviceId.text.toString().trim()
            val name = etName.text.toString().trim()
            val phone = etPhone.text.toString().trim()

            if (deviceId.isEmpty()) {
                etDeviceId.error = "Requis"
                return@setOnClickListener
            }

            prefs.edit()
                .putString("device_id", deviceId)
                .putString("name", name)
                .putString("phone", phone)
                .apply()

            checkPermissionsAndStart()
        }
    }

    /**
     * Charge les données locales et vérifie si la config est verrouillée
     */
    private fun loadLocalData() {
        val deviceId = prefs.getString("device_id", "")
        val name = prefs.getString("name", "")
        val phone = prefs.getString("phone", "")
        
        etDeviceId.setText(deviceId)
        etName.setText(name)
        etPhone.setText(phone)
        
        // Si un device_id existe, vérifier si la config est verrouillée
        if (!deviceId.isNullOrEmpty()) {
            checkIfConfigLocked(deviceId)
        }
    }

    /**
     * Vérifie si la configuration est verrouillée (gérée par Firebase)
     * Chemin: societes/{uid_societe}/agents/{id_agent}/config
     */
    private fun checkIfConfigLocked(deviceId: String) {
        val societeId = prefs.getString("companyId", null)
        
        if (societeId.isNullOrEmpty()) {
            // Pas encore de societeId, configuration libre
            isConfigLocked = false
            unlockConfiguration()
            tvConfigStatus.text = "✏️ Configuration libre"
            tvConfigStatus.setTextColor(getColor(R.color.text_secondary))
            return
        }
        
        db.child("societes/$societeId/agents/$deviceId/config").get()
            .addOnSuccessListener { snapshot ->
                if (snapshot.exists()) {
                    // L'agent existe dans Firebase = configuration verrouillée
                    isConfigLocked = true
                    lockConfiguration()
                    
                    // Charger les données depuis Firebase
                    val firebaseName = snapshot.child("name").getValue(String::class.java)
                    val firebasePhone = snapshot.child("phone").getValue(String::class.java)
                    val vehicleType = snapshot.child("vehicleType").getValue(String::class.java)
                    
                    if (firebaseName != null) etName.setText(firebaseName)
                    if (firebasePhone != null) etPhone.setText(firebasePhone)
                    
                    tvConfigStatus.text = "🔒 Configuration verrouillée par l'administrateur"
                    tvConfigStatus.setTextColor(getColor(R.color.warning))
                    
                    Log.i(TAG, "🔒 Configuration verrouillée: vehicleType=$vehicleType")
                } else {
                    // L'agent n'existe pas encore = configuration libre
                    isConfigLocked = false
                    unlockConfiguration()
                    tvConfigStatus.text = "✏️ Configuration libre"
                    tvConfigStatus.setTextColor(getColor(R.color.text_secondary))
                }
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Erreur vérification config: ${e.message}")
            }
    }

    /**
     * Verrouille les champs de configuration
     */
    private fun lockConfiguration() {
        etDeviceId.isEnabled = false
        etName.isEnabled = false
        etPhone.isEnabled = false
        
        etDeviceId.alpha = 0.6f
        etName.alpha = 0.6f
        etPhone.alpha = 0.6f
        
        btnSave.text = "Démarrer le tracking"
        
        Log.d(TAG, "🔒 Champs verrouillés")
    }

    /**
     * Déverrouille les champs de configuration
     */
    private fun unlockConfiguration() {
        etDeviceId.isEnabled = true
        etName.isEnabled = true
        etPhone.isEnabled = true
        
        etDeviceId.alpha = 1.0f
        etName.alpha = 1.0f
        etPhone.alpha = 1.0f
        
        btnSave.text = "Enregistrer et démarrer"
        
        Log.d(TAG, "🔓 Champs déverrouillés")
    }

    /**
     * Affiche un dialogue si l'utilisateur tente de modifier une config verrouillée
     */
    private fun showLockedDialog() {
        AlertDialog.Builder(this)
            .setTitle("Configuration verrouillée")
            .setMessage("Cette configuration est gérée par votre administrateur et ne peut pas être modifiée.\n\nPour toute modification, contactez votre responsable de flotte.")
            .setIcon(android.R.drawable.ic_lock_lock)
            .setPositiveButton("OK") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    /**
     * Vérifie l'intégrité de la configuration locale vs Firebase.
     * Se déclenche au démarrage ET à chaque modification distante (ValueEventListener permanent).
     *
     * Cas 1 — companyId connu : écoute directement societes/{uid}/agents/{id}/config
     * Cas 2 — premier lancement (pas de companyId) : cherche l'agent dans tous les nœuds
     *          societes/ pour récupérer son companyId, puis attache le listener.
     */
    private fun checkConfigIntegrity() {
        val deviceId = prefs.getString("device_id", null)

        if (deviceId.isNullOrEmpty()) {
            Log.d(TAG, "Pas de device_id, vérification d'intégrité ignorée")
            return
        }

        val societeId = prefs.getString("companyId", null)

        if (!societeId.isNullOrEmpty()) {
            // companyId déjà connu → attacher le listener directement
            attachIntegrityListener(deviceId, societeId)
        } else {
            // Premier lancement : rechercher le companyId dans Firebase
            Log.d(TAG, "🔍 companyId inconnu, recherche de l'agent $deviceId dans Firebase...")
            resolveCompanyId(deviceId)
        }
    }

    /**
     * Recherche le companyId de l'agent au premier lancement en parcourant
     * societes/{uid}/agents/{id}/config jusqu'à trouver l'agent correspondant.
     */
    private fun resolveCompanyId(deviceId: String) {
        db.child("societes").get()
            .addOnSuccessListener { societesSnapshot ->
                if (!societesSnapshot.exists()) {
                    Log.w(TAG, "Nœud 'societes' introuvable dans Firebase")
                    return@addOnSuccessListener
                }

                for (societeSnap in societesSnapshot.children) {
                    val agentConfig = societeSnap
                        .child("agents")
                        .child(deviceId)
                        .child("config")

                    if (agentConfig.exists()) {
                        val foundSocieteId = societeSnap.key ?: continue

                        // Persister le companyId pour les prochains démarrages
                        prefs.edit().putString("companyId", foundSocieteId).apply()
                        Log.i(TAG, "✅ companyId résolu: $foundSocieteId")

                        // Appliquer la config immédiatement
                        val name        = agentConfig.child("name").getValue(String::class.java)
                        val phone       = agentConfig.child("phone").getValue(String::class.java)
                        val vehicleType = agentConfig.child("vehicleType").getValue(String::class.java)
                        val sector      = agentConfig.child("sector").getValue(String::class.java)
                        forceSyncWithFirebase(name, phone, vehicleType, sector)

                        // Puis attacher le listener permanent
                        attachIntegrityListener(deviceId, foundSocieteId)
                        return@addOnSuccessListener
                    }
                }

                Log.w(TAG, "Agent $deviceId introuvable dans aucune société Firebase")
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Erreur résolution companyId: ${e.message}")
            }
    }

    /**
     * Attache un ValueEventListener permanent sur societes/{uid}/agents/{id}/config.
     * Vérifie name, phone, vehicleType ET sector à chaque changement.
     */
    private fun attachIntegrityListener(deviceId: String, societeId: String) {
        Log.d(TAG, "🔍 Listener d'intégrité: societes/$societeId/agents/$deviceId/config")

        configListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                if (!snapshot.exists()) {
                    Log.w(TAG, "Config introuvable: societes/$societeId/agents/$deviceId/config")
                    return
                }

                // Valeurs Firebase (source de vérité)
                val firebaseName        = snapshot.child("name").getValue(String::class.java)
                val firebasePhone       = snapshot.child("phone").getValue(String::class.java)
                val firebaseVehicleType = snapshot.child("vehicleType").getValue(String::class.java)
                val firebaseSector      = snapshot.child("sector").getValue(String::class.java)

                // Valeurs locales
                val localName        = prefs.getString("name", "")
                val localPhone       = prefs.getString("phone", "")
                val localVehicleType = prefs.getString("vehicleType", "")
                val localSector      = prefs.getString("sector", "")

                // Détecter toute divergence
                val violations = mutableListOf<String>()
                if (firebaseName        != null && firebaseName        != localName)        violations.add("name: '$localName' → '$firebaseName'")
                if (firebasePhone       != null && firebasePhone       != localPhone)       violations.add("phone: '$localPhone' → '$firebasePhone'")
                if (firebaseVehicleType != null && firebaseVehicleType != localVehicleType) violations.add("vehicleType: '$localVehicleType' → '$firebaseVehicleType'")
                if (firebaseSector      != null && firebaseSector      != localSector)      violations.add("sector: '$localSector' → '$firebaseSector'")

                if (violations.isNotEmpty()) {
                    Log.w(TAG, "⚠️ Violation d'intégrité détectée (${violations.size} champ(s)):")
                    violations.forEach { Log.w(TAG, "  - $it") }
                    forceSyncWithFirebase(firebaseName, firebasePhone, firebaseVehicleType, firebaseSector)
                } else {
                    Log.d(TAG, "✅ Intégrité OK")
                    // Verrouiller l'UI si ce n'est pas encore fait
                    if (!isConfigLocked) {
                        isConfigLocked = true
                        lockConfiguration()
                        tvConfigStatus.text = "🔒 Configuration verrouillée par l'administrateur"
                        tvConfigStatus.setTextColor(getColor(R.color.warning))
                    }
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
     * Écrase les SharedPreferences locales, met à jour l'UI et redémarre le service.
     */
    private fun forceSyncWithFirebase(
        name: String?,
        phone: String?,
        vehicleType: String?,
        sector: String?
    ) {
        Log.i(TAG, "🔄 Resynchronisation forcée avec Firebase...")

        // Écraser les SharedPreferences avec les valeurs Firebase
        prefs.edit().apply {
            if (name        != null) putString("name",        name)
            if (phone       != null) putString("phone",       phone)
            if (vehicleType != null) putString("vehicleType", vehicleType)
            if (sector      != null) putString("sector",      sector)
            apply()
        }

        // Mettre à jour l'interface
        if (name  != null) etName.setText(name)
        if (phone != null) etPhone.setText(phone)

        // Verrouiller l'UI
        isConfigLocked = true
        lockConfiguration()
        tvConfigStatus.text = "🔒 Configuration verrouillée par l'administrateur"
        tvConfigStatus.setTextColor(getColor(R.color.warning))

        Toast.makeText(this, "⚠️ Configuration resynchronisée avec le serveur", Toast.LENGTH_LONG).show()

        // Redémarrer le service pour appliquer immédiatement les nouveaux calculs
        if (LocationService.isRunning) {
            Log.i(TAG, "🔄 Redémarrage du service pour appliquer la nouvelle config...")
            stopService(Intent(this, LocationService::class.java))
            etDeviceId.postDelayed({ startTracking() }, 1000)
        }

        Log.i(TAG, "✅ Resynchronisation terminée: vehicleType=$vehicleType, sector=$sector")
    }

    /**
     * Met à jour le statut du service
     */
    private fun updateStatus() {
        tvStatus.text = if (LocationService.isRunning) "✅ Tracking actif" else "⏸ Inactif"
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    override fun onDestroy() {
        super.onDestroy()

        // Détacher le listener d'intégrité
        configListener?.let {
            val deviceId  = prefs.getString("device_id",  null)
            val societeId = prefs.getString("companyId",  null)
            if (!deviceId.isNullOrEmpty() && !societeId.isNullOrEmpty()) {
                db.child("societes/$societeId/agents/$deviceId/config").removeEventListener(it)
                Log.d(TAG, "🎧 Listener d'intégrité détaché")
            }
        }
    }

    private fun checkPermissionsAndStart() {
        val allGranted = locationPermissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
        
        if (!allGranted) {
            permissionLauncher.launch(locationPermissions)
            return
        }
        
        // Pour Android 10+, demander la permission background
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
}
