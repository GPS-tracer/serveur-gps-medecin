package com.gpstracker.agent

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.google.android.material.textfield.TextInputEditText

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var tvStatus: TextView
    private lateinit var etDeviceId: TextInputEditText
    private lateinit var etName: TextInputEditText
    private lateinit var etPhone: TextInputEditText
    private lateinit var btnSave: Button

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
        etDeviceId = findViewById(R.id.etDeviceId)
        etName = findViewById(R.id.etName)
        etPhone = findViewById(R.id.etPhone)
        btnSave = findViewById(R.id.btnSave)

        etDeviceId.setText(prefs.getString("device_id", ""))
        etName.setText(prefs.getString("name", ""))
        etPhone.setText(prefs.getString("phone", ""))
        tvStatus.text = if (LocationService.isRunning) "✅ Tracking actif" else "⏸ Inactif"

        btnSave.setOnClickListener {
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

    private fun checkPermissionsAndStart() {
        val allGranted = locationPermissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
        if (allGranted) startTracking()
        else permissionLauncher.launch(locationPermissions)
    }

    private fun startTracking() {
        val intent = Intent(this, LocationService::class.java)
        ContextCompat.startForegroundService(this, intent)
        tvStatus.text = "✅ Tracking actif"
        Toast.makeText(this, "Tracking démarré", Toast.LENGTH_SHORT).show()
    }
}
