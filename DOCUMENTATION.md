# SafePath: Technical Architecture, Technology Stack & System Documentation
> **CPSC 515 Mobile Computing Project**  
> **System:** SafePath Emergency Alert & Safe Route Navigation System  
> **Authors:** Daniel Wu, Johan Liman, Jie Chen, Yu-Cheng Chang, Siling Liu  

---

## 1. System Overview

**SafePath** is an end-to-end emergency notification, hyper-local geofencing, and real-time safe route navigation system designed for university campuses. Unlike traditional emergency systems (e.g., generic campus SMS or siren broadcasts), SafePath provides:

1. **Hyper-Local Incident Geofencing:** Pinpoints danger zones with precise circular geofences (configurable radius from 50m to 800m) across 12 disaster categories.
2. **Dynamic Safe Route Generation (A* Algorithm):** Computes evacuation paths from the user's current coordinates to the nearest reachable safe zone while dynamically repelling paths away from active hazard zones.
3. **Accessibility-Aware Evacuation:** Filters out stairs, selects wheelchair-accessible ramps, and recalculates evacuation transit times for mobility-impaired individuals.
4. **Resilient Mobile Computing Design:** Handles real-world mobile constraints including GPS multipath/indoor degradation, weak cellular connections (2G/3G), offline edge caching, and adaptive sensor duty-cycling to conserve battery life.
5. **Multi-Platform Support:** Native Android (Kotlin) mobile application paired with a real-time web portal (Emergency Operations Center Admin panel, Student client, and side-by-side presentation live demo).

---

## 2. Technology Stack & Tools Reference

### 2.1 Native Android Mobile Client
* **Programming Language:** Kotlin 2.0.21 (JVM Target 17)
* **Target Android SDK:** Android SDK 34 (Android 14) / Min SDK 26 (Android 8.0 Oreo)
* **Architecture:** MVVM (Model-View-ViewModel) + Clean Repository Pattern
* **UI Framework:** Android Jetpack (ViewBinding, ConstraintLayout, Material Components 1.12.0)
* **Location Services:** Google Play Services Location (`FusedLocationProviderClient` 21.3.0)
* **Mapping Engine:** Google Play Services Maps (Google Maps SDK 19.0.0)
* **Authentication:** Google Play Services Auth (Google Sign-In 21.2.0)
* **Asynchronous Concurrency:** Kotlin Coroutines & Flows (`kotlinx-coroutines-android` 1.8.1)
* **Background Processing:** Android Foreground Service (`LocationTrackingService`) with persistent status bar notification
* **HTTP Client & Parsing:** OkHttp 4.12.0 + Logging Interceptor, Google Gson 2.11.0

### 2.2 Server & Backend Infrastructure
* **Dual-Engine Architecture:**
  1. **Real-Time Node.js Microservice (`web/server.js`):** Lightweight, zero-external-dependency Node.js (v18+) engine providing REST APIs and Server-Sent Events (SSE) for sub-50ms message broadcast.
  2. **Kotlin Standalone Server Engine (`server/`):** JVM-based Kotlin service containing mathematical geofence models and graph algorithms.
* **Real-Time Protocol:** Server-Sent Events (SSE) via persistent HTTP streams (`text/event-stream`)
* **Containerization:** Docker (`Dockerfile` on `node:20-alpine`)

### 2.3 Web Application & Live Simulation Portal
* **Front-End Architecture:** Pure Vanilla JavaScript (ES6+ Class-based: `SafePathEngine`) with zero runtime bundler friction.
* **Geospatial Mapping:** Leaflet.js (v1.9.4) + OpenStreetMap raster tiles
* **Audio Alerts:** Web Audio API (Synthesized dual-tone 800Hz / 960Hz warbling emergency siren)
* **Offline Caching:** HTML5 `localStorage` (vector map topologies, safe havens, offline path calculation)
* **Simulation Suites:** Built-in GPS accuracy simulator, network latency/packet loss simulator, step-by-step walking simulation.

### 2.4 Build, Testing & Dependency Tools
* **Gradle:** Gradle Wrapper (8.9) with Kotlin DSL (`build.gradle.kts`)
* **Package Management:** NPM (Node Package Manager)
* **Testing & Benchmarks:** JUnit 4.13.2, AndroidX Test Runner, Android Profiler, Chrome DevTools Network & Sensor emulation.

---

## 3. High-Level Architecture & Component Topology

```
+-----------------------------------------------------------------------------------------+
|                                     SafePath System                                      |
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|   +------------------------------------+          +----------------------------------+  |
|   |   Admin Operations Center (EOC)    |          |       Student Mobile Client      |  |
|   | - 12 Emergency Category Selector   |          | - Google Auth Login              |  |
|   | - Lat/Lng & Radius Geofence Slider |          | - Real-Time Campus Map Display   |  |
|   | - Live Fleet GPS Tracker           |          | - Dual-Tone Audio Siren Alarm    |  |
|   | - Incident Resolution Controls     |          | - Dynamic A* Evacuation Route    |  |
|   +-----------------+------------------+          | - Accessibility Route Toggle     |  |
|                     |                             +-----------------+----------------+  |
|                     | REST (POST /api/alerts)                       |                   |
|                     v                                               | SSE & REST        |
|   +-----------------------------------------------------------------+----------------+  |
|   |                       SafePath Real-Time Server Engine                           |  |
|   |                                                                                  |  |
|   |   [ REST API Router ] <=======> [ SSE Event Broadcaster ]                        |  |
|   |           |                                    |                                 |  |
|   |           v                                    v                                 |  |
|   |   [ In-Memory User Registry ]          [ Active Hazard Spatial Index ]           |  |
|   |   (Students, Lat, Lng, Battery, Net)   (Center, Radius, Severity, Expiration)    |  |
|   +----------------------------------------------------------------------------------+  |
|                                         |                                               |
|                                         v                                               |
|               +------------------------------------------------------+                  |
|               |                  Campus Data Graph                   |                  |
|               |  - 10 Academic & Residential Buildings               |                  |
|               |  - 5 Designated Safe Zones (Assembly & Shelters)     |                  |
|               |  - 20 Interconnected Walkway Nodes & 28 Edges        |                  |
|               +------------------------------------------------------+                  |
+-----------------------------------------------------------------------------------------+
```

---

## 4. How SafePath Works: Core Subsystems

### 4.1 Geofencing & Emergency Alert Life Cycle
1. **Dispatch:** The Admin selects one of **12 emergency categories** (e.g., Wildfire, HazMat Spill, Flash Flood, Earthquake), configures coordinates and danger radius (50m–800m), and dispatches the alert.
2. **Instant Broadcast:** The server pushes the alert via **Server-Sent Events (SSE)** to all connected mobile and web clients within $<50\text{ms}$.
3. **Haversine Distance Evaluation:** Each client calculates its distance $d$ to the emergency epicenter:
   $$d = 2 R_{\text{earth}} \cdot \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)}\right)$$
4. **State Machine Transitions:**
   * **`IN HAZARD ZONE` ($d \le R_{\text{hazard}}$):** Screen flashes red alert banner, dual-tone audio siren activates, notification triggers, and the evacuation pathfinder automatically calculates escape route.
   * **`PROXIMITY WARNING` ($R_{\text{hazard}} < d \le R_{\text{hazard}} + 120\text{m}$):** Yellow advisory banner appears; GPS sampling frequency increases to high-precision tracking.
   * **`SAFE / ALL CLEAR` ($d > R_{\text{hazard}} + 120\text{m}$):** Green status; standard low-power sensor duty cycling.

### 4.2 Dynamic Hazard-Repulsion A* Pathfinding Engine
SafePath models the pedestrian walkway system as a weighted graph $G = (V, E)$. When finding an evacuation route:
1. **Target Selection:** Evaluates all campus safe zones and selects the optimal reachable safe haven based on network distance and hazard isolation.
2. **Dynamic Edge Cost Weighting:** Every edge $e = (u, v)$ is tested for intersection or proximity to active hazard circles $H_k$:
   $$W(e) = \text{Length}(e) + \text{Penalty}(e, H_k)$$
   * If edge crosses the hazard radius: $\text{Penalty} = 10^6$ (effectively blocked).
   * If edge passes within 100m proximity buffer: $\text{Penalty} = 5000 \cdot \left(1 - \frac{\text{dist} - R}{100}\right)$ (penalizes paths that skirt danger).
   * Otherwise: $\text{Penalty} = 0$.
3. **Accessibility Routing:** If the accessibility toggle is active, edges with `hasStairs == true` are completely pruned, ensuring only ramp-accessible routes are traversed, and estimated evacuation arrival times use $0.85\text{ m/s}$ mobility speed instead of $1.2\text{ m/s}$ pedestrian walking speed.

### 4.3 Mobile Computing Telemetry & Sensor Adaptation
* **GPS Uncertainty Modeling:** Emulates satellite precision across 3 real-world conditions:
  * *High Accuracy (GNSS L1/L5):* $\pm 3.5\text{m}$
  * *Urban Canyon (Tall Buildings):* $\pm 15.0\text{m}$
  * *Indoor / Subterranean:* $\pm 45.0\text{m}$
* **Network Connectivity Simulator:** Simulates network latency and packet loss across WiFi ($14\text{ms}$), 4G/LTE ($42\text{ms}$), 3G cellular ($248\text{ms}$), and complete Offline mode.
* **Offline Fallback Caching:** When offline, the application routes using locally cached graph topologies in `localStorage` / Room DB. Location pings queue locally and synchronize once cellular connection is restored.
* **Adaptive Battery Duty-Cycling:** Dynamically throttles location polling frequency:
  * Safe State: 60s intervals (power saving, $\approx 2.3\%/\text{hr}$ battery drain).
  * Warning State: 10s intervals.
  * Active Hazard State: 1s continuous GPS ($\approx 8.6\%/\text{hr}$ battery drain) for life safety.

---

## 5. Project Directory Structure

```
SafePathKotlin/
├── README.md                           # Quick-start guide & team overview
├── DOCUMENTATION.md                    # Comprehensive technical documentation
├── Dockerfile                          # Docker container configuration
├── package.json                        # Root NPM configuration
├── settings.gradle.kts                 # Gradle multi-project setup
├── build.gradle.kts                    # Root build configuration
│
├── web/                                # Web Platform & Node.js Server
│   ├── package.json                    # Web server dependencies
│   ├── server.js                       # Node.js REST API + SSE real-time server
│   └── public/                         # Client-side web application assets
│       ├── demo.html                   # Split-screen live presentation console
│       ├── admin.html                  # Admin Emergency Operations Center
│       ├── user.html                   # Student evacuation mobile interface
│       ├── index.html                  # Main project landing portal
│       ├── login.html                  # Google Auth login page
│       ├── app.js                      # Core SafePathEngine (A*, Leaflet, Audio)
│       ├── campus-data.json            # Campus graph (buildings, nodes, safe zones)
│       ├── style.css                   # Responsive UI & emergency theme
│       ├── leaflet.js / leaflet.css    # Offline mapping library assets
│
├── android/                            # Native Android Application (Kotlin)
│   ├── build.gradle.kts                # Android project build script
│   └── app/
│       ├── build.gradle.kts            # App-level dependencies & SDK configs
│       └── src/main/
│           ├── AndroidManifest.xml     # Permissions (GPS, Internet, Foreground Service)
│           └── java/edu/cpsc515/safepath/
│               ├── ui/                 # Activities (MainActivity, AdminBroadcast, Login)
│               ├── navigation/         # Native SafeRoutePathfinder (A* algorithm)
│               ├── service/            # LocationTrackingService (Foreground GPS)
│               ├── network/            # SafePathApiClient (OkHttp & SSE client)
│               ├── metrics/            # MobileComputingMetricsManager (Battery, Net)
│               └── data/model/         # Data models (EmergencyAlert, UserLocation, SafeZone)
│
├── server/                             # Standalone Kotlin JVM Server
│   ├── build.gradle.kts                # Kotlin server build configuration
│   └── src/main/kotlin/edu/cpsc515/safepath/server/
│       ├── service/                    # EmergencyGeofenceEngine & SafeRoutePathfinder
│       └── model/                      # DomainModels (Alerts, Nodes, Edges)
```

---

## 6. How to Run the System

### Option A: Live Web Demonstration (Recommended for instant testing)
1. Launch the Node.js server:
   ```bash
   node web/server.js
   ```
2. Open your web browser to:
   * **Split-Screen Demo (Admin + Student):** [http://localhost:3000/demo.html](http://localhost:3000/demo.html)
   * **Admin Emergency Operations Center:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
   * **Student Evacuation Map:** [http://localhost:3000/user.html](http://localhost:3000/user.html)

### Option B: Native Android Application
1. Open **Android Studio** (Hedgehog / Iguana / Jellyfish or newer).
2. Click **Open** and select the `/Users/dv/Desktop/SafePathKotlin/android` folder.
3. Allow Gradle to sync.
4. Run on an Android Emulator (API 26+) or a connected Android device with Developer Mode & USB Debugging enabled.
