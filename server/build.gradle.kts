plugins {
    kotlin("jvm") version "2.0.21"
    application
}

group = "edu.cpsc515.safepath"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib")
    testImplementation("org.jetbrains.kotlin:kotlin-test")
    testImplementation("junit:junit:4.13.2")
}

application {
    mainClass.set("edu.cpsc515.safepath.server.service.EmergencyGeofenceEngine")
}
