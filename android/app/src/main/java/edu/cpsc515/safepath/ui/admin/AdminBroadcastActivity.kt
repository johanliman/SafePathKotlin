package edu.cpsc515.safepath.ui.admin

import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import edu.cpsc515.safepath.R
import edu.cpsc515.safepath.data.model.*
import edu.cpsc515.safepath.network.SafePathApiClient
import kotlinx.coroutines.launch

/**
 * AdminBroadcastActivity - Android Admin Emergency Operations Center
 * CPSC 515 Mobile Computing
 * Team: Daniel Wu & Jie Chen
 */
class AdminBroadcastActivity : AppCompatActivity() {

    private lateinit var apiClient: SafePathApiClient
    private lateinit var spinnerAlertType: Spinner
    private lateinit var spinnerSeverity: Spinner
    private lateinit var etLat: EditText
    private lateinit var etLng: EditText
    private lateinit var seekBarRadius: SeekBar
    private lateinit var tvRadiusLabel: TextView
    private lateinit var etInstructions: EditText
    private lateinit var btnBroadcast: Button
    private lateinit var btnBackToUserPanel: Button
    private lateinit var btnClearAlerts: Button
    private lateinit var btnReturnToUserPanelBottom: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_admin_broadcast)

        apiClient = SafePathApiClient()

        spinnerAlertType = findViewById(R.id.spinnerAlertType)
        spinnerSeverity = findViewById(R.id.spinnerSeverity)
        etLat = findViewById(R.id.etLat)
        etLng = findViewById(R.id.etLng)
        seekBarRadius = findViewById(R.id.seekBarRadius)
        tvRadiusLabel = findViewById(R.id.tvRadiusLabel)
        etInstructions = findViewById(R.id.etInstructions)
        btnBroadcast = findViewById(R.id.btnBroadcast)
        btnBackToUserPanel = findViewById(R.id.btnBackToUserPanel)
        btnClearAlerts = findViewById(R.id.btnClearAlerts)
        btnReturnToUserPanelBottom = findViewById(R.id.btnReturnToUserPanelBottom)

        setupSpinners()
        setupRadiusListener()

        btnBackToUserPanel.setOnClickListener {
            finish()
        }

        btnReturnToUserPanelBottom.setOnClickListener {
            finish()
        }

        btnClearAlerts.setOnClickListener {
            clearAlerts()
        }

        btnBroadcast.setOnClickListener {
            broadcastAlert()
        }
    }

    private fun setupSpinners() {
        val alertTypeNames = AlertType.entries.map { "${it.icon} ${it.displayName}" }
        val typeAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, alertTypeNames)
        spinnerAlertType.adapter = typeAdapter

        val severityNames = AlertSeverity.entries.map { it.name }
        val sevAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, severityNames)
        spinnerSeverity.adapter = sevAdapter

        spinnerAlertType.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: android.view.View?, position: Int, id: Long) {
                val selectedType = AlertType.entries[position]
                seekBarRadius.progress = selectedType.defaultRadiusMeters.toInt()
                tvRadiusLabel.text = "GEOFENCE RADIUS: ${selectedType.defaultRadiusMeters.toInt()} METERS"
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    private fun setupRadiusListener() {
        seekBarRadius.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                tvRadiusLabel.text = "GEOFENCE RADIUS: $progress METERS"
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })
    }

    private fun broadcastAlert() {
        val type = AlertType.entries[spinnerAlertType.selectedItemPosition]
        val severity = AlertSeverity.entries[spinnerSeverity.selectedItemPosition]
        val lat = etLat.text.toString().toDoubleOrNull() ?: 33.8800
        val lng = etLng.text.toString().toDoubleOrNull() ?: -117.8860
        val radius = seekBarRadius.progress.toDouble()
        val instructions = etInstructions.text.toString().trim()

        val alert = EmergencyAlert(
            id = "alert-${System.currentTimeMillis()}",
            type = type,
            severity = severity,
            title = "${type.displayName} Declared",
            instructions = instructions,
            latitude = lat,
            longitude = lng,
            radiusMeters = radius,
            recommendedSafeZoneId = "SZ1"
        )

        lifecycleScope.launch {
            val success = apiClient.broadcastAdminAlert(alert)
            if (success) {
                Toast.makeText(this@AdminBroadcastActivity, "✅ Emergency Alert Broadcast Successfully!", Toast.LENGTH_LONG).show()
                finish()
            } else {
                Toast.makeText(this@AdminBroadcastActivity, "Alert queued locally.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun clearAlerts() {
        lifecycleScope.launch {
            val success = apiClient.clearAllAlerts()
            if (success) {
                Toast.makeText(this@AdminBroadcastActivity, "🟢 All Active Alerts Cleared! Campus Status: SAFE.", Toast.LENGTH_LONG).show()
                finish()
            } else {
                Toast.makeText(this@AdminBroadcastActivity, "Failed to clear alerts on server.", Toast.LENGTH_SHORT).show()
            }
        }
    }
}
