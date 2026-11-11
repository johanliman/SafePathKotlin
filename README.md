# SafePath

Project Team:
- Daniel Wu
- Johan Liman
- Jie Chen
- Yu-Cheng Chang
- Siling Liu

---

## 🚀 Quick Start: Live Web Application Demo

The full live web application is hosted online at **[https://safepath-live.onrender.com](https://safepath-live.onrender.com/)** (and can also run locally at `http://localhost:3000`).

| Interface | Cloud Live URL | Local URL | Description |
| :--- | :--- | :--- | :--- |
| **⚡ Split Live Demo** | [https://safepath-live.onrender.com/demo.html](https://safepath-live.onrender.com/demo.html) | [http://localhost:3000/demo.html](http://localhost:3000/demo.html) | **Recommended for presentation:** Side-by-side view with Admin EOC on the Left and Student Mobile Device on the Right! |
| **🛡️ Admin Operations Center** | [https://safepath-live.onrender.com/admin.html](https://safepath-live.onrender.com/admin.html) | [http://localhost:3000/admin.html](http://localhost:3000/admin.html) | Dispatch emergency alerts (12 types), configure Lat/Lng & radius, monitor student fleet. |
| **📱 Student Mobile App** | [https://safepath-live.onrender.com/user.html](https://safepath-live.onrender.com/user.html) | [http://localhost:3000/user.html](http://localhost:3000/user.html) | Google Email Registration and Auth, live map, drag pin/teleport, walking simulation, audio siren, safe route A*. |
| **🏠 Portal Homepage** | [https://safepath-live.onrender.com/](https://safepath-live.onrender.com/) | [http://localhost:3000/](http://localhost:3000/) | System overview and application portal. |

To restart the server at any time:
```bash
node web/server.js
```

---

## 🌟 Key Features Implemented

### 1. 12 Supported Emergency Categories
Full operational safety profiles for all 12 disaster categories:
1. 🌊 **Tsunami Warning** (Vertical high-ground evacuation)
2. 🏚️ **Earthquake Alert** (Drop, Cover, Hold on; open quad assembly)
3. 🔥 **Wildfire Evacuation** (Downwind egress, perimeter triage)
4. ☀️ **Extreme Heat Advisory** (Indoor cooling hubs & hydration)
5. 🌧️ **Flash Flood Warning** (Waterway and low-lying avoidance)
6. ⚡ **Severe Thunderstorm / Lightning** (Enclosed structural shelter)
7. 💨 **High Wind Hazard** (Flying debris avoidance)
8. 🌋 **Volcanic Ash / Pyroclastic Alert** (HEPA-filtered shelters)
9. ☣️ **Hazardous Materials (HazMat) Spill** (Upwind vapor avoidance)
10. 🌫️ **Severe Air Quality Emergency** (AQI > 300 protocol)
11. ☢️ **Radiation Threat / Incident** (Subterranean shielding shelter)
12. 🏥 **Public Health Emergency** (Biocontainment & triage)

### 2. Admin Operations Center & Student Mobile Client
- **Admin Panel:**
  - Emergency Alert Dispatcher with customizable Latitude, Longitude, and Radius slider (50m to 800m).
  - Quick scenario buttons: *Chem Spill*, *Wildfire*, *Earthquake*, *Flash Flood*.
  - Live Student Fleet Map: Real-time visual tracking of connected students, their safety status (`SAFE` vs `IN HAZARD`), battery %, and network status.
  - Active Alerts Management with instant resolution / cancellation.
- **Student Panel:**
  - Google Email Registration and Auth
  - **Location Changing & Relocation:**
    - Drag user marker anywhere on campus.
    - Click anywhere on the map to relocate.
    - Quick teleport dropdown to campus buildings (Library, Science Hall, Student Union, Dorms).
    - **Walking Simulation Mode:** Step-by-step animation moving a student into and out of hazard zones to test geofencing alarms and re-routing.
  - **Emergency Alarm & Audio Siren:**
    - Real-time synthesized dual-tone siren via Web Audio API.
    - Pulsing red danger banner showing distance to danger epicenter.
  - **Safe Route Generator (A* Algorithm):**
    - Dynamically avoids paths intersecting the hazard circle.
    - Computes real-time walking distance (meters) and estimated walking time (minutes).
    - Turn-by-turn evacuation navigation.
    - **Accessibility-Aware Route Toggle:** Avoids stairs (`hasStairs == true`), prioritizes ramps, and adjusts walking speed for wheelchairs.

### 3. Mobile Computing Research & Evaluation Indicators
- **📶 Network Connectivity Simulator:**
  - Toggle between `WiFi` (high speed, <15ms latency), `4G/5G` (medium latency), `Weak Cellular (2G/3G)` (high jitter and simulated packet loss), and `Offline Mode`.
  - **Offline Caching:** Caches campus vector maps and safe zones in `localStorage` / Room DB. When offline, routes are calculated on-device and location updates queue until reconnected.
- **🎯 GPS Accuracy Simulator:**
  - Toggle between `High Accuracy` ($\pm 3.5\text{m}$ outdoor GPS L1/L5), `Urban Canyon` ($\pm 15.0\text{m}$ between tall buildings), and `Indoor / Subterranean` ($\pm 45.0\text{m}$ multipath).
  - Real-time visual uncertainty circle on the map.
- **⚡ Alert Latency Instrumentation:** Real-time roundtrip timestamp difference (ms) from Admin dispatch to student reception.
- **🔋 Battery Consumption Estimator:** Simulated discharge rate (%/hour) modeled on GPS polling frequency (1s continuous vs 10s balanced vs 60s power-saver).
- **📦 Bandwidth Consumption Monitor:** Real-time tracker for cumulative bytes sent and received.
- **👥 Multi-User Fleet Scalability:** Live fleet table and map markers for multiple concurrent campus users.

---

## 📱 Android Mobile Application (Kotlin)

The native Android project is located under `android/`:
- **Language:** Kotlin 2.0.21
- **Architecture:** MVVM + Clean Repository Pattern
- **Key Files:**
  - `MainActivity.kt`: Interactive map, Google Sign-in, safe route display, and mobile computing indicator dock.
  - `AdminBroadcastActivity.kt`: Android Admin dispatch interface.
  - `SafeRoutePathfinder.kt`: Native Kotlin A* algorithm avoiding hazard zones.
  - `LocationTrackingService.kt`: Android Foreground Service with GPS Fused Location and local notification alarms.
  - `MobileComputingMetricsManager.kt`: Live battery, network quality, and GPS accuracy instrumentation.
- **To Open & Run:**
  1. Open Android Studio.
  2. Select **Open** and choose `/Users/dv/Desktop/SafePathKotlin/android`.
  3. Sync Gradle and run on Android Emulator or connected physical device.
