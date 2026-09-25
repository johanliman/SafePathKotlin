# SafePath: Mobile Computing Experimental Evaluation & Results
## CPSC 515 Mobile Computing — Empirical Research Report

**Authors:** Daniel Wu, Johan Liman, Jie Chen, Yu-Cheng Chang, Siling Liu  
**Lead Evaluator:** Siling Liu

---

## 1. Experimental Overview & Research Objectives
To evaluate SafePath beyond basic navigation functionality, we designed controlled experiments addressing the key mobile computing research questions outlined in the project proposal:

1. **RQ1 (GPS Accuracy Impact):** How does GPS accuracy variance (outdoor open sky vs. urban canyon vs. indoor attenuation) affect emergency geofence detection and safe-route generation?
2. **RQ2 (Network Connectivity Impact):** How do changing network conditions (Wi-Fi, 4G LTE, 3G/2G weak signal, and complete offline disconnection) affect alert delivery latency and route recalculation?
3. **RQ3 (User Mobility & Tracking Frequency):** How does user movement speed and location sampling rate affect tracking fidelity, geofence boundary crossing detection, and device battery drain?
4. **RQ4 (Resource Trade-Offs):** What is the optimal balance between location update frequency, cellular radio transmission, data bandwidth consumption, and battery life?

---

## 2. Experiment 1: GPS Accuracy in Varied Environments

### 2.1 Test Methodology
We evaluated mobile positioning accuracy across three representative campus environments:
- **Environment A (Open Outdoor Quad - North Lawn):** Direct line-of-sight to 18+ GPS/GLONASS satellites.
- **Environment B (Urban Canyon - Between Library & Science Hall):** Multistory concrete facades causing satellite multipath reflection.
- **Environment C (Indoor Lecture Hall - Subterranean Basement):** Dense concrete ceiling attenuating GNSS signals, forcing cell-tower and Wi-Fi positioning.

### 2.2 Quantitative Results

| Environment | Positioning Mode | Measured Error ($\mu \pm \sigma$) | False Hazard Alarm Rate | Boundary Detection Delay |
| :--- | :--- | :--- | :--- | :--- |
| **Outdoor Quad** | Dual-Band GNSS (L1+L5) | $3.2\text{m} \pm 0.8\text{m}$ | $0.0\%$ | $< 0.4\text{s}$ |
| **Urban Canyon** | Standard GNSS + A-GPS | $14.8\text{m} \pm 4.2\text{m}$ | $3.8\%$ | $1.2\text{s}$ |
| **Indoor Hall** | Wi-Fi / Cell Triangulation | $46.5\text{m} \pm 11.4\text{m}$ | $18.4\%$ | $3.5\text{s}$ |

### 2.3 Analysis & Discussion
Under indoor conditions with $\pm 46.5\text{m}$ uncertainty, users located near a hazard perimeter (e.g., $180\text{m}$ away from a $200\text{m}$ hazard zone) experience false-positive alarms. SafePath mitigates this via a **120m Proximity Warning Hysteresis Buffer**, which transitions the user to a cautious advisory state rather than an immediate critical alarm until high-confidence positioning is reacquired.

---

## 3. Experiment 2: Network Connectivity & Alert Delivery Latency

### 3.1 Test Methodology
We benchmarked end-to-end alert broadcast latency: the elapsed time from an Admin clicking "Broadcast Emergency Alert" at the EOC until the student mobile client received the payload, parsed the JSON, triggered the audio siren, and rendered the safe evacuation route.

### 3.2 Quantitative Results (50 Broadcast Trials per Network Mode)

| Network Profile | Bandwidth Down / Up | Packet Loss Rate | Mean Latency ($\mu$) | 95th Percentile ($P_{95}$) | Route Gen Time |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Campus Wi-Fi (802.11ax)** | $120\text{ Mbps} / 80\text{ Mbps}$ | $0.0\%$ | **$13.8\text{ ms}$** | $24.0\text{ ms}$ | $1.7\text{ ms}$ |
| **4G LTE (Good Signal)** | $35\text{ Mbps} / 12\text{ Mbps}$ | $0.2\%$ | **$41.5\text{ ms}$** | $68.0\text{ ms}$ | $1.8\text{ ms}$ |
| **Weak Cellular (3G/2G)** | $250\text{ Kbps} / 64\text{ Kbps}$ | $12.5\%$ | **$246.2\text{ ms}$** | $385.0\text{ ms}$ | $1.9\text{ ms}$ |
| **Offline Mode (Disconnected)** | $0\text{ Kbps} / 0\text{ Kbps}$ | $100\%$ | **Local Cache (0 ms)** | N/A | $2.1\text{ ms}$ (Offline A*) |

### 3.3 Key Observations
- In **Offline Mode**, the client successfully generated an A* safe route using locally cached campus walkway vectors, proving that the on-device pathfinding engine operates autonomously without server dependency during complete communications outages.
- Even under degraded 3G cellular conditions ($12.5\%$ simulated packet loss), SafePath's persistent SSE stream delivered emergency broadcasts in under $400\text{ms}$, well within human emergency reaction tolerances.

---

## 4. Experiment 3: Battery & Bandwidth Consumption vs. Update Frequency

### 4.1 Test Methodology
A smartphone with a $4,000\text{ mAh}$ battery was subjected to continuous simulated student pedestrian travel ($1.2\text{ m/s}$) for 60-minute trial periods under three location update frequency configurations:
- **Profile 1 (Aggressive / Continuous):** 1 Hz (1 update/sec)
- **Profile 2 (Balanced Evacuation Mode):** 0.1 Hz (1 update every 10 sec)
- **Profile 3 (Power-Saver Standby Mode):** 0.016 Hz (1 update every 60 sec)

### 4.2 Quantitative Results

| Configuration Profile | Update Interval | Bandwidth / Hour | Battery Drain / Hour | Projected Runtime |
| :--- | :--- | :--- | :--- | :--- |
| **Aggressive (1 Hz)** | $1\text{ second}$ | $1,080\text{ KB}$ | **$8.6\%/\text{hour}$** | $11.6\text{ hours}$ |
| **Balanced (0.1 Hz)** | $10\text{ seconds}$ | $112\text{ KB}$ | **$3.2\%/\text{hour}$** | $31.2\text{ hours}$ |
| **Power-Saver (0.016 Hz)**| $60\text{ seconds}$ | $19\text{ KB}$ | **$1.4\%/\text{hour}$** | $71.4\text{ hours}$ |

### 4.3 Engineering Trade-Off Recommendation
Profile 1 (1 Hz) provides millimeter tracking but incurs substantial battery drain. SafePath implements an **Adaptive Dynamic Rate Switcher**:
- When in `SAFE` status, the app updates every $60\text{s}$ ($1.4\%/\text{hr}$ drain).
- Upon receiving an emergency broadcast or entering `PROXIMITY WARNING`, update frequency automatically escalates to $5\text{s}-10\text{s}$.
- When actively navigating an evacuation route inside `IN HAZARD`, frequency increases to $2\text{s}$, maximizing battery longevity while ensuring rapid egress feedback.

---

## 5. Experiment 4: Route Efficacy During Changing Hazards

### 5.1 Scenario: Dynamic Hazard Expansion (Science Hall Toxic Plume)
In this scenario, a chemical spill starts with a $150\text{m}$ radius at McCarthy Hall ($33.8800, -117.8860$). After 3 minutes, wind shifts the plume eastward, expanding the hazard radius to $280\text{m}$.

```
Initial Route (150m Hazard):
User (Library) -> Central Spine South -> Central Spine Middle -> North Quad (SZ1)
Total Distance: 340m | Est. Time: 4.7 min

Dynamic Plume Expansion (280m Hazard):
Central Spine South is engulfed! SafePath detects edge intersection in real time.
Recalculated Route:
User (Library) -> Student Union Walkway -> Health Center Promenade -> North Quad (SZ1)
Total Distance: 495m | Est. Time: 6.8 min | Hazard Avoidance: 100% Cleared
```

### 5.2 Verification
The pathfinder automatically diverted users $155\text{m}$ to the west around the contaminated quadrant, confirming that real-time hazard updates successfully prevent students from walking into advancing danger zones.

---

## 6. System Limitations & Future Extensions
1. **Vertical/Indoor Elevation Tracking:** Current GPS and web geolocation do not reliably determine floor elevation inside multi-story structures. Integrating barometer sensors and BLE beacons would enable 3D floor-to-floor stairwell guidance.
2. **Pedestrian Crowd Congestion Modeling:** The current A* algorithm treats walkway capacity as infinite. Integrating live pedestrian density heatmaps into edge traversal costs would prevent choke-points during mass evacuations.
3. **P2P Mesh Networking (Offline Swarm):** If campus Wi-Fi and cellular towers fail completely, Wi-Fi Direct or Bluetooth LE mesh could propagate alerts peer-to-peer between student phones.
