package edu.cpsc515.safepath.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import edu.cpsc515.safepath.data.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * SafePathApiClient - REST & SSE Network Manager for Android
 * CPSC 515 Mobile Computing
 */
class SafePathApiClient(private val baseUrl: String = DEFAULT_BASE_URL) {

    companion object {
        /**
         * SERVER ENDPOINTS:
         * - LOCAL_EMULATOR_URL: Local Node.js server via Android emulator loopback.
         * - ONLINE_SERVER_URL: Set this to your live deployed cloud URL (e.g. Render / Railway).
         */
        const val LOCAL_EMULATOR_URL = "http://10.0.2.2:3000"
        const val ONLINE_SERVER_URL = "https://safepath-live.onrender.com"

        // Active server endpoint: Pointing to live Render cloud server!
        var DEFAULT_BASE_URL = ONLINE_SERVER_URL
    }

    private val client = OkHttpClient.Builder().build()
    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun registerGoogleUser(email: String, name: String, role: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val payload = mapOf(
                "email" to email,
                "name" to name,
                "role" to role
            )
            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/api/auth/google")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    suspend fun updateLocation(
        loc: UserLocation,
        distanceMeters: Int? = null,
        estMinutes: Int? = null,
        targetHaven: String? = null
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val payload = mutableMapOf<String, Any>(
                "email" to loc.email,
                "latitude" to loc.latitude,
                "longitude" to loc.longitude,
                "accuracy" to loc.accuracyMeters,
                "networkState" to loc.networkStatus.name,
                "batteryLevel" to loc.batteryPercent
            )
            if (distanceMeters != null) payload["distanceMeters"] = distanceMeters
            if (estMinutes != null) payload["estMinutes"] = estMinutes
            if (targetHaven != null) payload["targetHaven"] = targetHaven

            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/api/users/location")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    suspend fun fetchActiveAlerts(): List<EmergencyAlert> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$baseUrl/api/alerts")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val json = response.body?.string() ?: return@withContext emptyList()
            val jsonObject = JsonParser.parseString(json).asJsonObject
            val activeArray = jsonObject.getAsJsonArray("active") ?: return@withContext emptyList()

            val alerts = mutableListOf<EmergencyAlert>()
            for (element in activeArray) {
                val obj = element.asJsonObject
                val id = obj.get("id")?.asString ?: "alert-${System.currentTimeMillis()}"
                val typeStr = obj.get("type")?.asString ?: "Hazardous Materials"
                val sevStr = obj.get("severity")?.asString ?: "CRITICAL"
                val title = obj.get("title")?.asString ?: "$typeStr Declared"
                val instructions = obj.get("instructions")?.asString ?: "Evacuate immediately"
                val lat = obj.get("latitude")?.asDouble ?: 33.8800
                val lng = obj.get("longitude")?.asDouble ?: -117.8860
                val radius = obj.get("radiusMeters")?.asDouble ?: 220.0
                val safeZoneId = obj.get("recommendedSafeZoneId")?.asString ?: "SZ1"
                val active = obj.get("active")?.asBoolean ?: true

                alerts.add(
                    EmergencyAlert(
                        id = id,
                        type = AlertType.fromString(typeStr),
                        severity = try { AlertSeverity.valueOf(sevStr.uppercase()) } catch (_: Exception) { AlertSeverity.CRITICAL },
                        title = title,
                        instructions = instructions,
                        latitude = lat,
                        longitude = lng,
                        radiusMeters = radius,
                        recommendedSafeZoneId = safeZoneId,
                        active = active
                    )
                )
            }
            alerts
        } catch (e: Exception) {
            emptyList()
        }
    }

    suspend fun broadcastAdminAlert(alert: EmergencyAlert): Boolean = withContext(Dispatchers.IO) {
        try {
            val payload = mapOf(
                "type" to alert.type.displayName,
                "severity" to alert.severity.name,
                "title" to alert.title,
                "instructions" to alert.instructions,
                "latitude" to alert.latitude,
                "longitude" to alert.longitude,
                "radiusMeters" to alert.radiusMeters,
                "recommendedSafeZoneId" to alert.recommendedSafeZoneId
            )
            val body = gson.toJson(payload).toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/api/alerts")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    suspend fun clearAllAlerts(): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = "{}".toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/api/alerts/clear")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    suspend fun resetFleetLocations(): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = "{}".toRequestBody(jsonMediaType)
            val request = Request.Builder()
                .url("$baseUrl/api/users/reset")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }
}
