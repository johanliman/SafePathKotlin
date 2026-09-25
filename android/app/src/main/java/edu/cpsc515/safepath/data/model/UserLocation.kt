package edu.cpsc515.safepath.data.model

import java.io.Serializable

enum class NetworkStatus {
    WIFI, CELLULAR_4G, WEAK_CELLULAR, OFFLINE
}

data class UserProfile(
    val email: String,
    val name: String,
    val role: String = "Student",
    val requiresAccessibility: Boolean = false
) : Serializable

data class UserLocation(
    val email: String,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val networkStatus: NetworkStatus,
    val batteryPercent: Int,
    val timestamp: Long = System.currentTimeMillis(),
    var status: SafetyStatus = SafetyStatus.SAFE
) : Serializable

data class SafeNavigationRoute(
    val destinationSafeZone: SafeZone,
    val waypoints: List<WalkwayNode>,
    val totalDistanceMeters: Double,
    val estimatedTimeMinutes: Int,
    val isAccessibilityFriendly: Boolean,
    val stepInstructions: List<String>
) : Serializable
