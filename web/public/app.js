// SafePath - Clean, Simple Emergency Navigation & Evacuation Engine
// CPSC 515 Mobile Computing

class SafePathEngine {
  constructor(options = {}) {
    this.role = options.role || 'user'; // 'user', 'admin', or 'demo'
    this.mapId = options.mapId || 'user-map';

    // Campus Students with distinct fixed positions (the 5 official student users)
    this.students = [
      { email: "johaliman@csu.fullerton.edu", name: "Johan", lat: 33.8802, lng: -117.8858 },
      { email: "d.wu@csu.fullerton.edu", name: "Daniel", lat: 33.8813, lng: -117.8854 },
      { email: "yu-cheng.chang@csu.fullerton.edu", name: "Yu", lat: 33.8820, lng: -117.8885 },
      { email: "jchen102951@csu.fullerton.edu", name: "Jie", lat: 33.8829, lng: -117.8828 },
      { email: "siling313@csu.fullerton.edu", name: "Siling", lat: 33.8835, lng: -117.8870 }
    ];

    // Selected Active Student
    let storedUser = null;
    try {
      const raw = localStorage.getItem('safepath_user');
      if (raw) storedUser = JSON.parse(raw);
    } catch(e) {}

    const initialEmail = options.email || (storedUser && storedUser.email) || localStorage.getItem('safepath_user_email') || "johaliman@csu.fullerton.edu";
    let initialUser = this.students.find(s => s.email === initialEmail);
    if (!initialUser && storedUser) {
      initialUser = {
        email: storedUser.email,
        name: storedUser.name || storedUser.email.split('@')[0],
        lat: storedUser.latitude || 33.8820,
        lng: storedUser.longitude || -117.8850
      };
      this.students.push(initialUser);
    }
    if (!initialUser) initialUser = this.students[0];

    this.userEmail = initialUser.email;
    this.userName = options.name || (storedUser && storedUser.name) || initialUser.name;
    this.userLat = options.lat || (storedUser && storedUser.latitude) || initialUser.lat;
    this.userLng = options.lng || (storedUser && storedUser.longitude) || initialUser.lng;

    this.campusData = null;
    this.map = null;
    this.userMarker = null;
    this.adminPinMarker = null;
    this.adminPreviewCircle = null;
    this.otherStudentMarkers = new Map();
    this.hazardCircles = new Map();
    this.safeZoneMarkers = new Map();
    this.activeRoutePolyline = null;
    this.activeAlerts = [];
    this.accessibilityMode = false;
    this.lastNotifiedAlertId = null;
    this.pollInterval = null;
    this.isNavigating = false;

    this.init();
  }

  async init() {
    await this.loadCampusData();
    await this.syncFleetFromServer();
    this.initMap();
    this.connectSSE();
    this.startPollingFallback();
    await this.refreshActiveAlerts();

    // Initial state check
    this.renderAllStudentsOnMap();
    this.computeSafeRoute();
  }

  async syncFleetFromServer() {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.users) {
        data.users.forEach(u => {
          const st = this.students.find(s => s.email === u.email);
          if (st) {
            st.lat = parseFloat(u.latitude);
            st.lng = parseFloat(u.longitude);
            st.status = u.status;
            st.name = u.name;
            if (u.distanceMeters !== undefined) st.distanceMeters = u.distanceMeters;
            if (u.estMinutes !== undefined) st.estMinutes = u.estMinutes;
            if (u.targetHaven !== undefined) st.targetHaven = u.targetHaven;
          } else if (u.role !== 'Admin' && u.email !== 'admin@safepath.com') {
            this.students.push({
              email: u.email,
              name: u.name,
              lat: parseFloat(u.latitude),
              lng: parseFloat(u.longitude),
              status: u.status || 'NORMAL',
              distanceMeters: u.distanceMeters,
              estMinutes: u.estMinutes,
              targetHaven: u.targetHaven
            });
          }
        });
        if (this.role === 'user') {
          const me = this.students.find(s => s.email === this.userEmail);
          if (me) {
            this.userLat = me.lat;
            this.userLng = me.lng;
          }
        }
      }
    } catch (e) {
      console.warn('Fleet sync error:', e);
    }
  }

  async loadCampusData() {
    try {
      const res = await fetch('/api/campus');
      this.campusData = await res.json();
    } catch (e) {
      console.warn('Campus data fetch error:', e);
    }
  }

  initMap() {
    const mapElement = document.getElementById(this.mapId);
    if (!mapElement) return;

    this.map = L.map(this.mapId, {
      center: [this.userLat, this.userLng],
      zoom: 16,
      zoomControl: true,
      doubleClickZoom: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Add Compass Rose Sign to top-right of map for easy reading & orientation
    this.addCompassControl();

    this.renderAllStudentsOnMap();

    // Map click to change location or pin epicenter
    this.map.on('click', (e) => {
      if (this.role === 'user') {
        this.setUserLocation(e.latlng.lat, e.latlng.lng);
      } else if (this.role === 'admin') {
        this.setAdminPin(e.latlng.lat, e.latlng.lng);
      } else if (this.role === 'demo') {
        if (this.mapId === 'split-admin-map') {
          this.setAdminPin(e.latlng.lat, e.latlng.lng);
        } else {
          this.setUserLocation(e.latlng.lat, e.latlng.lng);
        }
      }
    });

    // Feature: Double click on map to remove epicenter pin
    this.map.on('dblclick', (e) => {
      if (this.role === 'admin' || (this.role === 'demo' && this.mapId === 'split-admin-map')) {
        this.clearAdminPin();
      }
    });

    // Auto-place initial epicenter pin on admin map ONLY if NO alert is currently active!
    // "When already have already, hide another epicenter pin since it can be confusing."
    if ((this.role === 'admin' || (this.role === 'demo' && this.mapId === 'split-admin-map')) && this.activeAlerts.length === 0) {
      const latInput = document.getElementById('admin-lat') || document.getElementById('split-admin-lat');
      const lngInput = document.getElementById('admin-lng') || document.getElementById('split-admin-lng');
      const initLat = latInput ? parseFloat(latInput.value) : 33.8800;
      const initLng = lngInput ? parseFloat(lngInput.value) : -117.8860;
      this.setAdminPin(initLat, initLng);
    }
  }

  // --- COMPASS ROSE CONTROL (North, South, East, West Navigation Indicator) ---
  addCompassControl() {
    if (!this.map) return;
    const CompassControl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function() {
        const div = L.DomUtil.create('div', 'leaflet-compass-widget');
        div.setAttribute('title', 'Compass: North is Up (▲ N)');
        div.innerHTML = `
          <div style="background: rgba(255, 255, 255, 0.96); border-radius: 50%; width: 46px; height: 46px; display: flex; flex-direction: column; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.12); border: 1.5px solid #cccccc; user-select: none; pointer-events: auto; cursor: default; margin-top: 4px; margin-right: 4px;">
            <div style="font-size: 10px; font-weight: 900; color: #121212; line-height: 1; margin-top: 1px;">▲ N</div>
            <div style="display: flex; justify-content: space-between; align-items: center; width: 34px; font-size: 8px; font-weight: 800; color: #666666; line-height: 1;">
              <span>W</span>
              <div style="width: 3px; height: 3px; background: #121212; border-radius: 50%;"></div>
              <span>E</span>
            </div>
            <div style="font-size: 8px; font-weight: 800; color: #888888; line-height: 1; margin-bottom: 1px;">▼ S</div>
          </div>
        `;
        return div;
      }
    });
    this.map.addControl(new CompassControl());
  }

  // Clear draft epicenter pin when alert is already active / broadcasted or double-clicked
  clearAdminPin() {
    if (this.adminPinMarker && this.map) {
      this.map.removeLayer(this.adminPinMarker);
      this.adminPinMarker = null;
    }
    if (this.adminPreviewCircle && this.map) {
      this.map.removeLayer(this.adminPreviewCircle);
      this.adminPreviewCircle = null;
    }
  }

  // --- ADMIN MAP PINNING & DYNAMIC GEOFENCE PREVIEW ---
  setAdminPin(lat, lng, radius = null) {
    if (!this.map) return;

    if (radius === null) {
      const radiusInput = document.getElementById('admin-radius') || document.getElementById('split-admin-radius');
      radius = radiusInput ? parseFloat(radiusInput.value) : 200;
    }

    const latInput = document.getElementById('admin-lat') || document.getElementById('split-admin-lat');
    const lngInput = document.getElementById('admin-lng') || document.getElementById('split-admin-lng');
    if (latInput) latInput.value = Number(lat).toFixed(4);
    if (lngInput) lngInput.value = Number(lng).toFixed(4);

    const pinHtml = `
      <div style="position:relative; cursor:grab;" title="Double-click to remove epicenter pin">
        <div style="background:#121212; width:34px; height:34px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 2px 10px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; color:#fff; font-size:16px;">
          🎯
        </div>
        <div style="position:absolute; top:-26px; left:-55px; background:#121212; color:#ffffff; font-size:10px; font-weight:700; padding:2px 8px; border-radius:4px; border:1px solid #ffffff; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.25);">
          📍 EPICENTER PIN
        </div>
      </div>
    `;

    const pinIcon = L.divIcon({
      html: pinHtml,
      className: 'admin-epicenter-pin',
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });

    if (this.adminPinMarker) {
      this.adminPinMarker.setLatLng([lat, lng]);
    } else {
      this.adminPinMarker = L.marker([lat, lng], {
        icon: pinIcon,
        draggable: true,
        zIndexOffset: 3000
      }).addTo(this.map);

      // Feature: Double click on epicenter pin directly to remove it
      this.adminPinMarker.on('dblclick', (e) => {
        if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
        this.clearAdminPin();
      });

      this.adminPinMarker.on('drag', (e) => {
        const pos = e.target.getLatLng();
        if (latInput) latInput.value = pos.lat.toFixed(4);
        if (lngInput) lngInput.value = pos.lng.toFixed(4);
        if (this.adminPreviewCircle) {
          this.adminPreviewCircle.setLatLng(pos);
        }
      });

      this.adminPinMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        this.setAdminPin(pos.lat, pos.lng);
      });
    }

    if (this.adminPreviewCircle) {
      this.adminPreviewCircle.setLatLng([lat, lng]);
      this.adminPreviewCircle.setRadius(radius);
    } else {
      this.adminPreviewCircle = L.circle([lat, lng], {
        radius: radius,
        color: '#121212',
        dashArray: '6, 6',
        fillColor: '#121212',
        fillOpacity: 0.12,
        weight: 2
      }).addTo(this.map);
      this.adminPreviewCircle.bindPopup(`<strong>📍 Hazard Geofence Preview</strong><br/>Radius: ${radius}m<br/><em>Click to set epicenter, double-click to remove pin</em>`);
    }
  }

  updateAdminPreviewRadius(radius) {
    if (this.adminPreviewCircle) {
      this.adminPreviewCircle.setRadius(radius);
    }
  }

  // --- MULTI-USER RENDERING: ALL 5 STUDENTS VISIBLE ON MAP ---
  renderAllStudentsOnMap() {
    if (!this.map) return;

    // Clear previous other student markers
    for (const [email, marker] of this.otherStudentMarkers.entries()) {
      this.map.removeLayer(marker);
    }
    this.otherStudentMarkers.clear();

    // CASE A: ADMIN OPERATIONS PANEL (Shows ALL 5 fleet students with live coordinates)
    if (this.role === 'admin') {
      if (this.userMarker) {
        this.map.removeLayer(this.userMarker);
        this.userMarker = null;
      }

      this.students.forEach(student => {
        const isStudentInDanger = this.isLocationInHazard(student.lat, student.lng);
        const markerBg = isStudentInDanger ? '#121212' : '#ffffff';
        const markerColor = isStudentInDanger ? '#ffffff' : '#121212';
        const borderColor = isStudentInDanger ? '#ffffff' : '#121212';

        const adminHtml = `
          <div style="position:relative;">
            <div style="background:${markerBg}; color:${markerColor}; width:26px; height:26px; border-radius:50%; border:2px solid ${borderColor}; box-shadow:0 2px 6px rgba(0,0,0,0.25); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold;">
              👤
            </div>
            <div style="position:absolute; top:-24px; left:-32px; background:#121212; color:#fff; font-size:10px; font-weight:700; padding:2px 7px; border-radius:4px; border:1px solid #fff; white-space:nowrap; box-shadow:0 2px 4px rgba(0,0,0,0.3);">
              ${student.name.split(' ')[0]} ${isStudentInDanger ? '⚠️' : '✓'}
            </div>
          </div>
        `;

        const icon = L.divIcon({
          html: adminHtml,
          className: 'admin-student-pin',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const marker = L.marker([student.lat, student.lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
        marker.bindPopup(`
          <strong>🧑 ${student.name}</strong><br/>
          GPS: <code>${student.lat.toFixed(4)}, ${student.lng.toFixed(4)}</code><br/>
          Status: <strong>${isStudentInDanger ? '⚠️ IN HAZARD' : '✓ SAFE'}</strong><br/>
          Distance to Haven: <strong>${student.distanceMeters !== undefined ? student.distanceMeters + 'm' : 'Calculating...'}</strong>
        `);
        this.otherStudentMarkers.set(student.email, marker);
      });

      this.renderSafeZoneMarkers();
      return;
    }

    // CASE B: USER & DEMO PANELS (Active student shown as "YOU", other 4 as fleet students)
    if (!this.isNavigating) {
      // 1. Render Active User (YOU) with prominent Black & White Marker
      const isYouInHazard = this.isLocationInHazard(this.userLat, this.userLng);

      const userHtml = `
        <div style="position:relative;">
          <div style="background:#121212; width:28px; height:28px; border-radius:50%; border:3px solid #ffffff; box-shadow:0 2px 10px rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; font-weight:bold;">
            📍
          </div>
          <div style="position:absolute; top:-26px; left:-42px; background:#121212; color:#fff; font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; border:1px solid #ffffff; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.3);">
            YOU: ${this.userName.split(' ')[0]} ${isYouInHazard ? '⚠️' : '✓'}
          </div>
        </div>
      `;

      const userIcon = L.divIcon({
        html: userHtml,
        className: 'active-user-pin',
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      if (this.userMarker) {
        this.userMarker.setLatLng([this.userLat, this.userLng]);
        this.userMarker.setIcon(userIcon);
      } else {
        this.userMarker = L.marker([this.userLat, this.userLng], {
          icon: userIcon,
          draggable: true,
          zIndexOffset: 2000
        }).addTo(this.map);

        this.userMarker.on('dragend', (e) => {
          const pos = e.target.getLatLng();
          this.setUserLocation(pos.lat, pos.lng);
        });
      }
    }

    // 2. Render OTHER Students simultaneously (ONLY in Admin or Split Demo mode, NEVER in Student Personal View)
    if (this.role !== 'user') {
      this.students.forEach(student => {
        if (student.email === this.userEmail) return;

        const isStudentInDanger = this.isLocationInHazard(student.lat, student.lng);

        const otherHtml = `
          <div style="position:relative; cursor:pointer;" onclick="window.safePathApp.switchActiveUser('${student.email}')">
            <div style="background:#ffffff; width:22px; height:22px; border-radius:50%; border:1.5px solid #121212; display:flex; align-items:center; justify-content:center; color:#121212; font-size:11px; box-shadow:0 1px 4px rgba(0,0,0,0.2);">
              👤
            </div>
            <div style="position:absolute; top:-22px; left:-30px; background:#ffffff; color:#121212; font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; border:1px solid #cccccc; white-space:nowrap;">
              ${student.name.split(' ')[0]} ${isStudentInDanger ? '⚠️' : ''}
            </div>
          </div>
        `;

        const otherIcon = L.divIcon({
          html: otherHtml,
          className: 'other-student-pin',
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        const marker = L.marker([student.lat, student.lng], { icon: otherIcon, zIndexOffset: 500 }).addTo(this.map);
        marker.bindPopup(`
          <strong>🧑 ${student.name}</strong><br/>
          Status: <strong>${isStudentInDanger ? '⚠️ IN HAZARD' : '✓ SAFE'}</strong><br/>
          <button style="margin-top:6px; padding:4px 8px; font-size:11px; cursor:pointer; background:#121212; color:#fff; border:none; border-radius:4px;" onclick="window.safePathApp.switchActiveUser('${student.email}')">
            Switch to ${student.name}
          </button>
        `);

        this.otherStudentMarkers.set(student.email, marker);
      });
    }

    // 3. Render Safe Zone Icons ONLY if an emergency is active!
    this.renderSafeZoneMarkers();
  }

  renderSafeZoneMarkers() {
    // Clear old safe zones
    for (const [id, marker] of this.safeZoneMarkers.entries()) {
      this.map.removeLayer(marker);
    }
    this.safeZoneMarkers.clear();

    // If NO emergency alert is active, do not clutter the map with giant safe haven markers
    if (this.activeAlerts.length === 0 && this.role !== 'admin') {
      return;
    }

    if (!this.campusData?.safeZones) return;

    this.campusData.safeZones.forEach(zone => {
      const isCompromised = this.isLocationInHazard(zone.lat, zone.lng, 25);

      if (isCompromised) {
        // Safe Zone is inside the danger zone! Mark as COMPROMISED - DO NOT ENTER!
        const compHtml = `
          <div style="background:#121212; color:#fff; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #fff; box-shadow:0 0 6px rgba(0,0,0,0.5); font-size:13px;">
            ⚠️
          </div>
        `;
        const compIcon = L.divIcon({
          html: compHtml,
          className: 'compromised-zone-icon',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });

        const marker = L.marker([zone.lat, zone.lng], { icon: compIcon }).addTo(this.map);
        marker.bindPopup(`<strong>⚠️ COMPROMISED: ${zone.name}</strong><br/><span style="color:#121212; font-weight:700;">INSIDE HAZARD ZONE - DO NOT EVACUATE HERE</span>`);
        this.safeZoneMarkers.set(zone.id, marker);
        return;
      }

      // Valid, uncompromised safe haven!
      const iconHtml = `
        <div style="background:#ffffff; color:#121212; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid #121212; box-shadow:0 2px 8px rgba(0,0,0,0.15); font-size:15px;">
          🛡️
        </div>
      `;
      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'safe-zone-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const marker = L.marker([zone.lat, zone.lng], { icon: customIcon }).addTo(this.map);
      marker.bindPopup(`<strong>🛡️ SAFE HAVEN: ${zone.name}</strong><br/><span style="color:#121212; font-weight:700;">ALL CLEAR - SAFE FOR EVACUATION</span><br/>Capacity: ${zone.capacity} persons`);
      this.safeZoneMarkers.set(zone.id, marker);
    });
  }

  // --- SWITCH STUDENT: JUMPS POSITION ON MAP & RE-EVALUATES ROUTE ---
  switchActiveUser(email) {
    const student = this.students.find(s => s.email === email);
    if (!student) return;

    // Save previous active student position
    const prev = this.students.find(s => s.email === this.userEmail);
    if (prev) {
      prev.lat = this.userLat;
      prev.lng = this.userLng;
    }

    // Set new active student & JUMP LOCATION
    this.userEmail = student.email;
    this.userName = student.name;
    this.userLat = student.lat;
    this.userLng = student.lng;
    localStorage.setItem('safepath_user_email', student.email);

    // Pan map to new user
    if (this.map) {
      this.map.panTo([this.userLat, this.userLng]);
    }

    // Update active button styling
    document.querySelectorAll('.student-chip').forEach(btn => {
      if (btn.dataset.email === student.email) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    this.renderAllStudentsOnMap();
    this.computeSafeRoute();
    this.syncLocationToServer(this.userLat, this.userLng);
  }

  // --- LOCATION CHANGING ---
  setUserLocation(lat, lng, dist, mins, targetHaven) {
    this.userLat = lat;
    this.userLng = lng;

    const currentStudent = this.students.find(s => s.email === this.userEmail);
    if (currentStudent) {
      currentStudent.lat = lat;
      currentStudent.lng = lng;
      if (dist !== undefined) currentStudent.distanceMeters = dist;
      if (mins !== undefined) currentStudent.estMinutes = mins;
      if (targetHaven !== undefined) currentStudent.targetHaven = targetHaven;
    }

    if (this.userMarker) {
      this.userMarker.setLatLng([this.userLat, this.userLng]);
    }

    this.renderAllStudentsOnMap();
    this.computeSafeRoute();
    this.syncLocationToServer(lat, lng, dist, mins, targetHaven);
  }

  async syncLocationForEmail(email, name, lat, lng, distanceMeters, estMinutes, targetHaven) {
    try {
      const payload = {
        email: email,
        name: name,
        latitude: lat,
        longitude: lng
      };
      if (distanceMeters !== undefined) payload.distanceMeters = distanceMeters;
      if (estMinutes !== undefined) payload.estMinutes = estMinutes;
      if (targetHaven !== undefined) payload.targetHaven = targetHaven;

      await fetch('/api/users/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {}
  }

  async syncLocationToServer(lat, lng, dist, mins, targetHaven) {
    if (dist === undefined || mins === undefined) {
      if (this.activeAlerts && this.activeAlerts.length > 0) {
        const route = this.calculateSafeRoute(lat, lng);
        if (route) {
          dist = Math.round(route.totalDistMeters);
          mins = route.estMinutes;
          targetHaven = route.bestSafe ? (route.bestSafe.name || route.bestSafe.id) : undefined;
        }
      }
    }
    return this.syncLocationForEmail(this.userEmail, this.userName, lat, lng, dist, mins, targetHaven);
  }

  teleportToBuilding(bId) {
    const coords = {
      'B1': { lat: 33.8813, lng: -117.8854, name: 'Pollak Library' },
      'B2': { lat: 33.8802, lng: -117.8858, name: 'Science Hall' },
      'B3': { lat: 33.8820, lng: -117.8885, name: 'Student Union' },
      'B4': { lat: 33.8829, lng: -117.8828, name: 'Engineering Quad' },
      'B5': { lat: 33.8865, lng: -117.8845, name: 'Residence Halls' },
      'B6': { lat: 33.8845, lng: -117.8890, name: 'Titan Stadium' }
    };
    const c = coords[bId];
    if (c) {
      this.setUserLocation(c.lat, c.lng);
      this.map.panTo([c.lat, c.lng]);
    }
  }

  isLocationInHazard(lat, lng, bufferMeters = 0) {
    for (const alert of this.activeAlerts) {
      if (!alert.active) continue;
      const d = this.calculateDistanceMeters(lat, lng, alert.latitude, alert.longitude);
      if (d <= alert.radiusMeters + bufferMeters) return true;
    }
    return false;
  }

  // --- GENERAL SAFE ROUTE CALCULATOR (Used for active user and all 5 fleet students) ---
  calculateSafeRoute(fromLat, fromLng) {
    if (!this.campusData || !this.campusData.walkwayNodes) return null;

    // 1. Identify start node nearest to coordinates
    let startNode = null;
    let minStartDist = Infinity;
    this.campusData.walkwayNodes.forEach(node => {
      const d = this.calculateDistanceMeters(fromLat, fromLng, node.lat, node.lng);
      if (d < minStartDist) {
        minStartDist = d;
        startNode = node;
      }
    });

    if (!startNode) return null;

    // 2. Build graph with hazard avoidance penalties (RED HAZARD ZONE AVOIDANCE)
    const nodeMap = new Map();
    this.campusData.walkwayNodes.forEach(n => nodeMap.set(n.id, n));

    const graph = new Map();
    this.campusData.walkwayNodes.forEach(n => graph.set(n.id, []));

    this.campusData.walkwayEdges.forEach(edge => {
      if (this.accessibilityMode && edge.hasStairs) return;

      const nodeA = nodeMap.get(edge.from);
      const nodeB = nodeMap.get(edge.to);
      if (!nodeA || !nodeB) return;

      const baseDist = this.calculateDistanceMeters(nodeA.lat, nodeA.lng, nodeB.lat, nodeB.lng);
      let hazardWeight = 0;

      for (const alert of this.activeAlerts) {
        if (!alert.active) continue;
        const distA = this.calculateDistanceMeters(nodeA.lat, nodeA.lng, alert.latitude, alert.longitude);
        const distB = this.calculateDistanceMeters(nodeB.lat, nodeB.lng, alert.latitude, alert.longitude);
        const midLat = (nodeA.lat + nodeB.lat) / 2;
        const midLng = (nodeA.lng + nodeB.lng) / 2;
        const distMid = this.calculateDistanceMeters(midLat, midLng, alert.latitude, alert.longitude);

        if (distA < alert.radiusMeters || distB < alert.radiusMeters || distMid < alert.radiusMeters) {
          hazardWeight += 500000; // Impassable through hazard!
        } else if (distMid < alert.radiusMeters + 80) {
          hazardWeight += 4000;
        }
      }

      // FREEWAY SAFETY BARRIER: CA-57 (Orange Freeway) runs north-south along the eastern border of campus.
      // Pedestrians must NEVER be routed onto or across the freeway corridor (lng > -117.8825).
      if (nodeA.lng > -117.8825 || nodeB.lng > -117.8825) {
        hazardWeight += 1000000; // Impassable freeway barrier
      }

      graph.get(edge.from).push({ to: edge.to, weight: baseDist + hazardWeight, node: nodeB });
      graph.get(edge.to).push({ to: edge.from, weight: baseDist + hazardWeight, node: nodeA });
    });

    // 3. Define target Safe Havens (STRICTLY WEST OF CA-57 FREEWAY) and filter out any inside the danger zone!
    const allSafeHavens = [
      { id: 'SZ1', name: 'North Quad Assembly Field (SZ1)', lat: 33.8842, lng: -117.8855, nodeId: 'N6' },
      { id: 'SZ2', name: 'East Campus Safe Haven (West of CA-57)', lat: 33.8830, lng: -117.8840, nodeId: 'N13' },
      { id: 'SZ3', name: 'West Stadium Pavilion (SZ3)', lat: 33.8850, lng: -117.8895, nodeId: 'N10' },
      { id: 'SZ4', name: 'South Gate Egress (SZ4)', lat: 33.8785, lng: -117.8850, nodeId: 'N16' }
    ];

    let safeZoneTargets = allSafeHavens.filter(sz => sz.lng <= -117.8825 && !this.isLocationInHazard(sz.lat, sz.lng, 35));

    // Fallback: If a massive catastrophe covers all standard havens, use outer regional havens (ALL WEST OF FREEWAY)
    if (safeZoneTargets.length === 0) {
      safeZoneTargets = [
        { id: 'SZ-EXT1', name: 'North Regional Assembly (SZ-EXT)', lat: 33.8885, lng: -117.8855, nodeId: 'N6' },
        { id: 'SZ-EXT2', name: 'West Regional Safe Center (SZ-EXT)', lat: 33.8850, lng: -117.8920, nodeId: 'N10' },
        { id: 'SZ-EXT3', name: 'South Regional Safe Center (SZ-EXT)', lat: 33.8745, lng: -117.8850, nodeId: 'N16' }
      ].filter(sz => sz.lng <= -117.8825 && !this.isLocationInHazard(sz.lat, sz.lng, 10));
    }

    if (safeZoneTargets.length === 0) {
      safeZoneTargets = [allSafeHavens[0]];
    }

    // CHECK IF ALREADY STANDING AT AN UNCOMPROMISED SAFE HAVEN!
    for (const sz of safeZoneTargets) {
      const d = this.calculateDistanceMeters(fromLat, fromLng, sz.lat, sz.lng);
      if (d <= 35) {
        return {
          startNode: null,
          bestSafe: sz,
          routeCoords: [[fromLat, fromLng], [sz.lat, sz.lng]],
          fineSteps: [],
          totalDistMeters: 0,
          estMinutes: 0,
          arrived: true
        };
      }
    }

    // 4. Dijkstra Shortest Path from startNode
    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();

    this.campusData.walkwayNodes.forEach(n => {
      distances.set(n.id, Infinity);
      unvisited.add(n.id);
    });
    distances.set(startNode.id, 0);

    while (unvisited.size > 0) {
      let currentId = null;
      let minDistance = Infinity;
      for (const id of unvisited) {
        if (distances.get(id) < minDistance) {
          minDistance = distances.get(id);
          currentId = id;
        }
      }

      if (currentId === null || minDistance === Infinity) break;
      unvisited.delete(currentId);

      const neighbors = graph.get(currentId) || [];
      for (const edge of neighbors) {
        if (unvisited.has(edge.to)) {
          const alt = distances.get(currentId) + edge.weight;
          if (alt < distances.get(edge.to)) {
            distances.set(edge.to, alt);
            previous.set(edge.to, currentId);
          }
        }
      }
    }

    // 5. Select closest reachable safe zone (MUST be 100% outside danger zone)
    let bestSafe = null;
    let minWeight = Infinity;
    safeZoneTargets.forEach(sz => {
      const weight = distances.get(sz.nodeId || sz.id);
      if (weight !== undefined && weight < minWeight) {
        minWeight = weight;
        bestSafe = sz;
      }
    });

    if (!bestSafe && safeZoneTargets.length > 0) {
      bestSafe = safeZoneTargets[0];
    }

    if (!bestSafe) return null;

    // 6. Reconstruct sequence of path nodes
    const pathNodes = [];
    let curr = bestSafe.nodeId || bestSafe.id;
    while (curr) {
      const nodeObj = nodeMap.get(curr);
      if (nodeObj) pathNodes.unshift(nodeObj);
      curr = previous.get(curr);
    }

    const routeCoords = [
      [fromLat, fromLng],
      ...pathNodes.map(n => [n.lat, n.lng]),
      [bestSafe.lat, bestSafe.lng]
    ];

    // 7. Calculate total walking distance & walking time
    let totalDistMeters = 0;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      totalDistMeters += this.calculateDistanceMeters(
        routeCoords[i][0], routeCoords[i][1],
        routeCoords[i + 1][0], routeCoords[i + 1][1]
      );
    }

    if (totalDistMeters <= 30) {
      totalDistMeters = 0;
    }

    const walkSpeed = this.accessibilityMode ? 0.85 : 1.2;
    const estMinutes = totalDistMeters === 0 ? 0 : Math.max(1, Math.round(totalDistMeters / walkSpeed / 60));

    // 8. Generate smooth fine-grained step waypoints (~18 meters each)
    const fineSteps = [];
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const p1 = routeCoords[i];
      const p2 = routeCoords[i + 1];
      const dist = this.calculateDistanceMeters(p1[0], p1[1], p2[0], p2[1]);
      const steps = Math.max(1, Math.round(dist / 18));
      for (let s = 1; s <= steps; s++) {
        const frac = s / steps;
        fineSteps.push({
          lat: p1[0] + (p2[0] - p1[0]) * frac,
          lng: p1[1] + (p2[1] - p1[1]) * frac
        });
      }
    }

    return {
      startNode,
      bestSafe,
      routeCoords,
      fineSteps,
      totalDistMeters,
      estMinutes,
      arrived: totalDistMeters === 0
    };
  }

  // --- SAFE ROUTE & STATUS ENGINE ---
  // --- GOOGLE MAPS-STYLE NAVIGATION HUD CONTROLLER ---
  updateGoogleMapsHUD(status, options = {}) {
    const hud = document.getElementById('gmaps-nav-hud');
    if (!hud) return;

    const header = document.getElementById('gmaps-header-bar');
    const icon = document.getElementById('gmaps-maneuver-icon');
    const primary = document.getElementById('gmaps-primary-instruction');
    const secondary = document.getElementById('gmaps-secondary-instruction');
    const pill = document.getElementById('gmaps-status-pill');
    const eta = document.getElementById('gmaps-eta-text');
    const dist = document.getElementById('gmaps-dist-text');
    const haven = document.getElementById('gmaps-haven-name');
    const hazardPill = document.getElementById('pill-hazard-status');
    const itinerary = document.getElementById('gmaps-itinerary');

    if (status === 'NORMAL') {
      if (header) {
        header.className = 'gmaps-nav-header';
        header.style.background = '#121212';
      }
      if (icon) icon.textContent = '✓';
      if (primary) primary.textContent = 'Campus Status: All Clear';
      if (secondary) secondary.textContent = 'Pedestrian walkways operating normally. No active emergencies in your sector.';
      if (pill) {
        pill.textContent = 'NORMAL';
        pill.className = 'badge badge-success';
      }
      if (eta) {
        eta.textContent = 'All Clear';
        eta.className = 'gmaps-eta-badge';
      }
      if (dist) dist.textContent = '(Safe Zone)';
      if (haven) haven.textContent = 'CSUF Safe Campus';
      if (hazardPill) {
        hazardPill.textContent = '✓ SAFE';
        hazardPill.className = 'badge badge-success';
      }
      if (itinerary) {
        itinerary.innerHTML = `
          <div class="itinerary-step">
            <div class="itinerary-step-icon">📍</div>
            <div class="itinerary-step-text">Current Location: Active campus zone</div>
            <div class="itinerary-step-dist">Normal</div>
          </div>
        `;
      }
    } else if (status === 'SAFE_OUTSIDE_HAZARD') {
      if (header) {
        header.className = 'gmaps-nav-header';
        header.style.background = '#121212';
      }
      if (icon) icon.textContent = '✓';
      if (primary) primary.textContent = 'Location Safe: Outside Affected Area';
      if (secondary) secondary.textContent = `Active emergency (${options.activeAlert ? options.activeAlert.name : 'Alert'}) is active elsewhere on campus. You are outside the hazard perimeter.`;
      if (pill) {
        pill.textContent = 'SAFE';
        pill.className = 'badge badge-success';
      }
      if (eta) {
        eta.textContent = 'Safe ✓';
        eta.className = 'gmaps-eta-badge';
      }
      if (dist) dist.textContent = `(${Math.round(options.distToCenter || 0)}m from incident)`;
      if (haven) haven.textContent = 'CSUF Safe Campus';
      if (hazardPill) {
        hazardPill.textContent = '✓ SAFE';
        hazardPill.className = 'badge badge-success';
      }
      if (itinerary) {
        itinerary.innerHTML = `
          <div class="itinerary-step">
            <div class="itinerary-step-icon">✓</div>
            <div class="itinerary-step-text"><strong>Current Location Outside Affected Hazard Zone</strong> - No evacuation required</div>
            <div class="itinerary-step-dist">Safe</div>
          </div>
        `;
      }
    } else if (status === 'ARRIVED') {
      if (header) {
        header.className = 'gmaps-nav-header';
        header.style.background = '#121212';
      }
      if (icon) icon.textContent = '🏁';
      if (primary) primary.textContent = `Safely Arrived at ${options.bestSafe ? options.bestSafe.name : 'Safe Haven'}`;
      if (secondary) secondary.textContent = 'You have safely reached designated emergency assembly haven outside the danger zone.';
      if (pill) {
        pill.textContent = 'SAFE AT HAVEN';
        pill.className = 'badge badge-success';
      }
      if (eta) {
        eta.textContent = 'Arrived 🏁';
        eta.className = 'gmaps-eta-badge';
      }
      if (dist) dist.textContent = '(0 meters)';
      if (haven && options.bestSafe) haven.textContent = `${options.bestSafe.name}`;
      if (hazardPill) {
        hazardPill.textContent = '✓ SAFE AT HAVEN';
        hazardPill.className = 'badge badge-success';
      }
      if (itinerary) {
        itinerary.innerHTML = `
          <div class="itinerary-step">
            <div class="itinerary-step-icon">🏁</div>
            <div class="itinerary-step-text"><strong>Arrived at ${options.bestSafe ? options.bestSafe.name : 'Safe Zone'}</strong> - Triage & assembly in progress</div>
            <div class="itinerary-step-dist">0 m</div>
          </div>
        `;
      }
    } else if (status === 'HAZARD') {
      const inHazard = options.inHazard;
      if (header) {
        header.className = 'gmaps-nav-header';
        header.style.background = '#121212';
      }
      if (icon) icon.textContent = inHazard ? '🏃' : '⬆️';
      if (primary) {
        primary.textContent = inHazard 
          ? `EVACUATE IMMEDIATELY: Head along Titan Walkway toward ${options.bestSafe ? options.bestSafe.name : 'Safe Haven'}`
          : `Proceed to ${options.bestSafe ? options.bestSafe.name : 'Safe Haven'}`;
      }
      if (secondary) {
        secondary.textContent = inHazard
          ? `Active emergency hazard (${options.activeAlert ? options.activeAlert.name : 'Alert'}) nearby. Follow designated route.`
          : 'Campus perimeter advisory in effect. Stay on designated safe path.';
      }
      if (pill) {
        pill.textContent = inHazard ? 'EVACUATE' : 'PROCEED';
        pill.className = inHazard ? 'badge badge-danger' : 'badge badge-info';
      }
      if (eta) {
        eta.textContent = `~${options.estMinutes} min`;
        eta.className = 'gmaps-eta-badge';
      }
      if (dist) dist.textContent = `(${Math.round(options.totalDistMeters)} meters)`;
      if (haven && options.bestSafe) haven.textContent = `${options.bestSafe.name}`;
      if (hazardPill) {
        hazardPill.textContent = inHazard ? '⚠️ IN HAZARD' : '✓ SAFE';
        hazardPill.className = inHazard ? 'badge badge-danger' : 'badge badge-success';
      }
      if (itinerary) {
        itinerary.innerHTML = `
          <div class="itinerary-step">
            <div class="itinerary-step-icon">📍</div>
            <div class="itinerary-step-text">Depart current location away from hazard perimeter</div>
            <div class="itinerary-step-dist">Start</div>
          </div>
          <div class="itinerary-step">
            <div class="itinerary-step-icon">🚶</div>
            <div class="itinerary-step-text">Follow CSUF main pedestrian walkway (${Math.round(options.totalDistMeters * 0.4)}m)</div>
            <div class="itinerary-step-dist">~${Math.round(options.totalDistMeters * 0.4)}m</div>
          </div>
          <div class="itinerary-step">
            <div class="itinerary-step-icon">↗️</div>
            <div class="itinerary-step-text">Turn slight right toward ${options.bestSafe ? options.bestSafe.name : 'Safe Haven'}</div>
            <div class="itinerary-step-dist">~${Math.round(options.totalDistMeters * 0.6)}m</div>
          </div>
          <div class="itinerary-step">
            <div class="itinerary-step-icon">🏁</div>
            <div class="itinerary-step-text"><strong>Arrive at Safe Haven: ${options.bestSafe ? options.bestSafe.name : 'Safe Point'}</strong></div>
            <div class="itinerary-step-dist">Destination</div>
          </div>
        `;
      }
    }
  }

  // --- SAFE ROUTE & STATUS ENGINE ---
  computeSafeRoute() {
    const container = document.getElementById('evacuation-display-box');

    // CASE 1: NO EMERGENCY IS HAPPENING (NORMAL STATE)
    if (this.activeAlerts.length === 0) {
      if (this.activeRoutePolyline && this.map) {
        this.map.removeLayer(this.activeRoutePolyline);
        this.activeRoutePolyline = null;
      }
      this.dismissAlertNotification();
      this.updateGoogleMapsHUD('NORMAL');

      if (container) {
        container.className = 'evacuation-card';
        container.style.border = '1px solid #374151';
        container.style.background = 'var(--bg-surface)';
        container.style.boxShadow = 'none';
        container.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 1.5rem;">🟢</span>
              <div>
                <div style="font-size: 1.05rem; font-weight: 800; color: #fff;">Campus Status: All Clear</div>
                <div style="font-size: 0.82rem; color: #9ca3af;">No active emergencies reported. You are in a safe zone.</div>
              </div>
            </div>
            <span class="badge badge-success" style="font-size: 0.85rem; padding: 5px 12px;">🟢 NORMAL</span>
          </div>
        `;
      }
      return;
    }

    // CASE 2: AN EMERGENCY IS IN PROGRESS!
    const activeAlert = this.activeAlerts[0];
    this.triggerNotification(activeAlert);
    const distToCenter = this.calculateDistanceMeters(this.userLat, this.userLng, activeAlert.latitude, activeAlert.longitude);
    const inHazard = (distToCenter <= activeAlert.radiusMeters);

    if (!inHazard) {
      if (this.activeRoutePolyline && this.map) {
        this.map.removeLayer(this.activeRoutePolyline);
        this.activeRoutePolyline = null;
      }
      this.updateGoogleMapsHUD('SAFE_OUTSIDE_HAZARD', { activeAlert, distToCenter });
      const evacBtn = document.getElementById('btn-evacuate-move') || document.getElementById('btn-walk-sim');
      if (evacBtn && !this.moveInterval) {
        evacBtn.textContent = 'Safe (Outside Affected Area)';
        evacBtn.className = 'btn btn-secondary';
        evacBtn.style.boxShadow = 'none';
      }

      if (container) {
        container.className = 'evacuation-card';
        container.style.border = '1px solid #cccccc';
        container.style.background = '#fafafa';
        container.innerHTML = `
          <div class="evac-header">
            <div class="evac-title-wrap">
              <span class="evac-icon">✓</span>
              <div>
                <div class="evac-label" style="color: #666666;">LOCATION SAFE: OUTSIDE AFFECTED AREA</div>
                <div class="evac-dest-name">CSUF Campus · ${this.userName}</div>
              </div>
            </div>
            <div>
              <span class="badge badge-success" style="font-size:0.85rem; padding:4px 10px;">SAFE (OUTSIDE HAZARD)</span>
            </div>
          </div>
          <div style="margin-top: 8px; font-size: 0.85rem; color: #666666;">
            An alert (${activeAlert.name}) is active ${Math.round(distToCenter)}m away, but you are outside the affected hazard zone. No evacuation required.
          </div>
        `;
      }
      return;
    }

    const evacBtn = document.getElementById('btn-evacuate-move') || document.getElementById('btn-walk-sim');
    if (evacBtn && !this.moveInterval) {
      evacBtn.textContent = '🏃 Move to Nearest Safe Zone';
      evacBtn.className = 'btn btn-primary';
      evacBtn.style.boxShadow = 'none';
    }

    const routeInfo = this.calculateSafeRoute(this.userLat, this.userLng);
    if (!routeInfo || !this.map) return;

    const { bestSafe, routeCoords, totalDistMeters, estMinutes, arrived } = routeInfo;
    this.currentRouteWaypoints = routeCoords;
    this.currentBestSafe = bestSafe;

    // If arrived at Safe Haven
    if (arrived || totalDistMeters <= 25) {
      if (this.activeRoutePolyline) {
        this.map.removeLayer(this.activeRoutePolyline);
        this.activeRoutePolyline = null;
      }
      this.updateGoogleMapsHUD('ARRIVED', { bestSafe, totalDistMeters: 0, estMinutes: 0 });

      if (container) {
        container.className = 'evacuation-card';
        container.style.border = '1px solid #121212';
        container.style.background = '#fafafa';
        container.innerHTML = `
          <div class="evac-header">
            <div class="evac-title-wrap">
              <span class="evac-icon">🛡️</span>
              <div>
                <div class="evac-label" style="color: #121212;">SAFELY ARRIVED AT EVACUATION HAVEN</div>
                <div class="evac-dest-name">${bestSafe.name}</div>
              </div>
            </div>
            <div>
              <span class="badge badge-success" style="font-size:0.85rem; padding:4px 10px;">SAFE AT HAVEN</span>
            </div>
          </div>
          <div class="evac-stats-row">
            <div class="stat-item">
              <span class="stat-name">HAVEN:</span>
              <span style="color:#121212; font-weight:700;">${bestSafe.name}</span>
            </div>
            <div class="stat-item">
              <span class="stat-name">DISTANCE:</span>
              <span class="stat-bold" style="color:#121212;">0 meters</span>
            </div>
            <div class="stat-item">
              <span class="stat-name">EST. TIME:</span>
              <span class="stat-bold" style="color:#121212;">Arrived 🛡️</span>
            </div>
          </div>
        `;
      }
      return;
    }

    // Draw the Black Safe Route Line on Map
    if (this.activeRoutePolyline) {
      this.map.removeLayer(this.activeRoutePolyline);
    }

    this.activeRoutePolyline = L.polyline(routeCoords, {
      color: '#121212',
      weight: 5,
      opacity: 0.95,
      dashArray: '8, 6',
      lineCap: 'round'
    }).addTo(this.map);

    this.updateGoogleMapsHUD('HAZARD', { inHazard, bestSafe, totalDistMeters, estMinutes, activeAlert });

    // Update the DIRECT Safe Route Display Box
    if (container) {
      container.className = `evacuation-card ${inHazard ? 'in-hazard' : ''}`;
      container.style.border = inHazard ? '1.5px solid #121212' : '1px solid #cccccc';
      container.style.background = inHazard ? '#fafafa' : '#ffffff';

      container.innerHTML = `
        <div class="evac-header">
          <div class="evac-title-wrap">
            <span class="evac-icon">${inHazard ? '🏃' : '🛡️'}</span>
            <div>
              <div class="evac-label" style="color: ${inHazard ? '#121212' : '#666666'};">
                ${inHazard ? `INSIDE ${activeAlert.name.toUpperCase()} ZONE` : 'SAFE EVACUATION DESTINATION'}
              </div>
              <div class="evac-dest-name">
                ${bestSafe.name}
              </div>
            </div>
          </div>

          <div>
            <span class="badge ${inHazard ? 'badge-danger' : 'badge-success'}" style="font-size:0.85rem; padding:4px 10px;">
              ${inHazard ? 'EVACUATE IMMEDIATELY' : 'PROCEED TO HAVEN'}
            </span>
          </div>
        </div>

        <div class="evac-stats-row">
          <div class="stat-item">
            <span class="stat-name">NEAREST HAVEN:</span>
            <span style="color:#121212; font-weight:700;">${bestSafe.name}</span>
          </div>
          <div class="stat-item">
            <span class="stat-name">DISTANCE:</span>
            <span class="stat-bold">${Math.round(totalDistMeters)} meters</span>
          </div>
          <div class="stat-item">
            <span class="stat-name">EST. TIME:</span>
            <span class="stat-bold">~${estMinutes} min</span>
          </div>
        </div>
      `;
    }
  }

  // --- AUDIO ALARM & NOTIFICATION SYSTEM ---
  playAlarmSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';

      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.25);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.5);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.75);
      osc.frequency.exponentialRampToValueAtTime(880, now + 1.0);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

      osc.start(now);
      osc.stop(now + 1.2);
    } catch (e) {}
  }

  triggerNotification(alert) {
    if (!alert) return;
    if (this.lastNotifiedAlertId === alert.id) return;
    this.lastNotifiedAlertId = alert.id;

    // Audible alarm
    this.playAlarmSound();

    // Banner removed on student panel per user instruction
    const notifyContainer = document.getElementById('user-alert-notification-area');
    if (notifyContainer) {
      notifyContainer.innerHTML = '';
    }
  }

  dismissAlertNotification() {
    this.lastNotifiedAlertId = null;
    const toast = document.getElementById('active-alert-toast');
    if (toast) toast.remove();
    const notifyContainer = document.getElementById('user-alert-notification-area');
    if (notifyContainer) notifyContainer.innerHTML = '';
  }

  // --- AUTOMATIC POLLING FALLBACK (Every 2 seconds to guarantee 100% real-time sync) ---
  startPollingFallback() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/alerts');
        if (!res.ok) return;
        const data = await res.json();
        const incomingAlerts = data.active || [];

        const currentIds = this.activeAlerts.map(a => a.id).sort().join(',');
        const incomingIds = incomingAlerts.map(a => a.id).sort().join(',');

        if (currentIds !== incomingIds) {
          const hadNoAlerts = this.activeAlerts.length === 0;
          this.activeAlerts = incomingAlerts;
          this.renderActiveAlertCircles();
          this.renderAllStudentsOnMap();
          this.computeSafeRoute();
          this.refreshAdminAlertsTable();

          if (incomingAlerts.length > 0 && hadNoAlerts) {
            this.triggerNotification(incomingAlerts[0]);
          } else if (incomingAlerts.length === 0) {
            this.dismissAlertNotification();
          }
        }

        if (this.role === 'admin' || this.role === 'demo') {
          await this.loadAdminFleet();
          this.updateAdminTelemetry();
        } else {
          await this.syncFleetFromServer();
          this.renderAllStudentsOnMap();
        }
      } catch (e) {}
    }, 2000);
  }

  // --- ADMIN BROADCAST & RESOLVE METHODS (Required by admin.html and demo.html) ---
  async broadcastAdminAlert(formData) {
    try {
      this.clearAdminPin();
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await res.json();
      this.clearAdminPin();
      return data;
    } catch (e) {
      console.error('Failed to broadcast alert:', e);
      throw e;
    }
  }

  async resolveAdminAlert(alertId) {
    try {
      const res = await fetch(`/api/alerts/${alertId}`, { method: 'DELETE' });
      const data = await res.json();
      const idx = this.activeAlerts.findIndex(a => a.id === alertId);
      if (idx !== -1) this.activeAlerts.splice(idx, 1);
      this.renderActiveAlertCircles();
      this.renderAllStudentsOnMap();
      this.computeSafeRoute();
      if (this.activeAlerts.length === 0) {
        this.dismissAlertNotification();
      }
      this.refreshAdminAlertsTable();
      return data;
    } catch (e) {
      console.error('Failed to resolve alert:', e);
      throw e;
    }
  }

  async clearAllAdminAlerts() {
    try {
      let res = await fetch('/api/alerts', { method: 'DELETE' });
      if (!res.ok) {
        res = await fetch('/api/alerts/clear', { method: 'POST' });
      }
      const data = await res.json();
      this.activeAlerts = [];
      this.renderActiveAlertCircles();
      this.renderAllStudentsOnMap();
      this.computeSafeRoute();
      this.dismissAlertNotification();
      this.refreshAdminAlertsTable();
      return data;
    } catch (e) {
      console.error('Failed to clear all alerts:', e);
      throw e;
    }
  }

  async loadAdminFleet() {
    try {
      if (!this.campusData) {
        await this.loadCampusData();
      }
      const res = await fetch('/api/users');
      const data = await res.json();
      const tbody = document.getElementById('admin-fleet-tbody');
      const connectedCount = document.getElementById('admin-connected-count');
      if (connectedCount && data.users) {
        connectedCount.textContent = `${data.users.length} Active`;
        // Sync this.students on admin panel with true server coordinates!
        data.users.forEach(u => {
          const st = this.students.find(s => s.email === u.email);
          if (st) {
            st.lat = parseFloat(u.latitude);
            st.lng = parseFloat(u.longitude);
            st.status = u.status;
            st.name = u.name;
            st.distanceMeters = u.distanceMeters;
            st.estMinutes = u.estMinutes;
            st.targetHaven = u.targetHaven;
          } else if (u.role !== 'Admin' && u.email !== 'admin@safepath.com') {
            this.students.push({
              email: u.email,
              name: u.name,
              lat: parseFloat(u.latitude),
              lng: parseFloat(u.longitude),
              status: u.status || 'NORMAL',
              distanceMeters: u.distanceMeters,
              estMinutes: u.estMinutes,
              targetHaven: u.targetHaven
            });
          }
        });
        if (this.role === 'admin') {
          this.renderAllStudentsOnMap();
        }
      }
      if (tbody && data.users) {
        tbody.innerHTML = data.users.map(u => {
          let dist = u.distanceMeters;
          let mins = u.estMinutes;
          let targetHaven = u.targetHaven;

          let distDisplay = '<span style="color:#10b981; font-size:0.85rem; font-weight:600;">Campus Clear</span>';
          let timeDisplay = '<span style="color:#10b981; font-size:0.85rem; font-weight:600;">🟢 Normal</span>';

          if (this.activeAlerts.length > 0) {
            if (u.status === 'NORMAL') {
              distDisplay = '<span style="color:#10b981; font-size:0.85rem; font-weight:600;">Safe (Outside Hazard)</span>';
              timeDisplay = '<span class="badge badge-success" style="font-size:11px; padding:3px 8px;">🟢 Safe</span>';
            } else {
              if (dist === undefined || mins === undefined) {
                const route = this.calculateSafeRoute(parseFloat(u.latitude), parseFloat(u.longitude));
                if (route && route.bestSafe) {
                  dist = Math.round(route.totalDistMeters);
                  mins = route.estMinutes;
                  targetHaven = route.bestSafe.name || route.bestSafe.id;
                }
              }

              if (dist !== undefined && mins !== undefined) {
                if (dist <= 25 || mins === 0) {
                  distDisplay = `<span style="color:#10b981; font-weight:700;">0 meters</span><br/><span style="font-size:11px; color:#34d399;">(Safe Zone)</span>`;
                  timeDisplay = `<span class="badge badge-success" style="font-size:11px; padding:3px 8px;">🛡️ Safe Haven</span>`;
                } else {
                  const distColor = u.status === 'IN HAZARD' ? '#f87171' : '#34d399';
                  distDisplay = `<strong style="color:${distColor};">${dist} meters</strong><br/><span style="color:#9ca3af; font-size:11px;">to ${targetHaven || 'Safe Zone'}</span>`;
                  const timeColor = u.status === 'IN HAZARD' ? '#ef4444' : '#38bdf8';
                  timeDisplay = `<strong style="color:${timeColor}; font-size:0.95rem;">~${mins} min</strong><br/><span style="color:#9ca3af; font-size:11px;">(safe egress pace)</span>`;
                }
              }
            }
          }

          return `
            <tr>
              <td><strong>${u.name}</strong><br/><span style="color:#9ca3af; font-size:11px;">${u.email}</span></td>
              <td><code>${parseFloat(u.latitude).toFixed(4)}, ${parseFloat(u.longitude).toFixed(4)}</code></td>
              <td>
                <span class="badge ${u.status === 'IN HAZARD' ? 'badge-danger' : (u.status === 'PROXIMITY WARNING' ? 'badge-warning' : 'badge-success')}">
                  ${u.status}
                </span>
              </td>
              <td>${distDisplay}</td>
              <td>${timeDisplay}</td>
              <td>${u.batteryLevel}%</td>
              <td>${u.networkState}</td>
            </tr>
          `;
        }).join('');
      }
    } catch (e) {}
  }

  async resetFleetLocations() {
    try {
      const res = await fetch('/api/users/reset', { method: 'POST' });
      const data = await res.json();
      await this.syncFleetFromServer();
      this.renderAllStudentsOnMap();
      this.computeSafeRoute();
      if (this.role === 'admin' || this.role === 'demo') {
        await this.loadAdminFleet();
      }
      return data;
    } catch (e) {
      console.error('Failed to reset fleet:', e);
      throw e;
    }
  }

  updateAdminTelemetry() {
    const activeMetric = document.getElementById('admin-active-count');
    if (activeMetric) {
      activeMetric.textContent = `${this.activeAlerts.length} Active`;
      activeMetric.style.color = this.activeAlerts.length > 0 ? '#ef4444' : '#10b981';
    }
    const badge = document.getElementById('active-badge-count');
    if (badge) {
      badge.textContent = this.activeAlerts.length;
    }
  }

  refreshAdminAlertsTable() {
    this.updateAdminTelemetry();
    const container = document.getElementById('admin-active-alerts-list');
    if (!container) return;

    if (this.activeAlerts.length === 0) {
      container.innerHTML = `<p style="color:#9ca3af; font-size:0.85rem; padding:8px;">No active emergency alerts. Campus is secure.</p>`;
      return;
    }

    container.innerHTML = this.activeAlerts.map(alert => `
      <div style="background:var(--bg-card); border-left:4px solid ${alert.color}; padding:8px 12px; border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:700; font-size:0.88rem; color:${alert.color};">
            ${alert.icon} ${alert.title || alert.name}
          </div>
          <div style="font-size:0.75rem; color:#9ca3af;">
            Radius: <strong>${alert.radiusMeters}m</strong> | Center: <code>${alert.latitude.toFixed(4)}, ${alert.longitude.toFixed(4)}</code>
          </div>
        </div>
        <button class="btn btn-secondary" style="width:auto; padding:4px 8px; font-size:0.75rem;" onclick="window.safePathApp.resolveAdminAlert('${alert.id}').then(() => { window.safePathApp.refreshActiveAlerts(); window.safePathApp.loadAdminFleet(); })">
          Resolve
        </button>
      </div>
    `).join('');
  }

  // --- SSE ALERT BROADCAST LISTENER ---
  connectSSE() {
    try {
      const eventSource = new EventSource('/api/events');

      eventSource.addEventListener('init', (e) => {
        const data = JSON.parse(e.data);
        this.activeAlerts = data.activeAlerts || [];
        this.renderActiveAlertCircles();
        this.renderAllStudentsOnMap();
        this.computeSafeRoute();
        this.updateAdminTelemetry();
        if (this.role === 'admin' || this.role === 'demo') {
          this.loadAdminFleet();
        }
        if (this.activeAlerts.length > 0) {
          this.triggerNotification(this.activeAlerts[0]);
        }
      });

      eventSource.addEventListener('alert_broadcast', (e) => {
        const data = JSON.parse(e.data);
        this.clearAdminPin();
        this.activeAlerts.unshift(data.alert);
        this.renderActiveAlertCircles();
        this.renderAllStudentsOnMap();
        this.computeSafeRoute();
        this.triggerNotification(data.alert);
        this.refreshAdminAlertsTable();
        this.updateAdminTelemetry();
        if (this.role === 'admin' || this.role === 'demo') {
          this.loadAdminFleet();
        }
      });

      eventSource.addEventListener('alert_resolved', (e) => {
        const data = JSON.parse(e.data);
        const idx = this.activeAlerts.findIndex(a => a.id === data.alertId);
        if (idx !== -1) this.activeAlerts.splice(idx, 1);
        this.renderActiveAlertCircles();
        this.renderAllStudentsOnMap();
        this.computeSafeRoute();
        if (this.activeAlerts.length === 0) {
          this.dismissAlertNotification();
        }
        this.refreshAdminAlertsTable();
        this.updateAdminTelemetry();
        if (this.role === 'admin' || this.role === 'demo') {
          this.loadAdminFleet();
        }
      });

      eventSource.addEventListener('alert_cleared', (e) => {
        this.activeAlerts = [];
        this.renderActiveAlertCircles();
        this.renderAllStudentsOnMap();
        this.computeSafeRoute();
        this.dismissAlertNotification();
        this.refreshAdminAlertsTable();
        this.updateAdminTelemetry();
        if (this.role === 'admin' || this.role === 'demo') {
          this.loadAdminFleet();
        }
      });

      // REAL-TIME STUDENT GPS LOCATION UPDATES
      eventSource.addEventListener('user_location_update', (e) => {
        const u = JSON.parse(e.data);
        const st = this.students.find(s => s.email === u.email);
        if (st) {
          st.lat = parseFloat(u.latitude);
          st.lng = parseFloat(u.longitude);
          st.status = u.status;
          if (u.distanceMeters !== undefined) st.distanceMeters = u.distanceMeters;
          if (u.estMinutes !== undefined) st.estMinutes = u.estMinutes;
          if (u.targetHaven !== undefined) st.targetHaven = u.targetHaven;
        }
        if (this.role === 'user' && this.userEmail === u.email) {
          this.userLat = parseFloat(u.latitude);
          this.userLng = parseFloat(u.longitude);
        }
        this.renderAllStudentsOnMap();
        if (this.role === 'admin' || this.role === 'demo') {
          this.loadAdminFleet();
        }
      });
    } catch (err) {}
  }

  renderActiveAlertCircles() {
    for (const [id, circle] of this.hazardCircles.entries()) {
      this.map.removeLayer(circle);
    }
    this.hazardCircles.clear();

    this.activeAlerts.forEach(alert => {
      if (!alert.active) return;

      // Monochrome Hazard Zone Styling
      const circle = L.circle([alert.latitude, alert.longitude], {
        radius: alert.radiusMeters,
        color: '#121212',
        dashArray: '6, 6',
        fillColor: '#121212',
        fillOpacity: 0.15,
        weight: 2
      }).addTo(this.map);

      circle.bindPopup(`<strong>${alert.icon || '⚠️'} ${alert.name}</strong><br/><span style="color:#121212; font-weight:700;">HAZARD ZONE</span><br/>Radius: ${alert.radiusMeters}m`);
      this.hazardCircles.set(alert.id, circle);
    });
  }

  async refreshActiveAlerts() {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      const hadNoAlerts = this.activeAlerts.length === 0;
      this.activeAlerts = data.active || [];
      this.renderActiveAlertCircles();

      // If active alert exists, hide the draft epicenter pin to prevent confusion
      if (this.activeAlerts.length > 0) {
        this.clearAdminPin();
      }

      this.renderAllStudentsOnMap();
      this.computeSafeRoute();
      if (this.activeAlerts.length > 0 && hadNoAlerts) {
        this.triggerNotification(this.activeAlerts[0]);
      } else if (this.activeAlerts.length === 0) {
        this.dismissAlertNotification();
      }
      this.refreshAdminAlertsTable();
    } catch (e) {}
  }

  toggleAccessibility(enabled) {
    this.accessibilityMode = enabled;
    this.computeSafeRoute();
  }

  // --- BEARING & NAVIGATION PUCK HELPERS ---
  calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = deg => (deg * Math.PI) / 180;
    const toDeg = rad => (rad * 180) / Math.PI;
    const phi1 = toRad(lat1);
    const phi2 = toRad(lat2);
    const deltaLambda = toRad(lon2 - lon1);
    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    const bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
  }

  updateNavigationPuck(lat, lng, bearing = 0) {
    const puckHtml = `
      <div style="position:relative; width:44px; height:44px; display:flex; align-items:center; justify-content:center;">
        <div style="background:#ffffff; border-radius:50%; width:40px; height:40px; box-shadow:0 4px 14px rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; border:2px solid #ffffff;">
          <div style="width:0; height:0; border-left:10px solid transparent; border-right:10px solid transparent; border-bottom:20px solid #1a73e8; transform:rotate(${bearing}deg); filter:drop-shadow(0 2px 3px rgba(0,0,0,0.2));"></div>
        </div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'gmaps-nav-puck',
      html: puckHtml,
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    if (this.userMarker) {
      this.userMarker.setLatLng([lat, lng]);
      this.userMarker.setIcon(icon);
      this.userMarker.setZIndexOffset(3000);
    } else {
      this.userMarker = L.marker([lat, lng], { icon, zIndexOffset: 3000 }).addTo(this.map);
    }
  }

  stopNavigation() {
    if (this.moveInterval) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
    this.isNavigating = false;
    const btn = document.getElementById('btn-evacuate-move') || document.getElementById('btn-walk-sim');
    if (btn) btn.textContent = '🏃 Move to Nearest Safe Zone';

    const overlay = document.getElementById('gmaps-nav-overlay');
    if (overlay) overlay.style.display = 'none';

    this.renderAllStudentsOnMap();
    this.computeSafeRoute();
  }

  recenterOnUser() {
    if (this.map) {
      this.map.panTo([this.userLat, this.userLng]);
    }
  }

  fitRouteBounds() {
    if (this.activeRoutePolyline && this.map) {
      this.map.fitBounds(this.activeRoutePolyline.getBounds(), { padding: [40, 40] });
    } else if (this.map) {
      this.map.setView([this.userLat, this.userLng], 16);
    }
  }

  // --- MOVE ACTIVE USER TO NEAREST SAFE ZONE WITH GOOGLE MAPS NAVIGATION HUD ---
  toggleMoveToSafeZone() {
    const btn = document.getElementById('btn-evacuate-move') || document.getElementById('btn-walk-sim');

    // If currently moving, stop
    if (this.moveInterval) {
      this.stopNavigation();
      return;
    }

    if (this.activeAlerts.length === 0) {
      alert('Campus status is All Clear! No active emergency evacuation required.');
      return;
    }

    // CHECK: Is student in the affected hazard area?
    const me = this.students.find(s => s.email === this.userEmail);
    const userLat = me ? me.lat : this.userLat;
    const userLng = me ? me.lng : this.userLng;
    const inHazard = this.isLocationInHazard(userLat, userLng);

    if (!inHazard) {
      alert('You are outside the affected hazard area. No evacuation required; you are safe at your current location.');
      return;
    }

    // Stop fleet evacuation if active
    if (this.moveAllInterval) {
      clearInterval(this.moveAllInterval);
      this.moveAllInterval = null;
      const allBtn = document.getElementById('btn-evacuate-all');
      if (allBtn) allBtn.textContent = '👥 Move All to Safe Zones';
    }

    const routeInfo = this.calculateSafeRoute(this.userLat, this.userLng);
    if (!routeInfo || !routeInfo.fineSteps || routeInfo.fineSteps.length === 0) {
      if (routeInfo && routeInfo.arrived) {
        alert(`You are already at ${routeInfo.bestSafe.name}. You are in a safe zone.`);
      } else {
        alert('Please wait, computing safe path to haven...');
      }
      return;
    }

    const waypoints = routeInfo.fineSteps;
    const bestSafe = routeInfo.bestSafe;
    let currentStep = 0;
    if (btn) btn.textContent = '⏹️ Stop Moving';

    // Show Google Maps Active Navigation Overlay matching media_1790888545376.png
    this.isNavigating = true;
    const overlay = document.getElementById('gmaps-nav-overlay');
    const titleEl = document.getElementById('gmaps-nav-haven-title');
    const thenEl = document.getElementById('gmaps-nav-then-text');
    const dockEtaEl = document.getElementById('gmaps-dock-eta');
    const dockDistClockEl = document.getElementById('gmaps-dock-dist-clock');

    if (overlay) overlay.style.display = 'flex';
    if (titleEl) titleEl.textContent = bestSafe?.name || 'Designated Campus Safe Haven';
    if (thenEl) thenEl.textContent = 'Titan Walkway';

    const now = new Date();
    const arrivalTime = new Date(now.getTime() + routeInfo.estMinutes * 60000);
    const clockStr = `${String(arrivalTime.getHours()).padStart(2, '0')}:${String(arrivalTime.getMinutes()).padStart(2, '0')}`;
    if (dockEtaEl) dockEtaEl.innerHTML = `${routeInfo.estMinutes} <span style="font-size:1.35rem; font-weight:700;">min</span>`;
    if (dockDistClockEl) dockDistClockEl.textContent = `${routeInfo.totalDistMeters} m · ${clockStr}`;

    const initialBearing = waypoints.length > 0
      ? this.calculateBearing(this.userLat, this.userLng, waypoints[0].lat, waypoints[0].lng)
      : 0;
    this.updateNavigationPuck(this.userLat, this.userLng, initialBearing);
    if (this.map) this.map.setView([this.userLat, this.userLng], 17);

    this.moveInterval = setInterval(() => {
      if (currentStep >= waypoints.length) {
        this.stopNavigation();
        const havenName = bestSafe?.name || 'Safe Haven';
        this.setUserLocation(bestSafe.lat, bestSafe.lng, 0, 0, havenName);
        this.computeSafeRoute();
        alert(`🎉 SAFELY ARRIVED! You have reached ${havenName}. You are completely outside the hazard zone.`);
        return;
      }

      const pt = waypoints[currentStep];
      const bearing = (currentStep + 1 < waypoints.length)
        ? this.calculateBearing(pt.lat, pt.lng, waypoints[currentStep + 1].lat, waypoints[currentStep + 1].lng)
        : initialBearing;

      currentStep++;

      // Compute remaining distance & walking time as student advances
      let remainingMeters = 0;
      for (let k = currentStep; k < waypoints.length - 1; k++) {
        remainingMeters += this.calculateDistanceMeters(
          waypoints[k].lat, waypoints[k].lng,
          waypoints[k + 1].lat, waypoints[k + 1].lng
        );
      }
      if (bestSafe && waypoints.length > 0) {
        remainingMeters += this.calculateDistanceMeters(
          waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng,
          bestSafe.lat, bestSafe.lng
        );
      }
      const walkSpeed = this.accessibilityMode ? 0.85 : 1.2;
      const remainingMinutes = remainingMeters <= 25 ? 0 : Math.max(1, Math.round(remainingMeters / walkSpeed / 60));

      const stepArrival = new Date(Date.now() + remainingMinutes * 60000);
      const stepClock = `${String(stepArrival.getHours()).padStart(2, '0')}:${String(stepArrival.getMinutes()).padStart(2, '0')}`;
      if (dockEtaEl) dockEtaEl.innerHTML = `${remainingMinutes} <span style="font-size:1.35rem; font-weight:700;">min</span>`;
      if (dockDistClockEl) dockDistClockEl.textContent = `${Math.round(remainingMeters)} m · ${stepClock}`;

      this.updateNavigationPuck(pt.lat, pt.lng, bearing);
      if (this.map) this.map.panTo([pt.lat, pt.lng]);

      this.setUserLocation(
        pt.lat,
        pt.lng,
        Math.round(remainingMeters),
        remainingMinutes,
        bestSafe?.name || bestSafe?.id
      );
    }, 600);
  }

  // --- MOVE ALL STUDENTS CONCURRENTLY (ONLY AFFECTED HAZARD STUDENTS MOVE!) ---
  toggleMoveAllToSafeZones() {
    const btn = document.getElementById('btn-evacuate-all');

    if (this.moveAllInterval) {
      clearInterval(this.moveAllInterval);
      this.moveAllInterval = null;
      if (btn) btn.textContent = '👥 Move All to Safe Zones';
      return;
    }

    if (this.activeAlerts.length === 0) {
      alert('Campus status is All Clear! No active emergency evacuation required.');
      return;
    }

    // Stop single user move if running
    if (this.moveInterval) {
      this.stopNavigation();
    }

    // Calculate individual evacuation paths ONLY for students IN THE AFFECTED HAZARD AREA!
    // "and also check if the students is not in the affected area, move all do not change the students positions that not in affected area"
    const plans = [];
    for (const student of this.students) {
      // CHECK: Is student in the affected hazard area?
      const inHazard = this.isLocationInHazard(student.lat, student.lng);
      if (!inHazard) {
        // Students NOT in the affected area DO NOT MOVE! Position stays unchanged!
        console.log(`Student ${student.name} is outside affected hazard area. Position will not change.`);
        continue;
      }

      const routeInfo = this.calculateSafeRoute(student.lat, student.lng);
      if (routeInfo && routeInfo.fineSteps && routeInfo.fineSteps.length > 0) {
        plans.push({
          student,
          steps: routeInfo.fineSteps,
          stepIndex: 0,
          bestSafe: routeInfo.bestSafe,
          completed: false
        });
      }
    }

    if (plans.length === 0) {
      alert('All students are already safe outside the affected hazard area! No positions changed.');
      return;
    }

    if (btn) btn.textContent = '⏹️ Stop Evacuating All';

    this.moveAllInterval = setInterval(() => {
      let anyRemaining = false;

      for (const plan of plans) {
        if (plan.completed) continue;

        if (plan.stepIndex < plan.steps.length) {
          anyRemaining = true;
          const nextPt = plan.steps[plan.stepIndex];
          plan.student.lat = nextPt.lat;
          plan.student.lng = nextPt.lng;
          plan.stepIndex++;

          // Compute remaining distance & walking time as student advances
          let remainingMeters = 0;
          for (let k = plan.stepIndex; k < plan.steps.length - 1; k++) {
            remainingMeters += this.calculateDistanceMeters(
              plan.steps[k].lat, plan.steps[k].lng,
              plan.steps[k + 1].lat, plan.steps[k + 1].lng
            );
          }
          if (plan.bestSafe && plan.steps.length > 0) {
            remainingMeters += this.calculateDistanceMeters(
              plan.steps[plan.steps.length - 1].lat, plan.steps[plan.steps.length - 1].lng,
              plan.bestSafe.lat, plan.bestSafe.lng
            );
          }

          const walkSpeed = this.accessibilityMode ? 0.85 : 1.2;
          const remainingMinutes = remainingMeters <= 25 ? 0 : Math.max(1, Math.round(remainingMeters / walkSpeed / 60));

          plan.student.distanceMeters = Math.round(remainingMeters);
          plan.student.estMinutes = remainingMinutes;
          plan.student.targetHaven = plan.bestSafe.name || plan.bestSafe.id;

          // If this is the active user on user panel, update active user location variables
          if (this.role === 'user' && plan.student.email === this.userEmail) {
            this.userLat = nextPt.lat;
            this.userLng = nextPt.lng;
            if (this.userMarker) {
              this.userMarker.setLatLng([this.userLat, this.userLng]);
            }
          }

          // Sync student location to server so Admin fleet table and SSE pings update live
          this.syncLocationForEmail(
            plan.student.email,
            plan.student.name,
            nextPt.lat,
            nextPt.lng,
            plan.student.distanceMeters,
            plan.student.estMinutes,
            plan.student.targetHaven
          );
        } else {
          plan.completed = true;
          plan.student.distanceMeters = 0;
          plan.student.estMinutes = 0;
          const safeLat = plan.bestSafe ? plan.bestSafe.lat : plan.student.lat;
          const safeLng = plan.bestSafe ? plan.bestSafe.lng : plan.student.lng;
          plan.student.lat = safeLat;
          plan.student.lng = safeLng;
          if (this.role === 'user' && plan.student.email === this.userEmail) {
            this.userLat = safeLat;
            this.userLng = safeLng;
            if (this.userMarker) {
              this.userMarker.setLatLng([this.userLat, this.userLng]);
            }
          }
          this.syncLocationForEmail(
            plan.student.email,
            plan.student.name,
            safeLat,
            safeLng,
            0,
            0,
            plan.bestSafe?.name || plan.bestSafe?.id
          );
        }
      }

      this.renderAllStudentsOnMap();
      this.computeSafeRoute();

      if (!anyRemaining) {
        clearInterval(this.moveAllInterval);
        this.moveAllInterval = null;
        if (btn) btn.textContent = '👥 Move All to Safe Zones';
        alert('🎉 ALL AFFECTED STUDENTS SAFELY EVACUATED! Students in the danger zone have safely reached designated safe havens.');
      }
    }, 600);
  }

  toggleWalkSimulation() {
    return this.toggleMoveToSafeZone();
  }

  // Haversine
  calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dPhi = ((lat2 - lat1) * Math.PI) / 180;
    const dLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) *
      Math.sin(dLambda / 2) * Math.sin(dLambda / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
}

window.SafePathEngine = SafePathEngine;
