package edu.cpsc515.safepath.metrics

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import edu.cpsc515.safepath.data.model.NetworkStatus
import java.util.concurrent.atomic.AtomicLong

/**
 * MobileComputingMetricsManager - Experimental Evaluation Instrumentation
 * CPSC 515 Mobile Computing
 * Team: Siling Liu & Johan Liman
 */
class MobileComputingMetricsManager(private val context: Context) {

    // Metrics storage
    val totalBytesTransferred = AtomicLong(0)
    var lastAlertLatencyMs: Long = 0L
        private set
    var currentGpsAccuracyMeters: Float = 3.5f
        private set

    private val latencyHistory = mutableListOf<Long>()

    /**
     * Measure network type & quality
     */
    fun detectNetworkStatus(): NetworkStatus {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return NetworkStatus.OFFLINE

        val network = cm.activeNetwork ?: return NetworkStatus.OFFLINE
        val caps = cm.getNetworkCapabilities(network) ?: return NetworkStatus.OFFLINE

        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> NetworkStatus.WIFI
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> {
                // Check bandwidth or signal quality
                val downlinkKbps = caps.linkDownstreamBandwidthKbps
                if (downlinkKbps < 500) NetworkStatus.WEAK_CELLULAR else NetworkStatus.CELLULAR_4G
            }
            else -> NetworkStatus.OFFLINE
        }
    }

    /**
     * Get system battery percentage
     */
    fun getBatteryLevel(): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: 90
    }

    /**
     * Estimate battery drain rate in % per hour based on GPS polling interval and network radio state
     */
    fun estimateBatteryDrainRatePerHour(gpsIntervalSeconds: Int, status: NetworkStatus): Double {
        val baseGpsDrain = when {
            gpsIntervalSeconds <= 1 -> 8.5   // Continuous high-frequency GPS
            gpsIntervalSeconds <= 10 -> 3.4  // Balanced tracking
            else -> 1.2                      // Power save geofence
        }

        val radioMultiplier = when (status) {
            NetworkStatus.WEAK_CELLULAR -> 1.45 // High amplifier power hunting for tower
            NetworkStatus.CELLULAR_4G -> 1.15
            NetworkStatus.WIFI -> 1.00
            NetworkStatus.OFFLINE -> 0.70
        }

        return baseGpsDrain * radioMultiplier
    }

    /**
     * Record broadcast delivery latency: time difference between Admin broadcast and phone reception
     */
    fun recordAlertLatency(broadcastTimestamp: Long): Long {
        val now = System.currentTimeMillis()
        val latency = maxOf(5L, now - broadcastTimestamp)
        lastAlertLatencyMs = latency
        synchronized(latencyHistory) {
            latencyHistory.add(latency)
            if (latencyHistory.size > 50) latencyHistory.removeAt(0)
        }
        return latency
    }

    fun updateGpsAccuracy(accuracyMeters: Float) {
        currentGpsAccuracyMeters = accuracyMeters
    }

    fun trackBytes(bytes: Long) {
        totalBytesTransferred.addAndGet(bytes)
    }

    fun getAverageLatencyMs(): Double {
        synchronized(latencyHistory) {
            return if (latencyHistory.isEmpty()) 16.0 else latencyHistory.average()
        }
    }
}
