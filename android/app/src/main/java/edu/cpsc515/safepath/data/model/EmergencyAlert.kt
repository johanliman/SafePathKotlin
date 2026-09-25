package edu.cpsc515.safepath.data.model

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
    PUBLIC_HEALTH("Public Health Emergency", "🏥", 300.0);

    companion object {
        fun fromString(str: String): AlertType {
            return entries.find { it.name.equals(str, ignoreCase = true) || it.displayName.equals(str, ignoreCase = true) }
                ?: HAZARDOUS_MATERIALS
        }
    }
}

enum class AlertSeverity {
    CRITICAL, WARNING, ADVISORY
}

enum class SafetyStatus {
    SAFE, PROXIMITY_WARNING, IN_HAZARD
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
    val active: Boolean = true,
    val broadcastBy: String = "Campus Emergency Operations Center (Admin)"
) : Serializable
