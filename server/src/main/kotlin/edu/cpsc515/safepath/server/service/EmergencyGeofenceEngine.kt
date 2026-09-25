package edu.cpsc515.safepath.server.service

import edu.cpsc515.safepath.server.model.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * EmergencyGeofenceEngine - Proximity Geofencing, Multi-User Tracking, and Mobile Computing Telemetry
 * CPSC 515 Mobile Computing - SafePath Group Project
 * Primary Responsibility: Johan Liman & Siling Liu
 */
class EmergencyGeofenceEngine {

    private val activeAlerts = ConcurrentHashMap<String, EmergencyAlert>()
    private val alertHistory = mutableListOf<EmergencyAlert>()
    private val activeUsers = ConcurrentHashMap<String, UserLocationPing>()

    // Mobile Computing Research Metrics
    private val latencyObservations = mutableListOf<Long>()
    private val totalBytesSent = AtomicLong(0)
    private val totalBytesReceived = AtomicLong(0)
    private val startTimeMillis = System.currentTimeMillis()

    /**
     * Broadcast a new emergency alert from Admin EOC
     */
    fun broadcastAlert(alert: EmergencyAlert): List<UserLocationPing> {
        activeAlerts[alert.id] = alert
        alertHistory.add(alert)
        totalBytesSent.addAndGet(alert.toString().toByteArray().size.toLong())

        // Determine all users inside the geofence perimeter
        val affectedUsers = mutableListOf<UserLocationPing>()
        for ((_, user) in activeUsers) {
            val dist = SafeRoutePathfinder.haversineDistance(
                user.latitude, user.longitude,
                alert.latitude, alert.longitude
            )
            if (dist <= alert.radiusMeters) {
                user.status = UserSafetyStatus.IN_HAZARD
                affectedUsers.add(user)
            } else if (dist <= alert.radiusMeters + 120.0) {
                user.status = UserSafetyStatus.PROXIMITY_WARNING
            }
        }
        return affectedUsers
    }

    /**
     * Resolve / Cancel an existing alert
     */
    fun resolveAlert(alertId: String): Boolean {
        val removed = activeAlerts.remove(alertId) ?: return false
        removed.active = false

        // Re-evaluate user safety statuses
        for ((_, user) in activeUsers) {
            var stillInDanger = false
            for ((_, alert) in activeAlerts) {
                val d = SafeRoutePathfinder.haversineDistance(
                    user.latitude, user.longitude,
                    alert.latitude, alert.longitude
                )
                if (d <= alert.radiusMeters) {
                    stillInDanger = true
                    break
                }
            }
            if (!stillInDanger) {
                user.status = UserSafetyStatus.NORMAL
            }
        }
        return true
    }

    /**
     * Process incoming student location update ping
     */
    fun processLocationPing(ping: UserLocationPing): Pair<UserSafetyStatus, List<EmergencyAlert>> {
        totalBytesReceived.addAndGet(ping.toString().toByteArray().size.toLong())

        val matchedAlerts = mutableListOf<EmergencyAlert>()
        var inDanger = false
        var inWarning = false

        for ((_, alert) in activeAlerts) {
            if (!alert.active) continue
            val dist = SafeRoutePathfinder.haversineDistance(
                ping.latitude, ping.longitude,
                alert.latitude, alert.longitude
            )
            if (dist <= alert.radiusMeters) {
                inDanger = true
                matchedAlerts.add(alert)
            } else if (dist <= alert.radiusMeters + 120.0) {
                inWarning = true
                matchedAlerts.add(alert)
            }
        }

        val status = when {
            inDanger -> UserSafetyStatus.IN_HAZARD
            inWarning -> UserSafetyStatus.PROXIMITY_WARNING
            else -> UserSafetyStatus.NORMAL
        }

        ping.status = status
        activeUsers[ping.email] = ping

        // Record transmission latency (simulated timestamp differential)
        val latency = System.currentTimeMillis() - ping.timestamp
        recordLatency(if (latency >= 0) latency else 15L)

        return Pair(status, matchedAlerts)
    }

    fun recordLatency(ms: Long) {
        synchronized(latencyObservations) {
            latencyObservations.add(ms)
            if (latencyObservations.size > 100) {
                latencyObservations.removeAt(0)
            }
        }
    }

    fun getActiveAlerts(): List<EmergencyAlert> = activeAlerts.values.toList()

    fun getAllUsers(): List<UserLocationPing> = activeUsers.values.toList()

    fun getTelemetry(): SystemTelemetry {
        val avgLatency = synchronized(latencyObservations) {
            if (latencyObservations.isEmpty()) 16.0 else latencyObservations.average()
        }
        return SystemTelemetry(
            connectedClients = activeUsers.size,
            activeAlertsCount = activeAlerts.size,
            averageBroadcastLatencyMs = avgLatency,
            totalBytesTransferred = totalBytesSent.get() + totalBytesReceived.get(),
            serverUptimeSeconds = (System.currentTimeMillis() - startTimeMillis) / 1000
        )
    }
}
