package edu.cpsc515.safepath.server

import edu.cpsc515.safepath.server.model.*
import edu.cpsc515.safepath.server.service.EmergencyGeofenceEngine
import edu.cpsc515.safepath.server.service.SafeRoutePathfinder
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class SafeRoutePathfinderTest {

    private lateinit var nodes: List<WalkwayNode>
    private lateinit var edges: List<WalkwayEdge>
    private lateinit var safeZones: List<SafeZone>
    private lateinit var pathfinder: SafeRoutePathfinder

    @Before
    fun setup() {
        nodes = listOf(
            WalkwayNode("N1", 33.8813, -117.8854, "Library Plaza"),
            WalkwayNode("N2", 33.8800, -117.8860, "Science Concourse"),
            WalkwayNode("N3", 33.8805, -117.8852, "Central Spine South"),
            WalkwayNode("N4", 33.8820, -117.8852, "Central Spine Middle"),
            WalkwayNode("N5", 33.8835, -117.8853, "Central Spine North"),
            WalkwayNode("N6", 33.8842, -117.8855, "North Quad Lawn (SZ1)")
        )

        edges = listOf(
            WalkwayEdge("N1", "N3", isAccessible = true, hasStairs = false, lengthMeters = 80.0),
            WalkwayEdge("N1", "N4", isAccessible = true, hasStairs = false, lengthMeters = 70.0),
            WalkwayEdge("N2", "N3", isAccessible = false, hasStairs = true, lengthMeters = 60.0),
            WalkwayEdge("N3", "N4", isAccessible = true, hasStairs = false, lengthMeters = 150.0),
            WalkwayEdge("N4", "N5", isAccessible = true, hasStairs = false, lengthMeters = 150.0),
            WalkwayEdge("N5", "N6", isAccessible = true, hasStairs = false, lengthMeters = 80.0)
        )

        safeZones = listOf(
            SafeZone(
                id = "SZ1",
                name = "North Quad Assembly Field",
                type = "assembly_point",
                latitude = 33.8842,
                longitude = -117.8855,
                capacity = 1500,
                supplies = listOf("First Aid", "Water"),
                isAccessible = true,
                description = "Open grass quad"
            )
        )

        pathfinder = SafeRoutePathfinder(nodes, edges, safeZones)
    }

    @Test
    fun testHaversineDistanceCalculations() {
        val dist = SafeRoutePathfinder.haversineDistance(33.8813, -117.8854, 33.8800, -117.8860)
        assertTrue("Distance should be approximately 150m-160m", dist in 140.0..170.0)
    }

    @Test
    fun testSafeRouteGeneratedSuccessfully() {
        // User at Library (N1), no active hazards
        val route = pathfinder.findSafeRoute(
            userLat = 33.8813,
            userLng = -117.8854,
            activeAlerts = emptyList(),
            requireAccessible = false
        )

        assertNotNull("Route should be generated", route)
        assertEquals("Target should be SZ1", "SZ1", route!!.targetSafeZone.id)
        assertTrue("Total distance should be greater than zero", route.totalDistanceMeters > 0)
        assertTrue("Instructions should be populated", route.turnByTurnInstructions.isNotEmpty())
    }

    @Test
    fun testHazardAvoidanceReroutesProperly() {
        // Place Hazmat alert on Science Hall (N2) with 200m radius
        val hazard = EmergencyAlert(
            id = "alert-test-1",
            type = AlertType.HAZARDOUS_MATERIALS,
            severity = AlertSeverity.CRITICAL,
            title = "Test HazMat Spill",
            instructions = "Evacuate upwind",
            latitude = 33.8800,
            longitude = -117.8860,
            radiusMeters = 200.0,
            recommendedSafeZoneId = "SZ1"
        )

        val route = pathfinder.findSafeRoute(
            userLat = 33.8813,
            userLng = -117.8854,
            activeAlerts = listOf(hazard),
            requireAccessible = false
        )

        assertNotNull(route)
        // Ensure path does NOT contain N2
        val nodeIds = route!!.pathNodes.map { it.id }
        assertFalse("Route should avoid hazardous node N2", nodeIds.contains("N2"))
    }

    @Test
    fun testAccessibilityFilterExcludesStairs() {
        val routeAccessible = pathfinder.findSafeRoute(
            userLat = 33.8800,
            userLng = -117.8860,
            activeAlerts = emptyList(),
            requireAccessible = true
        )

        // When accessibility is required, stairs edge N2->N3 is excluded
        assertTrue(routeAccessible == null || routeAccessible.isAccessible)
    }

    @Test
    fun testGeofenceEngineProximityDetection() {
        val engine = EmergencyGeofenceEngine()
        val alert = EmergencyAlert(
            id = "alert-1",
            type = AlertType.WILDFIRE,
            severity = AlertSeverity.CRITICAL,
            title = "Wildfire",
            instructions = "Evacuate",
            latitude = 33.8860,
            longitude = -117.8845,
            radiusMeters = 300.0,
            recommendedSafeZoneId = "SZ1"
        )

        engine.broadcastAlert(alert)

        // Ping from student right inside the wildfire perimeter
        val insidePing = UserLocationPing(
            email = "student@gmail.com",
            name = "Student Inside",
            role = "Student",
            latitude = 33.8862,
            longitude = -117.8846,
            accuracyMeters = 3.0,
            networkType = NetworkType.WIFI,
            batteryLevel = 90
        )

        val (status, triggered) = engine.processLocationPing(insidePing)
        assertEquals("User should be classified as IN_HAZARD", UserSafetyStatus.IN_HAZARD, status)
        assertEquals("Should match the active wildfire alert", 1, triggered.size)
    }
}
