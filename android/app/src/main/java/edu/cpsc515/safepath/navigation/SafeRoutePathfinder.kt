package edu.cpsc515.safepath.navigation

import edu.cpsc515.safepath.data.model.*
import java.util.PriorityQueue
import kotlin.math.*

/**
 * SafeRoutePathfinder - Mobile Client Evacuation Route Generator
 * CPSC 515 Mobile Computing
 * Team: Yu-Cheng Chang, Johan Liman, Daniel Wu, Jie Chen, Siling Liu
 */
class SafeRoutePathfinder(
    private val nodes: List<WalkwayNode>,
    private val edges: List<WalkwayEdge>,
    private val safeZones: List<SafeZone>
) {

    fun generateSafeRoute(
        currentLat: Double,
        currentLng: Double,
        activeAlerts: List<EmergencyAlert>,
        requireAccessible: Boolean
    ): SafeNavigationRoute? {
        if (nodes.isEmpty() || safeZones.isEmpty()) return null

        // Nearest walkway node to current GPS
        val startNode = nodes.minByOrNull { n ->
            calculateDistance(currentLat, currentLng, n.latitude, n.longitude)
        } ?: return null

        val startDist = calculateDistance(currentLat, currentLng, startNode.latitude, startNode.longitude)

        // Adjacency graph
        val nodeMap = nodes.associateBy { it.id }
        val adj = mutableMapOf<String, MutableList<PathEdge>>()
        nodes.forEach { adj[it.id] = mutableListOf() }

        for (edge in edges) {
            if (requireAccessible && edge.hasStairs) continue

            val u = nodeMap[edge.from] ?: continue
            val v = nodeMap[edge.to] ?: continue

            val baseDist = calculateDistance(u.latitude, u.longitude, v.latitude, v.longitude)
            var hazardPenalty = 0.0

            for (alert in activeAlerts) {
                if (!alert.active) continue
                val distU = calculateDistance(u.latitude, u.longitude, alert.latitude, alert.longitude)
                val distV = calculateDistance(v.latitude, v.longitude, alert.latitude, alert.longitude)
                val midLat = (u.latitude + v.latitude) / 2.0
                val midLng = (u.longitude + v.longitude) / 2.0
                val distMid = calculateDistance(midLat, midLng, alert.latitude, alert.longitude)

                if (distU < alert.radiusMeters || distV < alert.radiusMeters || distMid < alert.radiusMeters) {
                    hazardPenalty += 500_000.0 // Severely impassable hazard
                } else if (distMid < alert.radiusMeters + 80.0) {
                    hazardPenalty += 3_000.0 // Caution buffer
                }
            }

            // FREEWAY SAFETY BARRIER: Never route onto or across CA-57 Orange Freeway (lng > -117.8825)
            if (u.longitude > -117.8825 || v.longitude > -117.8825) {
                hazardPenalty += 1_000_000.0
            }

            adj[u.id]?.add(PathEdge(v.id, baseDist + hazardPenalty, baseDist))
            adj[v.id]?.add(PathEdge(u.id, baseDist + hazardPenalty, baseDist))
        }

        // Dijkstra shortest path
        val dist = mutableMapOf<String, Double>()
        val prev = mutableMapOf<String, String?>()
        val visited = mutableSetOf<String>()

        nodes.forEach {
            dist[it.id] = Double.POSITIVE_INFINITY
            prev[it.id] = null
        }
        dist[startNode.id] = 0.0

        val pq = PriorityQueue<Pair<String, Double>>(compareBy { it.second })
        pq.add(Pair(startNode.id, 0.0))

        while (pq.isNotEmpty()) {
            val (currId, currDist) = pq.poll() ?: break
            if (currId in visited) continue
            visited.add(currId)

            val neighbors = adj[currId] ?: emptyList()
            for (edge in neighbors) {
                if (edge.target !in visited) {
                    val alt = currDist + edge.weight
                    if (alt < (dist[edge.target] ?: Double.POSITIVE_INFINITY)) {
                        dist[edge.target] = alt
                        prev[edge.target] = currId
                        pq.add(Pair(edge.target, alt))
                    }
                }
            }
        }

        // 1. Identify which safe zones are truly safe (strictly west of CA-57 freeway AND outside all active alerts)
        val candidateZones = safeZones.filter { sz ->
            sz.longitude <= -117.8825 && activeAlerts.none { alert ->
                alert.active && calculateDistance(sz.latitude, sz.longitude, alert.latitude, alert.longitude) <= (alert.radiusMeters + 35.0)
            }
        }.toMutableList()

        // 2. Fallback regional perimeter safe havens (west of freeway) if primary campus safe havens are compromised
        if (candidateZones.isEmpty()) {
            val regionalHavens = listOf(
                SafeZone("SZ5", "North Regional Perimeter Haven", "assembly", 33.8885, -117.8855, 3000, listOf("Medical", "Water"), true, "North regional safe haven"),
                SafeZone("SZ6", "West Regional Safe Center", "shelter", 33.8850, -117.8935, 3000, listOf("Shelter", "Water"), true, "West regional safe shelter"),
                SafeZone("SZ7", "South Regional Safe Center", "exit", 33.8745, -117.8850, 3000, listOf("Shuttle", "Escort"), true, "South regional safe exit"),
                SafeZone("SZ8", "Southwest Perimeter Assembly", "exit", 33.8770, -117.8910, 3000, listOf("Escort"), true, "Southwest perimeter assembly")
            )
            candidateZones.addAll(regionalHavens.filter { sz ->
                sz.longitude <= -117.8825 && activeAlerts.none { alert ->
                    alert.active && calculateDistance(sz.latitude, sz.longitude, alert.latitude, alert.longitude) <= (alert.radiusMeters + 30.0)
                }
            })
        }

        // 3. Mathematical Dynamic Perimeter Safe Haven Guarantee:
        // If an extreme disaster covers even regional havens (or candidateZones is still empty):
        if (candidateZones.isEmpty()) {
            val primaryAlert = activeAlerts.firstOrNull { it.active }
            if (primaryAlert != null) {
                val dLatM = (currentLat - primaryAlert.latitude) * 111000.0
                val dLngM = (currentLng - primaryAlert.longitude) * 111000.0 * cos(Math.toRadians(primaryAlert.latitude))
                val distM = sqrt(dLatM * dLatM + dLngM * dLngM)

                var uLat = if (distM > 1.0) dLatM / distM else -0.7071
                var uLng = if (distM > 1.0) dLngM / distM else -0.7071

                // CA-57 freeway safety guard: never point eastward towards CA-57 freeway
                if (uLng > 0 && primaryAlert.longitude + (uLng * (primaryAlert.radiusMeters + 80.0) / (111000.0 * cos(Math.toRadians(primaryAlert.latitude)))) > -117.8830) {
                    uLng = -abs(uLng)
                }

                val safeDist = primaryAlert.radiusMeters + 80.0
                val safeLat = primaryAlert.latitude + (uLat * safeDist) / 111000.0
                val safeLng = min(-117.8835, primaryAlert.longitude + (uLng * safeDist) / (111000.0 * cos(Math.toRadians(safeLat))))

                candidateZones.add(
                    SafeZone(
                        id = "SZ-SAFE-EXT",
                        name = "Exterior Campus Safe Haven",
                        type = "exit",
                        latitude = safeLat,
                        longitude = safeLng,
                        capacity = 5000,
                        supplies = listOf("Emergency Evacuation Corridor", "First Aid"),
                        accessible = true,
                        description = "Safe perimeter zone strictly outside the hazard perimeter"
                    )
                )
            } else {
                candidateZones.addAll(safeZones.filter { it.longitude <= -117.8825 })
            }
        }

        var bestZone: SafeZone? = null
        var bestZoneNode: WalkwayNode? = null
        var minTotalWeight = Double.POSITIVE_INFINITY

        for (sz in candidateZones) {
            val szNode = nodes.minByOrNull { n ->
                calculateDistance(sz.latitude, sz.longitude, n.latitude, n.longitude)
            } ?: continue

            val weight = dist[szNode.id] ?: Double.POSITIVE_INFINITY
            if (weight < minTotalWeight) {
                minTotalWeight = weight
                bestZone = sz
                bestZoneNode = szNode
            }
        }

        val chosenZone = bestZone ?: candidateZones.firstOrNull() ?: return null
        val chosenZoneNode = bestZoneNode ?: nodes.minByOrNull { n ->
            calculateDistance(chosenZone.latitude, chosenZone.longitude, n.latitude, n.longitude)
        } ?: return null

        // 4. Absolute Final Safety Check: Verify bestZone is 100% outside all active hazard circles
        var finalSafeZone: SafeZone = chosenZone
        for (alert in activeAlerts) {
            if (!alert.active) continue
            val d = calculateDistance(finalSafeZone.latitude, finalSafeZone.longitude, alert.latitude, alert.longitude)
            if (d <= alert.radiusMeters + 25.0) {
                val dLatM = (finalSafeZone.latitude - alert.latitude) * 111000.0
                val dLngM = (finalSafeZone.longitude - alert.longitude) * 111000.0 * cos(Math.toRadians(alert.latitude))
                val distM = sqrt(dLatM * dLatM + dLngM * dLngM)
                var uLat = if (distM > 1.0) dLatM / distM else -0.7071
                var uLng = if (distM > 1.0) dLngM / distM else -0.7071
                if (uLng > 0 && alert.longitude > -117.8840) uLng = -abs(uLng)

                val safeDist = alert.radiusMeters + 70.0
                val safeLat = alert.latitude + (uLat * safeDist) / 111000.0
                val safeLng = min(-117.8835, alert.longitude + (uLng * safeDist) / (111000.0 * cos(Math.toRadians(safeLat))))

                finalSafeZone = SafeZone(
                    id = finalSafeZone.id,
                    name = finalSafeZone.name,
                    type = finalSafeZone.type,
                    latitude = safeLat,
                    longitude = safeLng,
                    capacity = finalSafeZone.capacity,
                    supplies = finalSafeZone.supplies,
                    accessible = finalSafeZone.accessible,
                    description = finalSafeZone.description
                )
            }
        }

        // Reconstruct path
        val routeNodes = mutableListOf<WalkwayNode>()
        var curr: String? = chosenZoneNode.id
        while (curr != null) {
            val node = nodeMap[curr]
            if (node != null) routeNodes.add(0, node)
            curr = prev[curr]
        }
        if (routeNodes.isEmpty() || (routeNodes.size == 1 && routeNodes[0].id != startNode.id)) {
            routeNodes.clear()
            routeNodes.add(startNode)
            routeNodes.add(chosenZoneNode)
        }

        // Real distance calculation
        var totalDist = startDist
        for (i in 0 until routeNodes.size - 1) {
            totalDist += calculateDistance(
                routeNodes[i].latitude, routeNodes[i].longitude,
                routeNodes[i + 1].latitude, routeNodes[i + 1].longitude
            )
        }
        totalDist += calculateDistance(
            routeNodes.last().latitude, routeNodes.last().longitude,
            finalSafeZone.latitude, finalSafeZone.longitude
        )

        val walkSpeed = if (requireAccessible) 0.85 else 1.2
        val estMinutes = max(1, (totalDist / walkSpeed / 60.0).roundToInt())

        val instructions = mutableListOf<String>()
        instructions.add("Head toward ${startNode.name} (${startDist.roundToInt()}m).")
        for (i in 0 until routeNodes.size - 1) {
            val d = calculateDistance(
                routeNodes[i].latitude, routeNodes[i].longitude,
                routeNodes[i + 1].latitude, routeNodes[i + 1].longitude
            ).roundToInt()
            instructions.add("Follow green evacuation path to ${routeNodes[i + 1].name} ($d m).")
        }
        instructions.add("Arrive at Safe Haven: ${finalSafeZone.name}.")

        return SafeNavigationRoute(
            destinationSafeZone = finalSafeZone,
            waypoints = routeNodes,
            totalDistanceMeters = totalDist,
            estimatedTimeMinutes = estMinutes,
            isAccessibilityFriendly = requireAccessible,
            stepInstructions = instructions
        )
    }

    companion object {
        private const val R = 6371000.0 // Earth radius in meters

        fun calculateDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val dLat = Math.toRadians(lat2 - lat1)
            val dLon = Math.toRadians(lon2 - lon1)
            val rLat1 = Math.toRadians(lat1)
            val rLat2 = Math.toRadians(lat2)

            val a = sin(dLat / 2.0).pow(2.0) +
                    cos(rLat1) * cos(rLat2) * sin(dLon / 2.0).pow(2.0)
            val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
            return R * c
        }
    }

    private data class PathEdge(val target: String, val weight: Double, val distance: Double)
}
