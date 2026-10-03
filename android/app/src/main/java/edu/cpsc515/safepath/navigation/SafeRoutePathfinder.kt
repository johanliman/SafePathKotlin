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

        // Determine closest uncompromised safe zone (STRICTLY WEST OF CA-57 FREEWAY)
        val validSafeZones = safeZones.filter { sz ->
            sz.longitude <= -117.8825 && activeAlerts.none { alert ->
                alert.active && calculateDistance(sz.latitude, sz.longitude, alert.latitude, alert.longitude) < (alert.radiusMeters + 15.0)
            }
        }.ifEmpty { safeZones.filter { it.longitude <= -117.8825 } }

        var bestZone: SafeZone? = null
        var bestZoneNode: WalkwayNode? = null
        var minTotalWeight = Double.POSITIVE_INFINITY

        for (sz in validSafeZones) {
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

        if (bestZone == null || bestZoneNode == null) {
            bestZone = validSafeZones.firstOrNull() ?: return null
            bestZoneNode = nodes.minByOrNull { n ->
                calculateDistance(bestZone.latitude, bestZone.longitude, n.latitude, n.longitude)
            } ?: return null
        }

        // Reconstruct path
        val routeNodes = mutableListOf<WalkwayNode>()
        var curr: String? = bestZoneNode.id
        while (curr != null) {
            val node = nodeMap[curr]
            if (node != null) routeNodes.add(0, node)
            curr = prev[curr]
        }
        if (routeNodes.isEmpty() || (routeNodes.size == 1 && routeNodes[0].id != startNode.id)) {
            routeNodes.clear()
            routeNodes.add(startNode)
            routeNodes.add(bestZoneNode)
        }

        // Real distance calculation
        var totalDist = startDist
        for (i in 0 until routeNodes.size - 1) {
            totalDist += calculateDistance(
                routeNodes[i].latitude, routeNodes[i].longitude,
                routeNodes[i + 1].latitude, routeNodes[i + 1].longitude
            )
        }

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
        instructions.add("Arrive at Safe Haven: ${bestZone.name}.")

        return SafeNavigationRoute(
            destinationSafeZone = bestZone,
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
