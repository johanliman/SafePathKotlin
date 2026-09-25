package edu.cpsc515.safepath.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import edu.cpsc515.safepath.data.model.*
import edu.cpsc515.safepath.metrics.MobileComputingMetricsManager
import edu.cpsc515.safepath.network.SafePathApiClient
import kotlinx.coroutines.*

/**
 * LocationTrackingService - Android Background Foreground Service
 * Tracks real-time GPS coordinates, evaluates geofence boundaries, and pushes emergency notifications.
 * CPSC 515 Mobile Computing
 * Team: Johan Liman & Daniel Wu
 */
class LocationTrackingService : Service() {

    private val binder = LocalBinder()
    private val serviceScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var metricsManager: MobileComputingMetricsManager
    private lateinit var apiClient: SafePathApiClient

    private var currentUserEmail: String = "student@gmail.com"
    private var lastLocation: Location? = null
    private val activeAlerts = mutableListOf<EmergencyAlert>()

    inner class LocalBinder : Binder() {
        fun getService(): LocationTrackingService = this@LocationTrackingService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        metricsManager = MobileComputingMetricsManager(this)
        apiClient = SafePathApiClient()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        createNotificationChannels()
        startForeground(NOTIFICATION_ID, buildForegroundNotification("SafePath Active", "Monitoring campus safety"))

        setupLocationUpdates()
    }

    private fun setupLocationUpdates() {
        val locationRequest = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000L)
            .setMinUpdateIntervalMillis(2000L)
            .setMinUpdateDistanceMeters(2.0f)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                for (location in result.locations) {
                    processNewLocation(location)
                }
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            // Permissions handled by Activity
        }
    }

    private fun processNewLocation(location: Location) {
        lastLocation = location
        metricsManager.updateGpsAccuracy(location.accuracy)

        val netStatus = metricsManager.detectNetworkStatus()
        val battery = metricsManager.getBatteryLevel()

        val ping = UserLocation(
            email = currentUserEmail,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracy,
            networkStatus = netStatus,
            batteryPercent = battery
        )

        // Evaluate against active alerts
        for (alert in activeAlerts) {
            val dist = FloatArray(1)
            Location.distanceBetween(location.latitude, location.longitude, alert.latitude, alert.longitude, dist)
            if (dist[0] <= alert.radiusMeters) {
                ping.status = SafetyStatus.IN_HAZARD
                triggerAlarmNotification(alert, dist[0].toInt())
                break
            } else if (dist[0] <= alert.radiusMeters + 120) {
                ping.status = SafetyStatus.PROXIMITY_WARNING
            }
        }

        serviceScope.launch {
            apiClient.updateLocation(ping)
        }
    }

    private fun triggerAlarmNotification(alert: EmergencyAlert, distanceMeters: Int) {
        val vibrator = ContextCompat.getSystemService(this, Vibrator::class.java)
        vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 400, 200, 400), -1))

        val notification = NotificationCompat.Builder(this, CHANNEL_EMERGENCY_ID)
            .setContentTitle("🚨 EMERGENCY ALERT: ${alert.title}")
            .setContentText("You are $distanceMeters meters from danger. ${alert.instructions}")
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(ALERT_NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val fChannel = NotificationChannel(
                CHANNEL_FOREGROUND_ID,
                "SafePath Tracking",
                NotificationManager.IMPORTANCE_LOW
            )
            val eChannel = NotificationChannel(
                CHANNEL_EMERGENCY_ID,
                "Emergency Broadcasts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                enableVibration(true)
                description = "Urgent geofenced campus alerts"
            }

            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(fChannel)
            nm.createNotificationChannel(eChannel)
        }
    }

    private fun buildForegroundNotification(title: String, text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_FOREGROUND_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        fusedLocationClient.removeLocationUpdates(locationCallback)
    }

    companion object {
        private const val NOTIFICATION_ID = 1001
        private const val ALERT_NOTIFICATION_ID = 1002
        private const val CHANNEL_FOREGROUND_ID = "safepath_foreground_channel"
        private const val CHANNEL_EMERGENCY_ID = "safepath_emergency_channel"
    }
}
