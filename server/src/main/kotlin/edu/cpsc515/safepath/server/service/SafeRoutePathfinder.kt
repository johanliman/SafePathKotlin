package edu.cpsc515.safepath.server.service

import edu.cpsc515.safepath.server.model.*
import java.util.PriorityQueue
import kotlin.math.*

/**
 * SafeRoutePathfinder - A* / Dijkstra Navigation Algorithm avoiding Dynamic Hazard Zones
 * CPSC 515 Mobile Computing - SafePath Group Project
 * Primary Responsibility: Yu-Cheng Chang & Jie Chen
 */
class SafeRoutePathfinder(
    private val walkwayNodes: List<WalkwayNode>,
    private val walkwayEdges: List<WalkwayEdge>,
    private val safeZones: List<SafeZone>
) {

    /**
     * Compute the safest and shortest route from the user's coordinates to the nearest safe zone
     * dynamically dodging active emergency hazard circles.
     */
    fun findSafeRoute(
        userLat: Double,
        userLng: Double,
        activeAlerts: List<EmergencyAlert>,
        requireAccessible: Boolean
    ): SafeRouteResult? {
        if (walkwayNodes.isEmpty() || safeZones.isEmpty()) return null

        // 1. Identify start node nearest to user's current GPS location
        val startNode = walkwayNodes.minByOrNull { node ->
            haversineDistance(userLat, userLng, node.latitude, node.longitude)
        } ?: return null

        val startDist = haversineDistance(userLat, userLng, startNode.latitude, startNode.longitude)

        // 2. Build graph adjacency list with dynamic hazard obstacle penalties
        val nodeMap = walkwayNodes.associateBy { it.id }
        val adj = mutableMapOf<String, MutableList<GraphEdge>>()
        walkwayNodes.forEach { adj[it.id] = mutableListOf() }

        for (edge in walkwayEdges) {
            // Filter out stairs if accessibility mode is enabled
            if (requireAccessible && edge.hasStairs) {
                continue
            }

            val u = nodeMap[edge.fromNodeId] ?: continue
            val v = nodeMap[edge.toNodeId] ?: continue

            val baseDist = haversineDistance(u.latitude, u.longitude, v.latitude, v.longitude)
            var hazardPenalty = 0.0

            // Evaluate if edge intersects or lies within any active hazard circle
            for (alert in activeAlerts) {
                if (!alert.active) continue
                val distU = haversineDistance(u.latitude, u.longitude, alert.latitude, alert.longitude)
                val distV = haversineDistance(v.latitude, v.longitude, alert.latitude, alert.longitude)
                val midLat = (u.latitude + v.latitude) / 2.0
                val midLng = (u.longitude + v.longitude) / 2.0
                val distMid = haversineDistance(midLat, midLng, alert.latitude, alert.longitude)

                if (distU < alert.radiusMeters || distV < alert.radiusMeters || distMid < alert.radiusMeters) {
                    hazardPenalty += 1_000_000.0 // Severely impassable through hazard zone
                } else if (distMid < alert.radiusMeters + 100.0) {
                    hazardPenalty += 5_000.0 // Proximity buffer penalty
                }
            }

            val totalWeight = baseDist + hazardPenalty
            adj[u.id]?.add(GraphEdge(v.id, totalWeight, baseDist))
            adj[v.id]?.add(GraphEdge(u.id, totalWeight, baseDist))
        }

        // 3. Dijkstra pathfinding from startNode
        val dist = mutableMapOf<String, Double>()
        val prev = mutableMapOf<String, String?>()
        val visited = mutableSetOf<String>()

        walkwayNodes.forEach {
            dist[it.id] = Double.POSITIVE_INFINITY
            prev[it.id] = null
        }
        dist[startNode.id] = 0.0

        val pq = PriorityQueue<Pair<String, Double>>(compareBy { it.second })
        pq.add(Pair(startNode.id, 0.0))

        while (pq.isNotEmpty()) {
            val (currId, currDist) = pq.poll()
            if (currId in visited) continue
            visited.add(currId)

            val neighbors = adj[currId] ?: emptyList()
            for (edge in neighbors) {
                if (edge.targetId !in visited) {
                    val newDist = currDist + edge.weight
                    if (newDist < (dist[edge.targetId] ?: Double.POSITIVE_INFINITY)) {
                        dist[edge.targetId] = newDist
                        prev[edge.targetId] = currId
                        pq.add(Pair(edge.targetId, newDist))
                    }
                }
            }
        }

        // 4. Map each safe zone to its designated walkway arrival node
        var bestZone: SafeZone? = null
        var bestNode: WalkwayNode? = null
        var minWeight = Double.POSITIVE_INFINITY

        for (zone in safeZones) {
            val zoneNode = walkwayNodes.minByOrNull { n ->
                haversineDistance(zone.latitude, zone.longitude, n.latitude, n.longitude)
            } ?: continue

            val weight = dist[zoneNode.id] ?: Double.POSITIVE_INFINITY
            if (weight < minWeight) {
                minWeight = weight
                bestZone = zone
                bestNode = zoneNode
            }
        }

        if (bestZone == null || bestNode == null || minWeight >= 500_000.0) {
            // All safe zones are currently blocked by hazards
            return null
        }

        // 5. Reconstruct sequence of path nodes
        val path = mutableListOf<WalkwayNode>()
        var curr: String? = bestNode.id
        while (curr != null) {
            val node = nodeMap[curr]
            if (node != null) path.add(0, node)
            curr = prev[curr]
        }

        // 6. Calculate total real distance in meters
        var totalDistanceMeters = startDist
        for (i in 0 until path.size - 1) {
            totalDistanceMeters += haversineDistance(
                path[i].latitude, path[i].longitude,
                path[i + 1].latitude, path[i + 1].longitude
            )
        }

        // Estimated walking speed: 1.2 m/s standard, 0.85 m/s wheelchair accessible
        val walkSpeed = if (requireAccessible) 0.85 else 1.2
        val estMinutes = max(1, (totalDistanceMeters / walkSpeed / 60.0).roundToInt())

        // Turn-by-turn guidance
        val instructions = mutableListOf<String>()
        instructions.add("Depart current location and proceed ${startDist.roundToInt()}m to ${startNode.name}.")
        for (i in 0 until path.size - 1) {
            val segDist = haversineDistance(
                path[i].latitude, path[i].longitude,
                path[i + 1].latitude, path[i + 1].longitude
            ).roundToInt()
            instructions.add("Proceed along hazard-free path toward ${path[i + 1].name} ($segDist m).")
        }
        instructions.add("Arrive safely at ${bestZone.name} (Capacity: ${bestZone.capacity} persons).")

        return SafeRouteResult(
            targetSafeZone = bestZone,
            pathNodes = path,
            totalDistanceMeters = totalDistanceMeters,
            estimatedTimeMinutes = estMinutes,
            isAccessible = requireAccessible,
            turnByTurnInstructions = instructions
        )
    }

    companion object {
        private const val EARTH_RADIUS_METERS = 6371000.0

        /**
         * Haversine formula for spherical distance in meters
         */
        fun haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val dLat = Math.toRadians(lat2 - lat1)
            val dLon = Math.toRadians(lon2 - lon1)
            val rLat1 = Math.toRadians(lat1)
            val rLat2 = Math.toRadians(lat2)

            val a = sin(dLat / 2.0).pow(2.0) +
                    cos(rLat1) * cos(rLat2) * sin(dLon / 2.0).pow(2.0)
            val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
            return EARTH_RADIUS_METERS * c
        }
    }

    private data class GraphEdge(val targetId: String, val weight: Double, val distanceMeters: Double)
}
