package edu.cpsc515.safepath.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import edu.cpsc515.safepath.R
import edu.cpsc515.safepath.network.SafePathApiClient
import kotlinx.coroutines.launch
import java.util.Locale

/**
 * LoginActivity - Secure Authentication & Registration Gateway
 * CPSC 515 Mobile Computing
 */
class LoginActivity : AppCompatActivity() {

    private lateinit var apiClient: SafePathApiClient
    private lateinit var fusedLocationClient: FusedLocationProviderClient

    private lateinit var tabSignIn: Button
    private lateinit var tabRegister: Button
    private lateinit var layoutSignInContainer: View
    private lateinit var layoutRegisterContainer: View

    private lateinit var tvAuthStatus: TextView
    private lateinit var progressBarAuth: ProgressBar

    // Login Form
    private lateinit var etLoginEmail: EditText
    private lateinit var etLoginPassword: EditText
    private lateinit var btnLoginSubmit: Button

    // Quick Login Buttons
    private lateinit var btnQuickAdmin: Button
    private lateinit var btnQuickJohan: Button
    private lateinit var btnQuickDaniel: Button
    private lateinit var btnQuickYu: Button
    private lateinit var btnQuickJie: Button
    private lateinit var btnQuickSiling: Button

    // Register Form
    private lateinit var etRegName: EditText
    private lateinit var etRegEmail: EditText
    private lateinit var etRegPassword: EditText
    private lateinit var tvDetectedLocation: TextView
    private lateinit var btnDetectGps: Button
    private lateinit var btnRegSubmit: Button

    private var capturedLat: Double = 33.8820
    private var capturedLng: Double = -117.8850
    private var isLocationMocked: Boolean = false

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            permissions[Manifest.permission.ACCESS_COARSE_LOCATION] == true) {
            fetchDeviceLocation()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        apiClient = SafePathApiClient()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        initViews()
        setupTabs()
        setupQuickLogins()
        setupActions()
        fetchDeviceLocation()
    }

    private fun initViews() {
        tabSignIn = findViewById(R.id.tabSignIn)
        tabRegister = findViewById(R.id.tabRegister)
        layoutSignInContainer = findViewById(R.id.layoutSignInContainer)
        layoutRegisterContainer = findViewById(R.id.layoutRegisterContainer)

        tvAuthStatus = findViewById(R.id.tvAuthStatus)
        progressBarAuth = findViewById(R.id.progressBarAuth)

        etLoginEmail = findViewById(R.id.etLoginEmail)
        etLoginPassword = findViewById(R.id.etLoginPassword)
        btnLoginSubmit = findViewById(R.id.btnLoginSubmit)

        btnQuickAdmin = findViewById(R.id.btnQuickAdmin)
        btnQuickJohan = findViewById(R.id.btnQuickJohan)
        btnQuickDaniel = findViewById(R.id.btnQuickDaniel)
        btnQuickYu = findViewById(R.id.btnQuickYu)
        btnQuickJie = findViewById(R.id.btnQuickJie)
        btnQuickSiling = findViewById(R.id.btnQuickSiling)

        etRegName = findViewById(R.id.etRegName)
        etRegEmail = findViewById(R.id.etRegEmail)
        etRegPassword = findViewById(R.id.etRegPassword)
        tvDetectedLocation = findViewById(R.id.tvDetectedLocation)
        btnDetectGps = findViewById(R.id.btnDetectGps)
        btnRegSubmit = findViewById(R.id.btnRegSubmit)
    }

    private fun setupTabs() {
        tabSignIn.setOnClickListener {
            tabSignIn.setBackgroundColor(Color.parseColor("#2563EB"))
            tabSignIn.setTextColor(0xFFFFFFFF.toInt())
            tabRegister.setBackgroundColor(0xFFF1F5F9.toInt())
            tabRegister.setTextColor(0xFF475569.toInt())

            layoutSignInContainer.visibility = View.VISIBLE
            layoutRegisterContainer.visibility = View.GONE
            hideStatus()
        }

        tabRegister.setOnClickListener {
            tabRegister.setBackgroundColor(Color.parseColor("#2563EB"))
            tabRegister.setTextColor(0xFFFFFFFF.toInt())
            tabSignIn.setBackgroundColor(0xFFF1F5F9.toInt())
            tabSignIn.setTextColor(0xFF475569.toInt())

            layoutRegisterContainer.visibility = View.VISIBLE
            layoutSignInContainer.visibility = View.GONE
            hideStatus()
            fetchDeviceLocation()
        }
    }

    private fun setupQuickLogins() {
        btnQuickAdmin.setOnClickListener {
            etLoginEmail.setText("admin@safepath.com")
            etLoginPassword.setText("admin")
            performLogin("admin@safepath.com", "admin")
        }

        btnQuickJohan.setOnClickListener {
            etLoginEmail.setText("johanliman@csu.fullerton.edu")
            etLoginPassword.setText("johanliman")
            performLogin("johanliman@csu.fullerton.edu", "johanliman")
        }

        btnQuickDaniel.setOnClickListener {
            etLoginEmail.setText("d.wu@csu.fullerton.edu")
            etLoginPassword.setText("danielwu")
            performLogin("d.wu@csu.fullerton.edu", "danielwu")
        }

        btnQuickYu.setOnClickListener {
            etLoginEmail.setText("yu-cheng.chang@csu.fullerton.edu")
            etLoginPassword.setText("yuchengchang")
            performLogin("yu-cheng.chang@csu.fullerton.edu", "yuchengchang")
        }

        btnQuickJie.setOnClickListener {
            etLoginEmail.setText("jchen102951@csu.fullerton.edu")
            etLoginPassword.setText("jiechen")
            performLogin("jchen102951@csu.fullerton.edu", "jiechen")
        }

        btnQuickSiling.setOnClickListener {
            etLoginEmail.setText("siling313@csu.fullerton.edu")
            etLoginPassword.setText("siling")
            performLogin("siling313@csu.fullerton.edu", "siling")
        }
    }

    private fun setupActions() {
        btnLoginSubmit.setOnClickListener {
            val email = etLoginEmail.text.toString().trim()
            val pass = etLoginPassword.text.toString().trim()
            if (email.isEmpty() || pass.isEmpty()) {
                showStatus("Please enter your email and password.", isError = true)
                return@setOnClickListener
            }
            performLogin(email, pass)
        }

        btnDetectGps.setOnClickListener {
            fetchDeviceLocation()
        }

        btnRegSubmit.setOnClickListener {
            val name = etRegName.text.toString().trim()
            val email = etRegEmail.text.toString().trim()
            val pass = etRegPassword.text.toString().trim()

            if (name.isEmpty() || email.isEmpty() || pass.isEmpty()) {
                showStatus("Please complete all registration fields.", isError = true)
                return@setOnClickListener
            }
            if (!email.contains("@")) {
                showStatus("Please enter a valid email address.", isError = true)
                return@setOnClickListener
            }
            performRegister(name, email, pass)
        }
    }

    private fun performLogin(email: String, pass: String) {
        showLoading(true)
        hideStatus()

        // Fetch fresh location before sending login payload
        fetchDeviceLocation {
            lifecycleScope.launch {
                val result = apiClient.login(email, pass, capturedLat, capturedLng, isLocationMocked)
                showLoading(false)

                if (result.success) {
                    var welcomeMsg = "Welcome, ${result.name}! Verified at ${result.locationName.ifEmpty { "Campus" }}."
                    if (result.lastLoginLocationName.isNotEmpty()) {
                        welcomeMsg += " Last login: ${result.lastLoginLocationName} (${result.distanceFromLastLoginMeters}m away)."
                    }
                    if (result.isMockLocation) {
                        welcomeMsg += " [⚠️ Mock Location Active]"
                    }
                    showStatus(welcomeMsg, isError = false)
                    navigateToMain(result.role, result.email, result.name, result.latitude, result.longitude)
                } else {
                    showStatus(result.message.ifEmpty { "Invalid credentials. Please try again." }, isError = true)
                }
            }
        }
    }

    private fun performRegister(name: String, email: String, pass: String) {
        showLoading(true)
        hideStatus()

        lifecycleScope.launch {
            val result = apiClient.registerUser(name, email, pass, capturedLat, capturedLng)
            showLoading(false)

            if (result.success) {
                showStatus("Account created for ${result.name}! Launching...", isError = false)
                navigateToMain(result.role, result.email, result.name, result.latitude, result.longitude)
            } else {
                showStatus(result.message.ifEmpty { "Registration failed." }, isError = true)
            }
        }
    }

    private fun navigateToMain(role: String, email: String, name: String, lat: Double, lng: Double) {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_ROLE, role)
            putExtra(MainActivity.EXTRA_EMAIL, email)
            putExtra(MainActivity.EXTRA_NAME, name)
            putExtra(MainActivity.EXTRA_LAT, lat)
            putExtra(MainActivity.EXTRA_LNG, lng)
        }
        startActivity(intent)
        finish()
    }

    @SuppressLint("MissingPermission")
    private fun fetchDeviceLocation(onComplete: (() -> Unit)? = null) {
        val hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            locationPermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            )
            onComplete?.invoke()
            return
        }

        try {
            tvDetectedLocation.text = "📍 Detecting satellite GPS... 🛰️"
            fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                .addOnSuccessListener { loc ->
                    if (loc != null) {
                        applyDetectedLocation(loc)
                        onComplete?.invoke()
                    } else {
                        fusedLocationClient.lastLocation.addOnSuccessListener { lastLoc ->
                            if (lastLoc != null) {
                                applyDetectedLocation(lastLoc)
                            } else {
                                fallbackLocation()
                            }
                            onComplete?.invoke()
                        }.addOnFailureListener {
                            fallbackLocation()
                            onComplete?.invoke()
                        }
                    }
                }
                .addOnFailureListener {
                    fallbackLocation()
                    onComplete?.invoke()
                }
        } catch (e: SecurityException) {
            fallbackLocation()
            onComplete?.invoke()
        }
    }

    private fun applyDetectedLocation(loc: Location) {
        capturedLat = loc.latitude
        capturedLng = loc.longitude
        isLocationMocked = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
            loc.isMock
        } else {
            @Suppress("DEPRECATION")
            loc.isFromMockProvider
        }

        var placeName = ""
        try {
            val geocoder = Geocoder(this, Locale.getDefault())
            @Suppress("DEPRECATION")
            val addrs = geocoder.getFromLocation(capturedLat, capturedLng, 1)
            if (!addrs.isNullOrEmpty()) {
                val a = addrs[0]
                val road = a.thoroughfare ?: a.subThoroughfare ?: a.featureName ?: ""
                val city = a.locality ?: a.subAdminArea ?: ""
                if (road.isNotEmpty() || city.isNotEmpty()) {
                    placeName = if (road.isNotEmpty() && city.isNotEmpty()) "$road, $city" else "$road$city"
                }
            }
        } catch (e: Exception) {}

        val providerLabel = if (isLocationMocked) "Mock Provider" else "Device GPS"
        val displayStr = if (placeName.isNotEmpty()) "$placeName ($providerLabel)" else providerLabel
        tvDetectedLocation.text = String.format("📍 Captured: %.4f, %.4f (%s)", capturedLat, capturedLng, displayStr)
    }

    private fun fallbackLocation() {
        try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            val loc = lm?.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: lm?.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (loc != null) {
                applyDetectedLocation(loc)
                return
            }
        } catch (e: Exception) {}

        capturedLat = 33.8813
        capturedLng = -117.8854
        isLocationMocked = false
        tvDetectedLocation.text = "📍 Captured: 33.8813, -117.8854 (Pollak Quad)"
    }

    private fun showLoading(loading: Boolean) {
        progressBarAuth.visibility = if (loading) View.VISIBLE else View.GONE
        btnLoginSubmit.isEnabled = !loading
        btnRegSubmit.isEnabled = !loading
    }

    private fun showStatus(msg: String, isError: Boolean) {
        tvAuthStatus.text = msg
        tvAuthStatus.visibility = View.VISIBLE
        if (isError) {
            tvAuthStatus.setBackgroundColor(0xFFFEF2F2.toInt())
            tvAuthStatus.setTextColor(0xFFDC2626.toInt())
        } else {
            tvAuthStatus.setBackgroundColor(0xFFF0FDF4.toInt())
            tvAuthStatus.setTextColor(0xFF16A34A.toInt())
        }
    }

    private fun hideStatus() {
        tvAuthStatus.visibility = View.GONE
    }
}
