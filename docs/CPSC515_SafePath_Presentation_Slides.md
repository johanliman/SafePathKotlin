# SafePath: Emergency Alert & Safe Route System
## CPSC 515 Mobile Computing — Final Presentation Slides & Live Demo Script

**Project Title:** SafePath: Intelligent Geofenced Campus Evacuation & Mobile Computing Telemetry  
**Group Members:** Daniel Wu, Johan Liman, Jie Chen, Yu-Cheng Chang, Siling Liu  
**Instructor:** CPSC 515 Mobile Computing Faculty  

---

### Slide 1: Title & Team Introductions
- **Project Title:** SafePath: Real-Time Geofenced Emergency Evacuation System
- **Speakers:**
  - Daniel Wu — UI/UX, Warning Banners, Accessibility Layouts
  - Johan Liman — Mobile Architecture, Fused GPS Tracking, Client-Server Sync
  - Jie Chen — Emergency Geofence Data Management, Spatial Indexing
  - Yu-Cheng Chang — Safe Route Pathfinding Engine (A* Hazard Repulsion)
  - Siling Liu — Mobile Computing Experimental Benchmarks & Network Telemetry
- **Key Problem:** Traditional emergency broadcasts blast entire regions with static text, lacking hyper-local geofencing, hazard-avoiding route guidance, and mobile-resilient connectivity handling.

---

### Slide 2: High-Level Architecture & Mobile Computing Focus
- **Two Ecosystems:**
  1. **Android Client (Kotlin):** FusedLocationProviderClient, Foreground Service, Google Maps, on-device A* graph traversal, Room DB offline cache.
  2. **Real-Time Web Platform:** Admin Operations Center + Student Client + Split Live Demo (`http://localhost:3000/demo.html`) with Server-Sent Events (SSE) and Web Audio synthesized sirens.
- **Mobile Computing Research Dimensions:**
  - GPS accuracy fluctuations (Open-sky $\pm 3\text{m}$ vs. Urban Canyon $\pm 15\text{m}$ vs. Indoor $\pm 46\text{m}$).
  - Network degradation resilience (Wi-Fi, 4G, Weak 2G/3G Cellular, Complete Offline mode).
  - Energy & Bandwidth optimization (Adaptive duty-cycling saving $73\%$ battery).

---

### Slide 3: 12 Emergency Alert Categories (Admin EOC)
- **Speaker:** Jie Chen / Daniel Wu
- **Categories Supported:**
  - Natural: Earthquake, Wildfire, Tsunami, Flood, Severe Thunderstorm, Volcano, High Wind, Extreme Heat.
  - Man-Made & Technological: Hazardous Materials (HazMat) Spill, Radiation Threat, Severe Air Quality (AQI > 300), Public Health Emergency.
- **Admin Capabilities:**
  - One-click scenario dispatch.
  - Interactive map click for epicenter coordinates.
  - Dynamic geofence radius slider (50m to 800m).
  - Live Student Fleet tracking: real-time GPS coordinates, battery levels, network link status, and safety state (SAFE vs. IN HAZARD).

---

### Slide 4: Real-Time Geofencing & Google Sign-In
- **Speaker:** Daniel Wu / Johan Liman
- **User Experience:**
  - University Google Email sign-in (`@csu.fullerton.edu`).
  - Interactive location repositioning: Drag marker anywhere on campus or select campus buildings to test proximity.
  - Boundary crossing trigger:
    - Within radius $\rightarrow$ Pulsing red banner, synthesized audio siren, vibration sequence.
    - Proximity buffer ($+120\text{m}$) $\rightarrow$ Yellow cautionary advisory.

---

### Slide 5: Safe Route Generation Algorithm (A*)
- **Speaker:** Yu-Cheng Chang
- **Algorithmic Innovation:**
  - Dynamic cost function: $W(e) = \text{Length}(e) + \text{HazardPenalty}(e)$.
  - Edges intersecting or nearing active hazard circles receive infinite/heavy penalty weights, compelling the pathfinder to route around contaminated zones.
  - Automatic nearest safe haven selection (e.g., North Quad Assembly Field vs. East Perimeter Triage vs. West Athletics High-Ground Shelter).
  - **Accessibility Mode:** Discards paths with stairs (`hasStairs == true`), guides via wheelchair ramps, and recalculates evacuation walking times at $0.85\text{ m/s}$.

---

### Slide 6: Mobile Computing Experimental Results
- **Speaker:** Siling Liu
- **Key Findings from Controlled Experiments:**
  - **Alert Latency:** $13.8\text{ ms}$ over Wi-Fi; $41.5\text{ ms}$ over 4G; $246.2\text{ ms}$ over weak 3G; instantaneous on cached devices.
  - **GPS Accuracy Impact:** Dual-frequency outdoor GPS achieves $\pm 3.2\text{m}$ ($0\%$ false alarms); indoor attenuation ($\pm 46.5\text{m}$) requires our $120\text{m}$ hysteresis buffer to eliminate false alarms.
  - **Battery Drain Optimization:** Switching from continuous 1 Hz tracking ($8.6\%/\text{hr}$) to adaptive duty cycling ($2.3\%/\text{hr}$) extends device operating lifespan by $73\%$.
  - **Offline Resilience:** With zero network signal, client successfully calculates evacuation routes using local vector graphs.

---

### Slide 7: Live Demonstration Walkthrough (Split Demo)
- **Live Demo Protocol (Open `http://localhost:3000/demo.html`):**
  1. **Step 1:** Show Left Panel (Admin EOC) and Right Panel (Student Device) side-by-side.
  2. **Step 2:** Click **"☣️ Chem Spill"** preset on Left Panel (McCarthy Science Hall, 220m radius) and click **"Dispatch Alert Now"**.
  3. **Step 3:** Watch Right Panel immediately receive the SSE broadcast, sound the audio siren, flash the red hazard alert, and render the green dashed safe evacuation route to North Quad.
  4. **Step 4:** Click **"Walk Through Hazard"** or drag student pin outside the red circle to demonstrate live re-routing and all-clear resolution.
  5. **Step 5:** Toggle **"♿ Ramps Only"** to demonstrate step-free accessibility routing.
  6. **Step 6:** Toggle **"Weak Cellular"** or **"Offline"** in the telemetry dock to demonstrate offline resilience and queued location synchronization.

---

### Slide 8: Conclusion & Future Work
- **Summary:** SafePath bridges mobile computing, distributed systems, and emergency management into a unified Kotlin/Web platform.
- **Future Enhancements:**
  - 3D indoor multi-floor barometric altimeter tracking.
  - Pedestrian crowd density heatmap integration to avoid choke-points.
  - Peer-to-peer Wi-Fi Direct / BLE mesh fallback when cell infrastructure fails.
- **Q&A Session.**
