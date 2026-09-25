package edu.cpsc515.safepath.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.gson.Gson
import edu.cpsc515.safepath.R
import edu.cpsc515.safepath.data.model.*
import edu.cpsc515.safepath.metrics.MobileComputingMetricsManager
import edu.cpsc515.safepath.navigation.SafeRoutePathfinder
import edu.cpsc515.safepath.network.SafePathApiClient
import edu.cpsc515.safepath.service.LocationTrackingService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * MainActivity - Dual Student & Admin Mobile Command Center
 * CPSC 515 Mobile Computing
 * Team: Daniel Wu, Johan Liman, Jie Chen, Yu-Cheng Chang, Siling Liu
 */
class MainActivity : AppCompatActivity() {

    private lateinit var mapWebView: WebView
    private lateinit var adminMapWebView: WebView
    private lateinit var metricsManager: MobileComputingMetricsManager
    private lateinit var apiClient: SafePathApiClient
    private lateinit var pathfinder: SafeRoutePathfinder

    // Segmented Role Switcher Tabs
    private lateinit var tabStudentPanel: Button
    private lateinit var tabAdminPanel: Button
    private lateinit var layoutStudentPanel: View
    private lateinit var layoutAdminPanel: View

    // Student UI elements
    private lateinit var tvSafetyBadge: TextView
    private lateinit var tvNetworkState: TextView
    private lateinit var tvGpsAccuracy: TextView
    private lateinit var tvLatency: TextView
    private lateinit var tvBattery: TextView
    private lateinit var layoutEmergencyBanner: View
    private lateinit var tvEmergencyTitle: TextView
    private lateinit var tvEmergencyDirectives: TextView
    private lateinit var tvSafeRouteInfo: TextView
    private lateinit var switchAccessibility: SwitchCompat
    private lateinit var btnMoveToSafeZone: Button
    private lateinit var btnMoveAllToSafeZone: Button

    // Student Chips (Daniel, Johan, Jie, Yu, Siling)
    private lateinit var chipDaniel: Button
    private lateinit var chipJohan: Button
    private lateinit var chipJie: Button
    private lateinit var chipYuCheng: Button
    private lateinit var chipSiling: Button

    // Admin UI elements
    private lateinit var btnScenarioChem: Button
    private lateinit var btnScenarioWildfire: Button
    private lateinit var btnScenarioQuake: Button
    private lateinit var btnScenarioFlood: Button
    private lateinit var tvAdminCenterGps: TextView
    private lateinit var spinnerAdminCategory: Spinner
    private lateinit var spinnerAdminSeverity: Spinner
    private lateinit var tvAdminRadiusLabel: TextView
    private lateinit var seekBarAdminRadius: SeekBar
    private lateinit var etAdminInstructions: EditText
    private lateinit var btnAdminBroadcast: Button
    private lateinit var btnAdminClear: Button
    private lateinit var btnAdminResetFleet: Button

    // Fleet Status TextViews
    private lateinit var tvFleetStatusDaniel: TextView
    private lateinit var tvFleetStatusJohan: TextView
    private lateinit var tvFleetStatusJie: TextView
    private lateinit var tvFleetStatusYu: TextView
    private lateinit var tvFleetStatusSiling: TextView

    // Admin Pin & Radius State
    private var adminLat: Double = 33.8800
    private var adminLng: Double = -117.8860
    private var adminRadius: Double = 200.0
    private var isAdminMapLoaded: Boolean = false

    // 5 Campus Students
    data class StudentState(
        val email: String,
        val name: String,
        var lat: Double,
        var lng: Double,
        var inHazard: Boolean = false,
        var distanceMeters: Int = 0,
        var estMinutes: Int = 0,
        var targetHaven: String = ""
    )

    private val students = mutableListOf(
        StudentState("daniel.wu@csu.fullerton.edu", "Daniel", 33.8813, -117.8854),
        StudentState("johan.liman@csu.fullerton.edu", "Johan", 33.8802, -117.8858),
        StudentState("jie.chen@csu.fullerton.edu", "Jie", 33.8829, -117.8828),
        StudentState("yucheng.chang@csu.fullerton.edu", "Yu", 33.8820, -117.8885),
        StudentState("siling.liu@csu.fullerton.edu", "Siling", 33.8835, -117.8870)
    )

    private val alertCategoryList = listOf(
        "☣️ Hazardous Materials",
        "🔥 Wildfire",
        "🏚️ Earthquake",
        "🌊 Tsunami",
        "☀️ Extreme Heat",
        "🌧️ Flash Flood",
        "⚡ Thunderstorm",
        "💨 High Wind",
        "🌋 Volcano",
        "🌫️ Air Quality",
        "☢️ Radiation Threat",
        "🏥 Public Health Emergency"
    )

    private val severityLevels = listOf("CRITICAL", "WARNING", "ADVISORY")

    private var activeStudentIndex = 0
    private var isMapLoaded = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private var moveRunnable: Runnable? = null
    private var moveAllRunnable: Runnable? = null

    // Simulation & Safe Zones
    private val activeAlerts = mutableListOf<EmergencyAlert>()
    private val safeZones = mutableListOf<SafeZone>()
    private val walkwayNodes = mutableListOf<WalkwayNode>()
    private val walkwayEdges = mutableListOf<WalkwayEdge>()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            startLocationService()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        metricsManager = MobileComputingMetricsManager(this)
        apiClient = SafePathApiClient()

        initCampusData()
        pathfinder = SafeRoutePathfinder(walkwayNodes, walkwayEdges, safeZones)

        bindViews()
        setupListeners()
        setupSpinners()
        setupWebView()
        setupAdminWebView()
        switchStudent(0)
        selectTab(false)

        checkPermissionsAndStartService()
        startMetricsMonitoring()
        startServerPolling()
    }

    private fun bindViews() {
        tabStudentPanel = findViewById(R.id.tabStudentPanel)
        tabAdminPanel = findViewById(R.id.tabAdminPanel)
        layoutStudentPanel = findViewById(R.id.layoutStudentPanel)
        layoutAdminPanel = findViewById(R.id.layoutAdminPanel)

        mapWebView = findViewById(R.id.mapWebView)
        adminMapWebView = findViewById(R.id.adminMapWebView)

        tvSafetyBadge = findViewById(R.id.tvSafetyBadge)
        tvNetworkState = findViewById(R.id.tvNetworkState)
        tvGpsAccuracy = findViewById(R.id.tvGpsAccuracy)
        tvLatency = findViewById(R.id.tvLatency)
        tvBattery = findViewById(R.id.tvBattery)
        layoutEmergencyBanner = findViewById(R.id.layoutEmergencyBanner)
        tvEmergencyTitle = findViewById(R.id.tvEmergencyTitle)
        tvEmergencyDirectives = findViewById(R.id.tvEmergencyDirectives)
        tvSafeRouteInfo = findViewById(R.id.tvSafeRouteInfo)
        switchAccessibility = findViewById(R.id.switchAccessibility)
        btnMoveToSafeZone = findViewById(R.id.btnMoveToSafeZone)
        btnMoveAllToSafeZone = findViewById(R.id.btnMoveAllToSafeZone)

        chipDaniel = findViewById(R.id.chipDaniel)
        chipJohan = findViewById(R.id.chipJohan)
        chipJie = findViewById(R.id.chipJie)
        chipYuCheng = findViewById(R.id.chipYuCheng)
        chipSiling = findViewById(R.id.chipSiling)

        btnScenarioChem = findViewById(R.id.btnScenarioChem)
        btnScenarioWildfire = findViewById(R.id.btnScenarioWildfire)
        btnScenarioQuake = findViewById(R.id.btnScenarioQuake)
        btnScenarioFlood = findViewById(R.id.btnScenarioFlood)
        tvAdminCenterGps = findViewById(R.id.tvAdminCenterGps)
        spinnerAdminCategory = findViewById(R.id.spinnerAdminCategory)
        spinnerAdminSeverity = findViewById(R.id.spinnerAdminSeverity)
        tvAdminRadiusLabel = findViewById(R.id.tvAdminRadiusLabel)
        seekBarAdminRadius = findViewById(R.id.seekBarAdminRadius)
        etAdminInstructions = findViewById(R.id.etAdminInstructions)
        btnAdminBroadcast = findViewById(R.id.btnAdminBroadcast)
        btnAdminClear = findViewById(R.id.btnAdminClear)
        btnAdminResetFleet = findViewById(R.id.btnAdminResetFleet)

        tvFleetStatusDaniel = findViewById(R.id.tvFleetStatusDaniel)
        tvFleetStatusJohan = findViewById(R.id.tvFleetStatusJohan)
        tvFleetStatusJie = findViewById(R.id.tvFleetStatusJie)
        tvFleetStatusYu = findViewById(R.id.tvFleetStatusYu)
        tvFleetStatusSiling = findViewById(R.id.tvFleetStatusSiling)
    }

    private fun setupSpinners() {
        val catAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, alertCategoryList)
        spinnerAdminCategory.adapter = catAdapter

        val sevAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, severityLevels)
        spinnerAdminSeverity.adapter = sevAdapter
    }

    private fun setupListeners() {
        tabStudentPanel.setOnClickListener { selectTab(false) }
        tabAdminPanel.setOnClickListener { selectTab(true) }

        chipDaniel.setOnClickListener { switchStudent(0) }
        chipJohan.setOnClickListener { switchStudent(1) }
        chipJie.setOnClickListener { switchStudent(2) }
        chipYuCheng.setOnClickListener { switchStudent(3) }
        chipSiling.setOnClickListener { switchStudent(4) }

        btnMoveToSafeZone.setOnClickListener {
            toggleMoveActiveStudentToSafeZone()
        }

        btnMoveAllToSafeZone.setOnClickListener {
            toggleMoveAllToSafeZones()
        }

        switchAccessibility.setOnCheckedChangeListener { _, isChecked ->
            evaluateHazardAndCalculateRoute(isChecked)
        }

        seekBarAdminRadius.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                adminRadius = progress.toDouble()
                tvAdminRadiusLabel.text = "GEOFENCE RADIUS: $progress METERS"
                if (isAdminMapLoaded) {
                    adminMapWebView.evaluateJavascript("updateRadius($progress);", null)
                }
            }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        })

        btnScenarioChem.setOnClickListener {
            loadScenario("Hazardous Materials", 33.8800, -117.8860, 180, "Toxic chemical vapor plume reported. Evacuate UPWIND immediately toward North Quad.")
        }
        btnScenarioWildfire.setOnClickListener {
            loadScenario("Wildfire", 33.8875, -117.8845, 200, "Approaching brush fire. Evacuate downwind away from dry vegetation.")
        }
        btnScenarioQuake.setOnClickListener {
            loadScenario("Earthquake", 33.8813, -117.8854, 200, "DROP, COVER, AND HOLD ON. Evacuate compromised buildings to open quads.")
        }
        btnScenarioFlood.setOnClickListener {
            loadScenario("Flash Flood", 33.8845, -117.8890, 180, "Flash flooding across campus lowlands. Move to high-ground assembly havens.")
        }

        btnAdminBroadcast.setOnClickListener {
            broadcastAdminAlert()
        }

        btnAdminClear.setOnClickListener {
            clearAdminAlerts()
        }

        btnAdminResetFleet.setOnClickListener {
            resetAdminFleet()
        }
    }

    private fun selectTab(isAdmin: Boolean) {
        if (isAdmin) {
            tabAdminPanel.setBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#DC2626")))
            tabAdminPanel.setTextColor(Color.WHITE)
            tabStudentPanel.setBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#E2E8F0")))
            tabStudentPanel.setTextColor(Color.parseColor("#475569"))

            layoutStudentPanel.visibility = View.GONE
            layoutAdminPanel.visibility = View.VISIBLE
            updateAdminFleetDisplay()
            if (isAdminMapLoaded) {
                refreshAdminMapDisplay()
            }
        } else {
            tabStudentPanel.setBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#2563EB")))
            tabStudentPanel.setTextColor(Color.WHITE)
            tabAdminPanel.setBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#E2E8F0")))
            tabAdminPanel.setTextColor(Color.parseColor("#475569"))

            layoutAdminPanel.visibility = View.GONE
            layoutStudentPanel.visibility = View.VISIBLE
            refreshMapDisplay()
        }
    }

    private fun loadScenario(typeName: String, lat: Double, lng: Double, radius: Int, instructions: String) {
        adminLat = lat
        adminLng = lng
        adminRadius = radius.toDouble()

        tvAdminCenterGps.text = "📍 Center: ${String.format("%.4f, %.4f", lat, lng)}"
        tvAdminRadiusLabel.text = "GEOFENCE RADIUS: $radius METERS"
        seekBarAdminRadius.progress = radius
        etAdminInstructions.setText(instructions)

        val idx = alertCategoryList.indexOfFirst { it.contains(typeName, ignoreCase = true) }
        if (idx != -1) {
            spinnerAdminCategory.setSelection(idx)
        }

        if (isAdminMapLoaded) {
            adminMapWebView.evaluateJavascript("setEpicenter($lat, $lng, $radius);", null)
        }
    }

    private fun broadcastAdminAlert() {
        val selectedStr = alertCategoryList[spinnerAdminCategory.selectedItemPosition]
        val cleanName = selectedStr.substring(selectedStr.indexOf(' ') + 1)
        val alertType = AlertType.fromString(cleanName)
        val severityStr = severityLevels[spinnerAdminSeverity.selectedItemPosition]
        val severity = AlertSeverity.valueOf(severityStr)
        val instructions = etAdminInstructions.text.toString().ifBlank {
            "Emergency hazard reported in this sector. Evacuate to nearest safe haven immediately."
        }

        val alert = EmergencyAlert(
            id = "alert-${System.currentTimeMillis()}",
            type = alertType,
            severity = severity,
            title = "${alertType.icon} ${alertType.displayName}",
            instructions = instructions,
            latitude = adminLat,
            longitude = adminLng,
            radiusMeters = adminRadius,
            recommendedSafeZoneId = "SZ1",
            active = true
        )

        activeAlerts.clear()
        activeAlerts.add(alert)

        lifecycleScope.launch {
            apiClient.broadcastAdminAlert(alert)
            withContext(Dispatchers.Main) {
                evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                refreshMapDisplay()
                refreshAdminMapDisplay()
                updateAdminFleetDisplay()
                Toast.makeText(this@MainActivity, "🚨 Emergency Broadcast Dispatched!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun clearAdminAlerts() {
        activeAlerts.clear()
        lifecycleScope.launch {
            apiClient.clearAllAlerts()
            withContext(Dispatchers.Main) {
                students.forEach {
                    it.inHazard = false
                    it.targetHaven = ""
                }
                evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                refreshMapDisplay()
                if (isAdminMapLoaded) {
                    adminMapWebView.evaluateJavascript("clearHazard();", null)
                }
                updateAdminFleetDisplay()
                Toast.makeText(this@MainActivity, "✅ All alerts cleared. Campus is safe!", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun resetAdminFleet() {
        val initialCoords = listOf(
            Pair(33.8813, -117.8854),
            Pair(33.8802, -117.8858),
            Pair(33.8829, -117.8828),
            Pair(33.8820, -117.8885),
            Pair(33.8835, -117.8870)
        )
        students.forEachIndexed { i, st ->
            st.lat = initialCoords[i].first
            st.lng = initialCoords[i].second
            st.inHazard = false
            syncLocationToServer(st)
        }

        lifecycleScope.launch {
            apiClient.resetFleetLocations()
            withContext(Dispatchers.Main) {
                evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                refreshMapDisplay()
                refreshAdminMapDisplay()
                updateAdminFleetDisplay()
                Toast.makeText(this@MainActivity, "✅ Student fleet reset to initial building locations", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun updateAdminFleetDisplay() {
        val pairs = listOf(
            Pair(students[0], tvFleetStatusDaniel),
            Pair(students[1], tvFleetStatusJohan),
            Pair(students[2], tvFleetStatusJie),
            Pair(students[3], tvFleetStatusYu),
            Pair(students[4], tvFleetStatusSiling)
        )

        pairs.forEach { (st, tv) ->
            if (activeAlerts.isNotEmpty()) {
                if (st.inHazard) {
                    tv.text = "🚨 IN HAZARD (${st.distanceMeters}m | ~${st.estMinutes}m)"
                    tv.setTextColor(Color.parseColor("#DC2626"))
                } else {
                    val haven = if (st.targetHaven.isNotEmpty()) st.targetHaven else "SZ"
                    tv.text = "🟢 Safe (${st.distanceMeters}m to $haven)"
                    tv.setTextColor(Color.parseColor("#16A34A"))
                }
            } else {
                tv.text = "🟢 Safe (Normal)"
                tv.setTextColor(Color.parseColor("#16A34A"))
            }
        }

        if (isAdminMapLoaded) {
            refreshAdminMapDisplay()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        mapWebView.setBackgroundColor(Color.WHITE)
        mapWebView.settings.javaScriptEnabled = true
        mapWebView.settings.domStorageEnabled = true
        mapWebView.settings.allowFileAccess = true
        mapWebView.settings.allowContentAccess = true
        mapWebView.settings.allowFileAccessFromFileURLs = true
        mapWebView.settings.allowUniversalAccessFromFileURLs = true
        mapWebView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        mapWebView.addJavascriptInterface(WebAppBridge(), "AndroidApp")

        mapWebView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isMapLoaded = true
                refreshMapDisplay()
            }
        }

        mapWebView.loadUrl("file:///android_asset/map.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupAdminWebView() {
        adminMapWebView.setBackgroundColor(Color.WHITE)
        adminMapWebView.settings.javaScriptEnabled = true
        adminMapWebView.settings.domStorageEnabled = true
        adminMapWebView.settings.allowFileAccess = true
        adminMapWebView.settings.allowContentAccess = true
        adminMapWebView.settings.allowFileAccessFromFileURLs = true
        adminMapWebView.settings.allowUniversalAccessFromFileURLs = true
        adminMapWebView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        adminMapWebView.addJavascriptInterface(AdminWebAppBridge(), "AdminAndroidApp")

        adminMapWebView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isAdminMapLoaded = true
                refreshAdminMapDisplay()
            }
        }

        adminMapWebView.loadUrl("file:///android_asset/admin_map.html")
    }

    inner class WebAppBridge {
        @JavascriptInterface
        fun onMapClicked(lat: Double, lng: Double) {
            runOnUiThread {
                val st = students[activeStudentIndex]
                st.lat = lat
                st.lng = lng
                evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                syncLocationToServer(st)
                refreshMapDisplay()
                Toast.makeText(this@MainActivity, "📍 Position moved: ${String.format("%.4f, %.4f", lat, lng)}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    inner class AdminWebAppBridge {
        @JavascriptInterface
        fun onMapClicked(lat: Double, lng: Double) {
            runOnUiThread {
                adminLat = lat
                adminLng = lng
                tvAdminCenterGps.text = "📍 Center: ${String.format("%.4f, %.4f", lat, lng)}"
                Toast.makeText(this@MainActivity, "🎯 Epicenter pinned: ${String.format("%.4f, %.4f", lat, lng)}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun switchStudent(index: Int) {
        if (index !in students.indices) return
        activeStudentIndex = index

        val chips = listOf(chipDaniel, chipJohan, chipJie, chipYuCheng, chipSiling)
        chips.forEachIndexed { i, chip ->
            if (i == index) {
                chip.setTextColor(Color.WHITE)
                androidx.core.view.ViewCompat.setBackgroundTintList(chip, ColorStateList.valueOf(Color.parseColor("#2563EB")))
            } else {
                chip.setTextColor(Color.parseColor("#475569"))
                androidx.core.view.ViewCompat.setBackgroundTintList(chip, ColorStateList.valueOf(Color.WHITE))
            }
        }

        val st = students[activeStudentIndex]
        evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
        syncLocationToServer(st)
        refreshMapDisplay()

        if (::mapWebView.isInitialized && isMapLoaded) {
            mapWebView.evaluateJavascript("centerMap(${st.lat}, ${st.lng}, 16);", null)
        }
    }

    private fun refreshMapDisplay() {
        if (!isMapLoaded) return

        val active = students[activeStudentIndex]
        mapWebView.evaluateJavascript("updateUser('${active.name}', ${active.lat}, ${active.lng}, ${active.inHazard});", null)

        val others = students.filterIndexed { i, _ -> i != activeStudentIndex }.map {
            mapOf("email" to it.email, "name" to it.name, "lat" to it.lat, "lng" to it.lng, "inHazard" to it.inHazard)
        }
        val othersJson = Gson().toJson(others)
        mapWebView.evaluateJavascript("setOtherStudents($othersJson);", null)

        if (activeAlerts.isNotEmpty()) {
            val alert = activeAlerts[0]
            mapWebView.evaluateJavascript("setHazard(${alert.latitude}, ${alert.longitude}, ${alert.radiusMeters}, '${alert.title}');", null)
        } else {
            mapWebView.evaluateJavascript("clearHazard();", null)
        }
    }

    private fun refreshAdminMapDisplay() {
        if (!isAdminMapLoaded) return
        adminMapWebView.evaluateJavascript("setEpicenter($adminLat, $adminLng, $adminRadius);", null)

        val fleet = students.map {
            mapOf("email" to it.email, "name" to it.name, "lat" to it.lat, "lng" to it.lng, "inHazard" to it.inHazard)
        }
        val fleetJson = Gson().toJson(fleet)
        adminMapWebView.evaluateJavascript("setFleetStudents($fleetJson);", null)
    }

    private fun evaluateHazardAndCalculateRoute(isAccessible: Boolean) {
        val activeAlert = activeAlerts.firstOrNull()

        students.forEach { st ->
            var inHazard = false
            if (activeAlert != null) {
                val dist = FloatArray(1)
                android.location.Location.distanceBetween(
                    st.lat, st.lng,
                    activeAlert.latitude, activeAlert.longitude,
                    dist
                )
                if (dist[0] <= activeAlert.radiusMeters) {
                    inHazard = true
                }
            }
            st.inHazard = inHazard

            val route = pathfinder.generateSafeRoute(st.lat, st.lng, activeAlerts, isAccessible)
            if (route != null) {
                st.distanceMeters = route.totalDistanceMeters.toInt()
                st.estMinutes = route.estimatedTimeMinutes
                st.targetHaven = route.destinationSafeZone.name
            } else {
                st.distanceMeters = 0
                st.estMinutes = 0
                st.targetHaven = "Safe Zone"
            }
        }

        val active = students[activeStudentIndex]
        if (active.inHazard && activeAlert != null) {
            tvSafetyBadge.text = "🚨 IN HAZARD"
            tvSafetyBadge.setTextColor(Color.parseColor("#DC2626"))
            tvSafetyBadge.setBackgroundResource(R.drawable.badge_hazard)
            layoutEmergencyBanner.visibility = View.VISIBLE
            tvEmergencyTitle.text = "${activeAlert.type.icon} CRITICAL: ${activeAlert.type.displayName}"
            tvEmergencyDirectives.text = activeAlert.instructions

            val route = pathfinder.generateSafeRoute(active.lat, active.lng, activeAlerts, isAccessible)
            if (route != null) {
                val points = mutableListOf(listOf(active.lat, active.lng))
                route.waypoints.forEach { points.add(listOf(it.latitude, it.longitude)) }
                points.add(listOf(route.destinationSafeZone.latitude, route.destinationSafeZone.longitude))

                val coordsJson = Gson().toJson(points)
                if (::mapWebView.isInitialized && isMapLoaded) {
                    mapWebView.evaluateJavascript("setSafeRoute($coordsJson);", null)
                }

                tvSafeRouteInfo.text = "🛡️ ${route.destinationSafeZone.name}\n" +
                        "Distance: ${route.totalDistanceMeters.toInt()}m | Est. Time: ~${route.estimatedTimeMinutes} min"
                tvSafeRouteInfo.setTextColor(Color.parseColor("#DC2626"))
            }
        } else {
            tvSafetyBadge.text = "SAFE"
            tvSafetyBadge.setTextColor(Color.parseColor("#16A34A"))
            tvSafetyBadge.setBackgroundResource(R.drawable.badge_safe)
            layoutEmergencyBanner.visibility = View.GONE
            tvSafeRouteInfo.text = "🟢 Campus Status: All Clear (Safe Zone)"
            tvSafeRouteInfo.setTextColor(Color.parseColor("#16A34A"))
            if (::mapWebView.isInitialized && isMapLoaded) {
                mapWebView.evaluateJavascript("clearSafeRoute();", null)
            }
        }

        refreshMapDisplay()
        updateAdminFleetDisplay()
    }

    private fun toggleMoveActiveStudentToSafeZone() {
        if (moveRunnable != null) {
            mainHandler.removeCallbacks(moveRunnable!!)
            moveRunnable = null
            btnMoveToSafeZone.text = "🏃 Move to Safe Zone"
            return
        }

        val st = students[activeStudentIndex]
        val route = pathfinder.generateSafeRoute(st.lat, st.lng, activeAlerts, switchAccessibility.isChecked)
        if (route == null) {
            Toast.makeText(this, "You are already in a safe zone!", Toast.LENGTH_SHORT).show()
            return
        }
        st.targetHaven = route.destinationSafeZone.name

        val points = mutableListOf(Pair(st.lat, st.lng))
        route.waypoints.forEach { points.add(Pair(it.latitude, it.longitude)) }
        points.add(Pair(route.destinationSafeZone.latitude, route.destinationSafeZone.longitude))

        val fineSteps = mutableListOf<Pair<Double, Double>>()
        for (i in 0 until points.size - 1) {
            val p1 = points[i]
            val p2 = points[i + 1]
            val dist = FloatArray(1)
            android.location.Location.distanceBetween(p1.first, p1.second, p2.first, p2.second, dist)
            val steps = max(1, (dist[0] / 18f).roundToInt())
            for (s in 1..steps) {
                val frac = s.toDouble() / steps.toDouble()
                fineSteps.add(Pair(p1.first + (p2.first - p1.first) * frac, p1.second + (p2.second - p1.second) * frac))
            }
        }

        var stepIdx = 0
        btnMoveToSafeZone.text = "⏹️ Stop Moving"

        moveRunnable = object : Runnable {
            override fun run() {
                if (stepIdx < fineSteps.size) {
                    val pt = fineSteps[stepIdx]
                    st.lat = pt.first
                    st.lng = pt.second
                    stepIdx++

                    var remainingMeters = 0.0
                    for (k in stepIdx until fineSteps.size - 1) {
                        val d = FloatArray(1)
                        android.location.Location.distanceBetween(
                            fineSteps[k].first, fineSteps[k].second,
                            fineSteps[k + 1].first, fineSteps[k + 1].second, d
                        )
                        remainingMeters += d[0]
                    }

                    val walkSpeed = if (switchAccessibility.isChecked) 0.85 else 1.2
                    val remainingMins = if (remainingMeters <= 25) 0 else max(1, (remainingMeters / walkSpeed / 60.0).roundToInt())

                    st.distanceMeters = remainingMeters.toInt()
                    st.estMinutes = remainingMins

                    evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                    syncLocationToServer(st)
                    mainHandler.postDelayed(this, 600L)
                } else {
                    mainHandler.removeCallbacks(this)
                    moveRunnable = null
                    btnMoveToSafeZone.text = "🏃 Move to Safe Zone"
                    st.distanceMeters = 0
                    st.estMinutes = 0
                    st.inHazard = false
                    st.targetHaven = ""
                    syncLocationToServer(st)
                    evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                    Toast.makeText(this@MainActivity, "🎉 Safely Arrived at ${route.destinationSafeZone.name}!", Toast.LENGTH_LONG).show()
                }
            }
        }
        mainHandler.post(moveRunnable!!)
    }

    private fun toggleMoveAllToSafeZones() {
        if (moveAllRunnable != null) {
            mainHandler.removeCallbacks(moveAllRunnable!!)
            moveAllRunnable = null
            btnMoveAllToSafeZone.text = "👥 Move All"
            return
        }

        data class Plan(val student: StudentState, val steps: List<Pair<Double, Double>>, var stepIdx: Int = 0, var done: Boolean = false, val destName: String)
        val plans = mutableListOf<Plan>()

        for (s in students) {
            val route = pathfinder.generateSafeRoute(s.lat, s.lng, activeAlerts, switchAccessibility.isChecked)
            if (route != null) {
                s.targetHaven = route.destinationSafeZone.name
                val pts = mutableListOf(Pair(s.lat, s.lng))
                route.waypoints.forEach { pts.add(Pair(it.latitude, it.longitude)) }
                pts.add(Pair(route.destinationSafeZone.latitude, route.destinationSafeZone.longitude))

                val fine = mutableListOf<Pair<Double, Double>>()
                for (i in 0 until pts.size - 1) {
                    val p1 = pts[i]
                    val p2 = pts[i + 1]
                    val dist = FloatArray(1)
                    android.location.Location.distanceBetween(p1.first, p1.second, p2.first, p2.second, dist)
                    val count = max(1, (dist[0] / 18f).roundToInt())
                    for (c in 1..count) {
                        val f = c.toDouble() / count.toDouble()
                        fine.add(Pair(p1.first + (p2.first - p1.first) * f, p1.second + (p2.second - p1.second) * f))
                    }
                }
                plans.add(Plan(s, fine, 0, false, route.destinationSafeZone.name))
            } else {
                s.targetHaven = ""
                plans.add(Plan(s, emptyList(), 0, true, "Safe Zone"))
            }
        }

        btnMoveAllToSafeZone.text = "⏹️ Stop All"

        moveAllRunnable = object : Runnable {
            override fun run() {
                var anyActive = false
                for (plan in plans) {
                    if (plan.done) continue
                    if (plan.stepIdx < plan.steps.size) {
                        anyActive = true
                        val pt = plan.steps[plan.stepIdx]
                        plan.student.lat = pt.first
                        plan.student.lng = pt.second
                        plan.student.targetHaven = plan.destName
                        plan.stepIdx++

                        var rem = 0.0
                        for (k in plan.stepIdx until plan.steps.size - 1) {
                            val d = FloatArray(1)
                            android.location.Location.distanceBetween(
                                plan.steps[k].first, plan.steps[k].second,
                                plan.steps[k + 1].first, plan.steps[k + 1].second, d
                            )
                            rem += d[0]
                        }
                        val mins = if (rem <= 25) 0 else max(1, (rem / 1.2 / 60.0).roundToInt())
                        plan.student.distanceMeters = rem.toInt()
                        plan.student.estMinutes = mins
                        syncLocationToServer(plan.student)
                    } else {
                        plan.done = true
                        plan.student.distanceMeters = 0
                        plan.student.estMinutes = 0
                        plan.student.inHazard = false
                        plan.student.targetHaven = ""
                        syncLocationToServer(plan.student)
                    }
                }

                evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                refreshMapDisplay()

                if (anyActive) {
                    mainHandler.postDelayed(this, 600L)
                } else {
                    mainHandler.removeCallbacks(this)
                    moveAllRunnable = null
                    btnMoveAllToSafeZone.text = "👥 Move All"
                    Toast.makeText(this@MainActivity, "🎉 All Students Safely Evacuated to Safe Havens!", Toast.LENGTH_LONG).show()
                }
            }
        }
        mainHandler.post(moveAllRunnable!!)
    }

    private fun syncLocationToServer(st: StudentState) {
        lifecycleScope.launch(Dispatchers.IO) {
            val net = metricsManager.detectNetworkStatus()
            val battery = metricsManager.getBatteryLevel()
            apiClient.updateLocation(
                UserLocation(
                    email = st.email,
                    latitude = st.lat,
                    longitude = st.lng,
                    accuracyMeters = 3.5f,
                    networkStatus = net,
                    batteryPercent = battery
                ),
                distanceMeters = st.distanceMeters,
                estMinutes = st.estMinutes,
                targetHaven = if (st.targetHaven.isNotEmpty()) st.targetHaven else null
            )
        }
    }

    private fun startServerPolling() {
        lifecycleScope.launch(Dispatchers.IO) {
            while (true) {
                try {
                    val alerts = apiClient.fetchActiveAlerts()
                    withContext(Dispatchers.Main) {
                        activeAlerts.clear()
                        activeAlerts.addAll(alerts)
                        evaluateHazardAndCalculateRoute(switchAccessibility.isChecked)
                    }
                } catch (e: Exception) {}
                kotlinx.coroutines.delay(2500L)
            }
        }
    }

    private fun startMetricsMonitoring() {
        lifecycleScope.launch {
            while (true) {
                val net = metricsManager.detectNetworkStatus()
                tvNetworkState.text = when (net) {
                    NetworkStatus.WIFI -> "📶 WiFi"
                    NetworkStatus.CELLULAR_4G -> "📡 4G/5G"
                    NetworkStatus.WEAK_CELLULAR -> "📶 2G/3G Weak"
                    NetworkStatus.OFFLINE -> "🚫 Offline"
                }
                tvGpsAccuracy.text = "🎯 ±3.5m"
                tvLatency.text = "⚡ 14ms"
                tvBattery.text = "🔋 ${metricsManager.getBatteryLevel()}%"
                kotlinx.coroutines.delay(2000L)
            }
        }
    }

    private fun checkPermissionsAndStartService() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            startLocationService()
        } else {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.POST_NOTIFICATIONS
                )
            )
        }
    }

    private fun startLocationService() {
        val intent = Intent(this, LocationTrackingService::class.java)
        ContextCompat.startForegroundService(this, intent)
    }

    private fun initCampusData() {
        safeZones.add(SafeZone("SZ1", "North Quad Assembly Field", "assembly", 33.8842, -117.8855, 1500, listOf("Medical", "Water"), true, "Open quad"))
        safeZones.add(SafeZone("SZ2", "East Perimeter Gate & Triage", "exit", 33.8825, -117.8805, 2000, listOf("Ambulance Bay"), true, "Road exit"))
        safeZones.add(SafeZone("SZ3", "West Athletics Pavilion", "shelter", 33.8850, -117.8895, 1200, listOf("HEPA Filters"), true, "Shelter"))
        safeZones.add(SafeZone("SZ4", "South Gate Egress", "exit", 33.8785, -117.8850, 1000, listOf("Escort"), true, "South exit"))

        walkwayNodes.add(WalkwayNode("N1", 33.8813, -117.8854, "Library Plaza"))
        walkwayNodes.add(WalkwayNode("N2", 33.8800, -117.8860, "Science Concourse"))
        walkwayNodes.add(WalkwayNode("N3", 33.8805, -117.8852, "Central Spine South"))
        walkwayNodes.add(WalkwayNode("N4", 33.8820, -117.8852, "Central Spine Middle"))
        walkwayNodes.add(WalkwayNode("N5", 33.8835, -117.8853, "Central Spine North"))
        walkwayNodes.add(WalkwayNode("N6", 33.8842, -117.8855, "North Quad Lawn (SZ1)"))
        walkwayNodes.add(WalkwayNode("N10", 33.8850, -117.8895, "West Pavilion Path"))
        walkwayNodes.add(WalkwayNode("N13", 33.8825, -117.8805, "East Gate Path"))
        walkwayNodes.add(WalkwayNode("N16", 33.8785, -117.8850, "South Gate Path"))

        walkwayEdges.add(WalkwayEdge("N1", "N3", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N1", "N4", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N2", "N3", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N3", "N4", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N4", "N5", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N5", "N6", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N4", "N13", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N5", "N10", accessible = true, hasStairs = false))
        walkwayEdges.add(WalkwayEdge("N3", "N16", accessible = true, hasStairs = false))
    }
}
