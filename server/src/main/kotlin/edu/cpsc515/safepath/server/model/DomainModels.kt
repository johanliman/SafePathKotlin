package edu.cpsc515.safepath.server.model

import java.io.Serializable

enum class AlertType(val displayName: String, val icon: String, val defaultRadiusMeters: Double) {
    TSUNAMI("Tsunami Warning", "🌊", 500.0),
    EARTHQUAKE("Earthquake Alert", "🏚️", 400.0),
    WILDFIRE("Wildfire Evacuation", "🔥", 450.0),
    EXTREME_HEAT("Extreme Heat Advisory", "☀️", 600.0),
    FLOOD("Flash Flood Warning", "🌧️", 350.0),
    THUNDERSTORM("Severe Thunderstorm / Lightning", "⚡", 500.0),
    HIGH_WIND("High Wind Hazard", "💨", 400.0),
    VOLCANO("Volcanic Ash / Pyroclastic Alert", "🌋", 700.0),
    HAZARDOUS_MATERIALS("Hazardous Materials (HazMat) Spill", "☣️", 250.0),
    AIR_QUALITY("Severe Air Quality Emergency", "🌫️", 600.0),
    RADIATION("Radiation Threat / Incident", "☢️", 350.0),
    PUBLIC_HEALTH("Public Health Emergency", "🏥", 300.0)
}

enum class AlertSeverity {
    CRITICAL, WARNING, ADVISORY
}

enum class UserSafetyStatus {
    NORMAL, PROXIMITY_WARNING, IN_HAZARD
}

enum class NetworkType {
    WIFI, CELLULAR_4G, WEAK_CELLULAR, OFFLINE
}

data class EmergencyAlert(
    val id: String,
    val type: AlertType,
    val severity: AlertSeverity,
    val title: String,
    val instructions: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Double,
    val recommendedSafeZoneId: String,
    val timestamp: Long = System.currentTimeMillis(),
    var active: Boolean = true,
    val broadcastBy: String = "Campus Emergency Operations Center (Admin)"
) : Serializable

data class SafeZone(
    val id: String,
    val name: String,
    val type: String,
    val latitude: Double,
    val longitude: Double,
    val capacity: Int,
    val supplies: List<String>,
    val isAccessible: Boolean,
    val description: String
) : Serializable

data class WalkwayNode(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val name: String
) : Serializable

data class WalkwayEdge(
    val fromNodeId: String,
    val toNodeId: String,
    val isAccessible: Boolean,
    val hasStairs: Boolean,
    val lengthMeters: Double
) : Serializable

data class UserLocationPing(
    val email: String,
    val name: String,
    val role: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Double,
    val networkType: NetworkType,
    val batteryLevel: Int,
    val timestamp: Long = System.currentTimeMillis(),
    var status: UserSafetyStatus = UserSafetyStatus.NORMAL
) : Serializable

data class SafeRouteResult(
    val targetSafeZone: SafeZone,
    val pathNodes: List<WalkwayNode>,
    val totalDistanceMeters: Double,
    val estimatedTimeMinutes: Int,
    val isAccessible: Boolean,
    val turnByTurnInstructions: List<String>
) : Serializable

data class SystemTelemetry(
    val connectedClients: Int,
    val activeAlertsCount: Int,
    val averageBroadcastLatencyMs: Double,
    val totalBytesTransferred: Long,
    val serverUptimeSeconds: Long
) : Serializable
