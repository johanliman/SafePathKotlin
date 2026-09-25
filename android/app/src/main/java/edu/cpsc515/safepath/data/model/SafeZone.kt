package edu.cpsc515.safepath.data.model

import java.io.Serializable

data class SafeZone(
    val id: String,
    val name: String,
    val type: String,
    val latitude: Double,
    val longitude: Double,
    val capacity: Int,
    val supplies: List<String>,
    val accessible: Boolean,
    val description: String
) : Serializable

data class WalkwayNode(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val name: String
) : Serializable

data class WalkwayEdge(
    val from: String,
    val to: String,
    val accessible: Boolean,
    val hasStairs: Boolean
) : Serializable

data class CampusBuilding(
    val id: String,
    val name: String,
    val code: String,
    val latitude: Double,
    val longitude: Double,
    val accessible: Boolean
) : Serializable
