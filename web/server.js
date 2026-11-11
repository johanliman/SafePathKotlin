// SafePath Emergency Alert & Safe Route - Server
// Node.js zero-dependency real-time backend with SSE (Server-Sent Events) & REST API
// CPSC 515 Mobile Computing - Daniel Wu, Johan Liman, Jie Chen, Yu-Cheng Chang, Siling Liu

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// In-Memory Data Store (Persistent for demo runtime)
let campusData = null;
try {
  campusData = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'campus-data.json'), 'utf8'));
} catch (e) {
  console.error('Failed to load campus-data.json:', e);
}

let activeAlerts = [];
let alertHistory = [];

// Distance Calculation (Haversine in meters)
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return 0;
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Landmark & Campus Geocoding Resolver (CSU Fullerton Buildings & Safe Havens)
const geocodeCache = new Map();

async function reverseGeocodeOffCampus(lat, lng) {
  if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) return null;
  const numLat = Number(lat);
  const numLng = Number(lng);
  const cacheKey = `${numLat.toFixed(4)},${numLng.toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${numLat}&lon=${numLng}&format=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SafePathCampusSafety/1.0 (csuf-cpsc515)' }
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};
      const road = addr.road || addr.pedestrian || addr.street || addr.residential || addr.neighbourhood || addr.suburb || '';
      const city = addr.city || addr.town || addr.municipality || addr.village || addr.county || '';
      if (road || city) {
        const placeName = road && city ? `${road}, ${city}` : (road || city);
        geocodeCache.set(cacheKey, placeName);
        return placeName;
      }
    }
  } catch (err) {
    // Ignore timeout or network failure
  }
  return null;
}

function resolveLocationName(lat, lng) {
  if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) {
    return 'Unknown Location';
  }

  const numLat = Number(lat);
  const numLng = Number(lng);

  const candidates = [];
  if (campusData && campusData.buildings) {
    for (const b of campusData.buildings) {
      const d = getDistanceMeters(numLat, numLng, b.lat, b.lng);
      candidates.push({ name: b.name, dist: d });
    }
  }
  if (campusData && campusData.safeZones) {
    for (const sz of campusData.safeZones) {
      const d = getDistanceMeters(numLat, numLng, sz.lat, sz.lng);
      candidates.push({ name: sz.name, dist: d });
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);

  if (candidates.length > 0) {
    const closest = candidates[0];
    if (closest.dist <= 75) {
      return `At ${closest.name}`;
    }
    if (closest.dist <= 180) {
      return `Near ${closest.name} (~${Math.round(closest.dist)}m)`;
    }
  }

  // Campus Center fallback check
  const campusCenter = (campusData && campusData.campus && campusData.campus.center) || { lat: 33.8823, lng: -117.8851 };
  const distCenter = getDistanceMeters(numLat, numLng, campusCenter.lat, campusCenter.lng);
  if (distCenter <= 800) {
    return `CSU Fullerton Campus (~${Math.round(distCenter)}m from Quad)`;
  }

  // Check geocode cache for reverse-geocoded real address
  const cacheKey = `${numLat.toFixed(4)},${numLng.toFixed(4)}`;
  const cachedPlace = geocodeCache.get(cacheKey);
  if (cachedPlace) {
    return `${cachedPlace} (~${(distCenter / 1000).toFixed(1)} km from CSUF)`;
  }

  // Trigger background geocode fetch if not yet in cache
  reverseGeocodeOffCampus(numLat, numLng).catch(() => {});

  return `Off-Campus (${(distCenter / 1000).toFixed(1)} km from Campus)`;
}

// Location Verification & Mock Detection Algorithm
function analyzeLocationChange(user, newLat, newLng, isClientMock = false, mockSource = null, accuracy = 4.5) {
  const now = Date.now();
  const newLocationName = resolveLocationName(newLat, newLng);

  // Retrieve previous known location / last login location
  const prevLoc = user.lastLoginLocation || (user.latitude && user.longitude ? {
    latitude: user.latitude,
    longitude: user.longitude,
    timestamp: user.lastPing || (now - 3600000 * 2), // Default 2 hours ago baseline
    locationName: user.locationName || resolveLocationName(user.latitude, user.longitude),
    isMock: Boolean(user.isMockLocation)
  } : null);

  let analysis = {
    hasPreviousLogin: false,
    lastLoginLocation: null,
    distanceFromLastLoginMeters: 0,
    timeElapsedSeconds: 0,
    speedMps: 0,
    speedKmh: 0,
    isMockLocation: Boolean(isClientMock),
    mockSource: mockSource || (isClientMock ? 'Simulated Location Provider' : null),
    mockReason: null,
    status: 'NORMAL',
    currentLocation: {
      latitude: newLat,
      longitude: newLng,
      accuracy: accuracy,
      locationName: newLocationName,
      timestamp: now,
      isMock: Boolean(isClientMock)
    }
  };

  if (prevLoc) {
    analysis.hasPreviousLogin = true;
    analysis.lastLoginLocation = {
      latitude: prevLoc.latitude,
      longitude: prevLoc.longitude,
      timestamp: prevLoc.timestamp,
      locationName: prevLoc.locationName || resolveLocationName(prevLoc.latitude, prevLoc.longitude),
      isMock: Boolean(prevLoc.isMock)
    };

    const distM = getDistanceMeters(prevLoc.latitude, prevLoc.longitude, newLat, newLng);
    const timeDeltaSec = Math.max(1, Math.round((now - prevLoc.timestamp) / 1000));
    const speedMps = distM / timeDeltaSec;
    const speedKmh = speedMps * 3.6;

    analysis.distanceFromLastLoginMeters = Math.round(distM);
    analysis.timeElapsedSeconds = timeDeltaSec;
    analysis.speedMps = parseFloat(speedMps.toFixed(2));
    analysis.speedKmh = parseFloat(speedKmh.toFixed(1));

    // Teleport / Mock detection heuristics:
    // Speeds > 50 m/s (~180 km/h) over a distance jump > 120m indicate teleportation / mock location
    if (speedMps > 50 && distM > 120) {
      analysis.isMockLocation = true;
      analysis.mockSource = analysis.mockSource || 'Velocity Jump / Teleportation';
      analysis.mockReason = `Impossible velocity (${Math.round(speedKmh)} km/h across ${Math.round(distM)}m in ${timeDeltaSec}s) - Teleportation Mock Detected`;
      analysis.status = 'MOCK_DETECTED';
    } else if (isClientMock) {
      analysis.isMockLocation = true;
      analysis.mockSource = mockSource || 'Client Mock Provider';
      analysis.mockReason = `Mock location active (${mockSource || 'Pin drag/teleport'})`;
      analysis.status = 'MOCK_REPORTED';
    } else if (distM > 500) {
      analysis.status = 'RELOCATED';
    } else {
      analysis.status = 'VERIFIED_LOCATION';
    }
  } else {
    if (isClientMock) {
      analysis.isMockLocation = true;
      analysis.mockSource = mockSource || 'Client Mock Provider';
      analysis.mockReason = 'Initial login with mock location';
      analysis.status = 'MOCK_REPORTED';
    } else {
      analysis.status = 'INITIAL_VERIFIED';
    }
  }

  analysis.currentLocation.isMock = analysis.isMockLocation;
  return analysis;
}

// Connected / Registered Users Store with Pre-seeded Accounts
let registeredUsers = new Map();

function seedUser(email, password, name, role, lat, lng, isSimulated = false) {
  const normEmail = email.trim().toLowerCase();
  const locName = resolveLocationName(lat, lng);
  const baselineTime = Date.now() - 3600000 * 2; // 2 hours prior as baseline
  registeredUsers.set(normEmail, {
    email: normEmail,
    password: password,
    name: name,
    role: role,
    latitude: lat,
    longitude: lng,
    accuracy: 4.5,
    networkState: "WiFi",
    batteryLevel: 94,
    lastPing: Date.now(),
    isSimulated: isSimulated,
    isMockLocation: false,
    mockSource: null,
    mockReason: null,
    locationName: locName,
    lastLoginLocation: {
      latitude: lat,
      longitude: lng,
      timestamp: baselineTime,
      locationName: locName,
      isMock: false
    },
    loginHistory: [{
      timestamp: baselineTime,
      latitude: lat,
      longitude: lng,
      locationName: locName,
      isMock: false,
      distanceMovedMeters: 0,
      speedMps: 0,
      status: 'INITIAL_VERIFIED'
    }],
    status: "NORMAL"
  });
}

// 1. Admin
seedUser("admin@safepath.com", "admin", "Campus Admin", "Admin", 33.8820, -117.8850, false);

// 2. The 5 Students specified by user
seedUser("johaliman@csu.fullerton.edu", "johanliman", "Johan", "Student", 33.8802, -117.8858);
const johanUserRef = registeredUsers.get("johaliman@csu.fullerton.edu");
registeredUsers.set("johanliman@csu.fullerton.edu", johanUserRef);
registeredUsers.set("johan.liman@csu.fullerton.edu", johanUserRef);
seedUser("d.wu@csu.fullerton.edu", "danielwu", "Daniel", "Student", 33.8813, -117.8854);
registeredUsers.set("daniel.wu@csu.fullerton.edu", registeredUsers.get("d.wu@csu.fullerton.edu"));
seedUser("yu-cheng.chang@csu.fullerton.edu", "yuchengchang", "Yu", "Student", 33.8820, -117.8885);
seedUser("jchen102951@csu.fullerton.edu", "jiechen", "Jie", "Student", 33.8829, -117.8828);
registeredUsers.set("jie.chen@csu.fullerton.edu", registeredUsers.get("jchen102951@csu.fullerton.edu"));
seedUser("siling313@csu.fullerton.edu", "siling", "Siling", "Student", 33.8835, -117.8870);
registeredUsers.set("siling.liu@csu.fullerton.edu", registeredUsers.get("siling313@csu.fullerton.edu"));

// SSE Subscribers (Real-time alert dispatch to web browsers & mobile clients)
const sseClients = new Set();

function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Helper: Parse JSON Body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Helper: Content-Type MIME lookup
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS Headers for API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Real-Time Server-Sent Events (SSE) Stream ---
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const clientId = Date.now() + Math.random().toString(36).substr(2, 9);
    const clientRecord = { id: clientId, res, ip: req.socket.remoteAddress };
    sseClients.add(clientRecord);

    // Initial sync
    res.write(`event: init\ndata: ${JSON.stringify({
      activeAlerts,
      userCount: registeredUsers.size,
      serverTime: Date.now()
    })}\n\n`);

    // Keep alive heartbeat ping every 15 seconds
    const interval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(interval);
      sseClients.delete(clientRecord);
    });
    return;
  }

  // --- REST APIs ---
  // 1. GET Campus Data
  if (method === 'GET' && pathname === '/api/campus') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(campusData));
    return;
  }

  // 2. GET Active & Archived Alerts
  if (method === 'GET' && pathname === '/api/alerts') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active: activeAlerts,
      history: alertHistory
    }));
    return;
  }

  // 3. POST Broadcast New Emergency Alert (Admin)
  if (method === 'POST' && pathname === '/api/alerts') {
    try {
      const data = await parseBody(req);
      if (!data.type || !data.latitude || !data.longitude || !data.radiusMeters) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required alert fields (type, latitude, longitude, radiusMeters)' }));
        return;
      }

      // Find matching type template
      const template = campusData?.emergencyTypes.find(t => t.id === data.type) || {
        id: data.type,
        name: data.type,
        icon: '⚠️',
        color: '#dc2626',
        instructions: 'Emergency alert in progress. Take protective action.'
      };

      const newAlert = {
        id: 'alert-' + Date.now(),
        type: data.type,
        name: template.name,
        icon: template.icon,
        color: '#ef4444',
        severity: data.severity || template.severity || 'CRITICAL',
        title: data.title || `${template.name} Declared`,
        instructions: data.instructions || template.instructions,
        latitude: parseFloat(data.latitude),
        longitude: parseFloat(data.longitude),
        radiusMeters: parseFloat(data.radiusMeters),
        recommendedSafeZoneId: data.recommendedSafeZoneId || 'SZ1',
        timestamp: Date.now(),
        active: true,
        broadcastBy: data.broadcastBy || 'Campus Emergency Operations Center (Admin)'
      };

      activeAlerts.unshift(newAlert);
      alertHistory.unshift(newAlert);

      // Evaluate proximity for all registered student users (Admin is the dispatcher, not a student recipient)
      const affectedUsers = [];
      const studentRecipients = [];
      for (const [email, user] of registeredUsers.entries()) {
        if (user.role === 'Admin' || user.email === 'admin@safepath.com') continue;
        studentRecipients.push(user);
        const dist = getDistanceMeters(user.latitude, user.longitude, newAlert.latitude, newAlert.longitude);
        if (dist <= newAlert.radiusMeters) {
          user.status = 'IN HAZARD';
          affectedUsers.push({ email: user.email, name: user.name, distanceMeters: Math.round(dist) });
        } else if (dist <= newAlert.radiusMeters + 120) {
          user.status = 'PROXIMITY WARNING';
        }
      }

      // Broadcast immediately via SSE to all connected clients!
      broadcastSSE('alert_broadcast', {
        alert: newAlert,
        affectedUserCount: affectedUsers.length,
        affectedUsers,
        serverTimestamp: newAlert.timestamp
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        alert: newAlert,
        recipientsNotified: studentRecipients.length,
        affectedCount: affectedUsers.length,
        affectedUsers
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 4. DELETE /api/alerts or POST /api/alerts/clear (Cancel / Remove All Alerts)
  if ((method === 'DELETE' && (pathname === '/api/alerts' || pathname === '/api/alerts/all')) ||
      (method === 'POST' && (pathname === '/api/alerts/clear' || pathname === '/api/alerts/delete'))) {
    const cleared = activeAlerts.splice(0, activeAlerts.length);
    cleared.forEach(a => {
      a.active = false;
      a.resolvedAt = Date.now();
      broadcastSSE('alert_resolved', { alertId: a.id, resolvedAt: Date.now() });
    });
    broadcastSSE('alert_cleared', { count: cleared.length, timestamp: Date.now() });
    for (const [email, user] of registeredUsers.entries()) {
      user.status = 'NORMAL';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: cleared.length }));
    return;
  }

  // 4b. DELETE /api/alerts/:id (Cancel / Resolve Single Alert)
  if (method === 'DELETE' && pathname.startsWith('/api/alerts/')) {
    const alertId = pathname.replace('/api/alerts/', '');
    const idx = activeAlerts.findIndex(a => a.id === alertId);
    if (idx !== -1) {
      const removed = activeAlerts.splice(idx, 1)[0];
      removed.active = false;
      removed.resolvedAt = Date.now();

      // Reset user hazard statuses if no other alerts apply
      for (const [email, user] of registeredUsers.entries()) {
        let stillInHazard = false;
        for (const a of activeAlerts) {
          const d = getDistanceMeters(user.latitude, user.longitude, a.latitude, a.longitude);
          if (d <= a.radiusMeters) {
            stillInHazard = true;
            break;
          }
        }
        if (!stillInHazard) {
          user.status = 'NORMAL';
        }
      }

      broadcastSSE('alert_resolved', {
        alertId,
        resolvedAt: Date.now()
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, resolvedId: alertId }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Alert not found' }));
    }
    return;
  }

  // 5a. POST /api/auth/login
  if (method === 'POST' && pathname === '/api/auth/login') {
    try {
      const data = await parseBody(req);
      const rawEmail = (data.email || '').trim().toLowerCase();
      const password = (data.password || '').trim();

      const emailAliases = {
        'johan.liman@csu.fullerton.edu': 'johaliman@csu.fullerton.edu',
        'johanliman@csu.fullerton.edu': 'johaliman@csu.fullerton.edu',
        'johanliman': 'johaliman@csu.fullerton.edu',
        'daniel.wu@csu.fullerton.edu': 'd.wu@csu.fullerton.edu',
        'danielwu@csu.fullerton.edu': 'd.wu@csu.fullerton.edu',
        'jie.chen@csu.fullerton.edu': 'jchen102951@csu.fullerton.edu',
        'jiechen@csu.fullerton.edu': 'jchen102951@csu.fullerton.edu',
        'yucheng.chang@csu.fullerton.edu': 'yu-cheng.chang@csu.fullerton.edu',
        'yuchengchang@csu.fullerton.edu': 'yu-cheng.chang@csu.fullerton.edu',
        'siling.liu@csu.fullerton.edu': 'siling313@csu.fullerton.edu',
        'silingliu@csu.fullerton.edu': 'siling313@csu.fullerton.edu'
      };
      const email = emailAliases[rawEmail] || rawEmail;

      if (!email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email and password are required' }));
        return;
      }

      const user = registeredUsers.get(email);
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'User not found. Please check your credentials or register.' }));
        return;
      }

      if (user.password && user.password !== password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid password. Please try again.' }));
        return;
      }

      const now = Date.now();
      const clientLat = (data.latitude !== undefined && data.latitude !== null && data.latitude !== '') ? parseFloat(data.latitude) : null;
      const clientLng = (data.longitude !== undefined && data.longitude !== null && data.longitude !== '') ? parseFloat(data.longitude) : null;
      const isClientMock = Boolean(data.isMock || data.isSimulated);
      const mockSource = data.mockSource || null;
      const accuracy = data.accuracy ? parseFloat(data.accuracy) : 4.5;

      // Determine login location (Real detected coordinates or current user coordinates)
      const lat = clientLat !== null ? clientLat : user.latitude;
      const lng = clientLng !== null ? clientLng : user.longitude;

      // Reverse geocode real location if outside campus
      if (clientLat !== null && clientLng !== null) {
        await reverseGeocodeOffCampus(lat, lng);
      }

      // Run algorithm: check last login location vs new detected location & detect mock/teleport
      const locationAnalysis = analyzeLocationChange(user, lat, lng, isClientMock, mockSource, accuracy);

      // Preserve previous location as lastLoginLocation before updating to current
      if (!user.lastLoginLocation) {
        user.lastLoginLocation = {
          latitude: user.latitude,
          longitude: user.longitude,
          timestamp: user.lastPing || (now - 3600000 * 2),
          locationName: resolveLocationName(user.latitude, user.longitude),
          isMock: Boolean(user.isMockLocation)
        };
      }

      // Update user current coordinates and state
      user.lastPing = now;
      user.latitude = lat;
      user.longitude = lng;
      user.accuracy = accuracy;
      user.locationName = locationAnalysis.currentLocation.locationName;
      user.isMockLocation = locationAnalysis.isMockLocation;
      user.mockSource = locationAnalysis.mockSource;
      user.mockReason = locationAnalysis.mockReason;
      user.lastLoginAnalysis = locationAnalysis;

      if (!user.loginHistory) user.loginHistory = [];
      user.loginHistory.unshift({
        timestamp: now,
        latitude: lat,
        longitude: lng,
        locationName: user.locationName,
        isMock: user.isMockLocation,
        distanceMovedMeters: locationAnalysis.distanceFromLastLoginMeters,
        speedMps: locationAnalysis.speedMps,
        status: locationAnalysis.status
      });
      if (user.loginHistory.length > 20) user.loginHistory.pop();

      // Proximity check against active alerts
      let userAlerts = [];
      for (const alert of activeAlerts) {
        const d = getDistanceMeters(user.latitude, user.longitude, alert.latitude, alert.longitude);
        if (d <= alert.radiusMeters) {
          user.status = 'IN HAZARD';
          userAlerts.push({ alert, distanceMeters: Math.round(d) });
        }
      }

      // Notify SSE admin map and listeners of new login location & mock status
      broadcastSSE('user_location_update', {
        email: user.email,
        name: user.name,
        latitude: user.latitude,
        longitude: user.longitude,
        accuracy: user.accuracy,
        status: user.status,
        batteryLevel: user.batteryLevel,
        networkState: user.networkState,
        lastPing: user.lastPing,
        isMockLocation: user.isMockLocation,
        mockSource: user.mockSource,
        locationName: user.locationName,
        lastLoginLocation: user.lastLoginLocation,
        distanceFromLastLoginMeters: locationAnalysis.distanceFromLastLoginMeters
      });

      const safeUser = { ...user };
      delete safeUser.password;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        user: safeUser,
        locationAnalysis,
        lastLoginLocation: user.lastLoginLocation,
        activeAlertsCount: activeAlerts.length,
        nearbyAlerts: userAlerts
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 5b. POST /api/auth/register (New User Registration with Location capture)
  if (method === 'POST' && pathname === '/api/auth/register') {
    try {
      const data = await parseBody(req);
      const email = (data.email || '').trim().toLowerCase();
      const password = (data.password || '').trim();
      const name = (data.name || '').trim();

      if (!email || !email.includes('@')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A valid email address is required' }));
        return;
      }
      if (!password || password.length < 3) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Password must be at least 3 characters' }));
        return;
      }

      if (registeredUsers.has(email)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'An account with this email already exists. Please log in.' }));
        return;
      }

      const lat = (data.latitude !== undefined && data.latitude !== null) ? parseFloat(data.latitude) : 33.8820;
      const lng = (data.longitude !== undefined && data.longitude !== null) ? parseFloat(data.longitude) : -117.8850;
      const role = data.role || (email.includes('admin') ? 'Admin' : 'Student');
      const displayName = name || email.split('@')[0];

      const newUser = {
        email,
        password,
        name: displayName,
        role,
        latitude: lat,
        longitude: lng,
        accuracy: data.accuracy ? parseFloat(data.accuracy) : 5.0,
        networkState: data.networkState || 'WiFi',
        batteryLevel: data.batteryLevel !== undefined ? data.batteryLevel : 96,
        lastPing: Date.now(),
        isSimulated: false,
        status: 'NORMAL'
      };

      registeredUsers.set(email, newUser);

      // Check proximity
      let userAlerts = [];
      for (const alert of activeAlerts) {
        const d = getDistanceMeters(newUser.latitude, newUser.longitude, alert.latitude, alert.longitude);
        if (d <= alert.radiusMeters) {
          newUser.status = 'IN HAZARD';
          userAlerts.push({ alert, distanceMeters: Math.round(d) });
        }
      }

      // Notify SSE admin map
      broadcastSSE('user_location_update', {
        email: newUser.email,
        name: newUser.name,
        latitude: newUser.latitude,
        longitude: newUser.longitude,
        accuracy: newUser.accuracy,
        status: newUser.status,
        batteryLevel: newUser.batteryLevel,
        networkState: newUser.networkState,
        lastPing: newUser.lastPing
      });

      const safeUser = { ...newUser };
      delete safeUser.password;

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        user: safeUser,
        activeAlertsCount: activeAlerts.length,
        nearbyAlerts: userAlerts
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 5. POST Google Email Registration & Auth
  if (method === 'POST' && pathname === '/api/auth/google') {
    try {
      const data = await parseBody(req);
      const email = (data.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A valid Google email address is required (e.g. user@gmail.com or student@csu.fullerton.edu)' }));
        return;
      }

      let user = registeredUsers.get(email);
      if (!user) {
        user = {
          email,
          name: data.name || email.split('@')[0],
          role: data.role || (email.includes('admin') ? 'Admin' : 'Student'),
          latitude: data.latitude || 33.8813,
          longitude: data.longitude || -117.8854,
          accuracy: data.accuracy || 5.0,
          networkState: 'WiFi',
          batteryLevel: 98,
          lastPing: Date.now(),
          isSimulated: false,
          status: 'NORMAL'
        };
        registeredUsers.set(email, user);
      } else {
        user.lastPing = Date.now();
        if (data.name) user.name = data.name;
        if (data.latitude) user.latitude = data.latitude;
        if (data.longitude) user.longitude = data.longitude;
      }

      // Check current proximity to active alerts
      let userAlerts = [];
      for (const alert of activeAlerts) {
        const d = getDistanceMeters(user.latitude, user.longitude, alert.latitude, alert.longitude);
        if (d <= alert.radiusMeters) {
          user.status = 'IN HAZARD';
          userAlerts.push({ alert, distanceMeters: Math.round(d) });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        user,
        activeAlertsCount: activeAlerts.length,
        nearbyAlerts: userAlerts
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 6. POST Update User Location (Allows user to change coordinates or drag pin)
  if (method === 'POST' && pathname === '/api/users/location') {
    try {
      const data = await parseBody(req);
      const rawEmail = (data.email || '').trim().toLowerCase();
      const emailAliases = {
        'johan.liman@csu.fullerton.edu': 'johaliman@csu.fullerton.edu',
        'johanliman@csu.fullerton.edu': 'johaliman@csu.fullerton.edu',
        'johanliman': 'johaliman@csu.fullerton.edu',
        'daniel.wu@csu.fullerton.edu': 'd.wu@csu.fullerton.edu',
        'danielwu@csu.fullerton.edu': 'd.wu@csu.fullerton.edu',
        'jie.chen@csu.fullerton.edu': 'jchen102951@csu.fullerton.edu',
        'jiechen@csu.fullerton.edu': 'jchen102951@csu.fullerton.edu',
        'yucheng.chang@csu.fullerton.edu': 'yu-cheng.chang@csu.fullerton.edu',
        'yuchengchang@csu.fullerton.edu': 'yu-cheng.chang@csu.fullerton.edu',
        'siling.liu@csu.fullerton.edu': 'siling313@csu.fullerton.edu',
        'silingliu@csu.fullerton.edu': 'siling313@csu.fullerton.edu'
      };
      const email = emailAliases[rawEmail] || rawEmail;
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'User email is required' }));
        return;
      }

      let user = registeredUsers.get(email);
      const newLat = parseFloat(data.latitude);
      const newLng = parseFloat(data.longitude);
      const accuracy = parseFloat(data.accuracy || 5.0);
      const isClientMock = Boolean(data.isMock || data.isSimulated);
      const mockSource = data.mockSource || null;
      const now = Date.now();

      if (!isNaN(newLat) && !isNaN(newLng)) {
        await reverseGeocodeOffCampus(newLat, newLng);
      }

      if (!user) {
        const locName = resolveLocationName(newLat, newLng);
        user = {
          email,
          name: email.split('@')[0],
          role: 'Student',
          latitude: newLat,
          longitude: newLng,
          accuracy: accuracy,
          networkState: data.networkState || 'WiFi',
          batteryLevel: data.batteryLevel !== undefined ? data.batteryLevel : 90,
          lastPing: now,
          isSimulated: isClientMock,
          isMockLocation: isClientMock,
          mockSource: mockSource || (isClientMock ? 'Simulated Location Provider' : null),
          locationName: locName,
          lastLoginLocation: {
            latitude: newLat,
            longitude: newLng,
            timestamp: now,
            locationName: locName,
            isMock: isClientMock
          },
          status: 'NORMAL'
        };
        registeredUsers.set(email, user);
      } else {
        // Algorithm: compare previous position to new position
        const prevLat = user.latitude;
        const prevLng = user.longitude;
        const prevTime = user.lastPing || (now - 5000);
        const distMoved = getDistanceMeters(prevLat, prevLng, newLat, newLng);
        const timeElapsedSec = Math.max(1, Math.round((now - prevTime) / 1000));
        const velocityMps = distMoved / timeElapsedSec;

        let isMock = isClientMock;
        let reason = mockSource;

        // Teleportation detection heuristic: velocity > 50 m/s (180 km/h) over > 100 meters
        if (velocityMps > 50 && distMoved > 100) {
          isMock = true;
          reason = `Velocity jump (${Math.round(velocityMps * 3.6)} km/h across ${Math.round(distMoved)}m in ${timeElapsedSec}s) - Teleported Mock`;
        }

        user.latitude = newLat;
        user.longitude = newLng;
        user.accuracy = accuracy;
        user.locationName = resolveLocationName(newLat, newLng);
        user.isMockLocation = isMock;
        user.mockSource = reason || (isMock ? 'Mock Location' : null);
        if (data.networkState) user.networkState = data.networkState;
        if (data.batteryLevel !== undefined) user.batteryLevel = data.batteryLevel;
        user.lastPing = now;

        // Ensure lastLoginLocation exists
        if (!user.lastLoginLocation) {
          user.lastLoginLocation = {
            latitude: prevLat,
            longitude: prevLng,
            timestamp: prevTime,
            locationName: resolveLocationName(prevLat, prevLng),
            isMock: Boolean(user.isMockLocation)
          };
        }

        user.distanceFromLastLoginMeters = Math.round(getDistanceMeters(
          user.lastLoginLocation.latitude,
          user.lastLoginLocation.longitude,
          newLat,
          newLng
        ));
      }

      if (data.distanceMeters !== undefined) user.distanceMeters = data.distanceMeters;
      if (data.estMinutes !== undefined) user.estMinutes = data.estMinutes;
      if (data.targetHaven !== undefined) user.targetHaven = data.targetHaven;

      // Check proximity against all active emergency alerts
      let inHazard = false;
      let inWarning = false;
      let triggeredAlerts = [];

      for (const alert of activeAlerts) {
        const dist = getDistanceMeters(user.latitude, user.longitude, alert.latitude, alert.longitude);
        if (dist <= alert.radiusMeters) {
          inHazard = true;
          triggeredAlerts.push({
            alert,
            distanceMeters: Math.round(dist),
            severity: 'CRITICAL',
            actionRequired: 'EVACUATE IMMEDIATELY'
          });
        } else if (dist <= alert.radiusMeters + 120) {
          inWarning = true;
          triggeredAlerts.push({
            alert,
            distanceMeters: Math.round(dist),
            severity: 'WARNING',
            actionRequired: 'PROCEED WITH CAUTION'
          });
        }
      }

      user.status = inHazard ? 'IN HAZARD' : (inWarning ? 'PROXIMITY WARNING' : 'NORMAL');

      // Inform Admin fleet map and monitoring table in real-time
      broadcastSSE('user_location_update', {
        email: user.email,
        name: user.name,
        latitude: user.latitude,
        longitude: user.longitude,
        accuracy: user.accuracy,
        status: user.status,
        batteryLevel: user.batteryLevel,
        networkState: user.networkState,
        distanceMeters: user.distanceMeters,
        estMinutes: user.estMinutes,
        targetHaven: user.targetHaven,
        lastPing: user.lastPing,
        isMockLocation: user.isMockLocation,
        mockSource: user.mockSource,
        locationName: user.locationName,
        lastLoginLocation: user.lastLoginLocation,
        distanceFromLastLoginMeters: user.distanceFromLastLoginMeters
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        status: user.status,
        distanceMeters: user.distanceMeters,
        estMinutes: user.estMinutes,
        isMockLocation: user.isMockLocation,
        mockSource: user.mockSource,
        locationName: user.locationName,
        lastLoginLocation: user.lastLoginLocation,
        distanceFromLastLoginMeters: user.distanceFromLastLoginMeters,
        triggeredAlerts,
        serverTime: Date.now()
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 6b. POST /api/users/reset (Reset fleet back to realistic campus building locations)
  if (method === 'POST' && pathname === '/api/users/reset') {
    const initialCoords = {
      'daniel.wu@csu.fullerton.edu': { lat: 33.8813, lng: -117.8854, name: 'Daniel' },
      'd.wu@csu.fullerton.edu': { lat: 33.8813, lng: -117.8854, name: 'Daniel' },
      'johan.liman@csu.fullerton.edu': { lat: 33.8802, lng: -117.8858, name: 'Johan' },
      'johaliman@csu.fullerton.edu': { lat: 33.8802, lng: -117.8858, name: 'Johan' },
      'jie.chen@csu.fullerton.edu': { lat: 33.8829, lng: -117.8828, name: 'Jie' },
      'jchen102951@csu.fullerton.edu': { lat: 33.8829, lng: -117.8828, name: 'Jie' },
      'yucheng.chang@csu.fullerton.edu': { lat: 33.8820, lng: -117.8885, name: 'Yu' },
      'yu-cheng.chang@csu.fullerton.edu': { lat: 33.8820, lng: -117.8885, name: 'Yu' },
      'siling.liu@csu.fullerton.edu': { lat: 33.8835, lng: -117.8870, name: 'Siling' },
      'siling313@csu.fullerton.edu': { lat: 33.8835, lng: -117.8870, name: 'Siling' }
    };
    const defaultStudents = [
      { email: "johaliman@csu.fullerton.edu", name: "Johan", lat: 33.8802, lng: -117.8858 },
      { email: "d.wu@csu.fullerton.edu", name: "Daniel", lat: 33.8813, lng: -117.8854 },
      { email: "yu-cheng.chang@csu.fullerton.edu", name: "Yu", lat: 33.8820, lng: -117.8885 },
      { email: "jchen102951@csu.fullerton.edu", name: "Jie", lat: 33.8829, lng: -117.8828 },
      { email: "siling313@csu.fullerton.edu", name: "Siling", lat: 33.8835, lng: -117.8870 }
    ];
    for (const ds of defaultStudents) {
      if (!registeredUsers.has(ds.email)) {
        seedUser(ds.email, "studentpass", ds.name, "Student", ds.lat, ds.lng);
      }
    }

    for (const [email, user] of registeredUsers.entries()) {
      const init = initialCoords[email];
      if (init) {
        user.latitude = init.lat;
        user.longitude = init.lng;
        user.status = 'NORMAL';
        user.isMockLocation = false;
        user.mockSource = null;
        user.mockReason = null;
        user.locationName = resolveLocationName(init.lat, init.lng);
        user.lastLoginLocation = {
          latitude: init.lat,
          longitude: init.lng,
          timestamp: Date.now() - 3600000 * 2,
          locationName: user.locationName,
          isMock: false
        };
        user.distanceFromLastLoginMeters = 0;
        delete user.distanceMeters;
        delete user.estMinutes;
        delete user.targetHaven;
        broadcastSSE('user_location_update', {
          email: user.email,
          name: user.name,
          latitude: user.latitude,
          longitude: user.longitude,
          status: 'NORMAL',
          batteryLevel: user.batteryLevel,
          networkState: user.networkState,
          lastPing: Date.now(),
          isMockLocation: false,
          mockSource: null,
          locationName: user.locationName,
          lastLoginLocation: user.lastLoginLocation,
          distanceFromLastLoginMeters: 0
        });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'All student coordinates reset to initial campus locations' }));
    return;
  }

  // 7. GET Users (For Admin Fleet Display) - returns registered students, hides Admin and strips passwords
  if (method === 'GET' && pathname === '/api/users') {
    const seenEmails = new Set();
    const list = [];
    for (const user of registeredUsers.values()) {
      if (user.role === 'Admin' || user.email === 'admin@safepath.com') continue;
      if (seenEmails.has(user.email)) continue;
      seenEmails.add(user.email);
      const safe = { ...user };
      delete safe.password;
      list.push(safe);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalUsers: list.length,
      users: list
    }));
    return;
  }

  // 7b. DELETE /api/users (Delete/remove student user)
  if ((method === 'DELETE' && (pathname === '/api/users' || pathname.startsWith('/api/users/'))) ||
      (method === 'POST' && pathname === '/api/users/delete')) {
    try {
      let emailToDelete = '';
      if (pathname.startsWith('/api/users/')) {
        emailToDelete = decodeURIComponent(pathname.substring('/api/users/'.length)).trim().toLowerCase();
      }
      if (!emailToDelete) {
        const data = await parseBody(req);
        emailToDelete = (data.email || '').trim().toLowerCase();
      }
      if (!emailToDelete) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Email is required to delete user' }));
        return;
      }

      const emailAliases = {
        'daniel.wu@csu.fullerton.edu': 'd.wu@csu.fullerton.edu',
        'd.wu@csu.fullerton.edu': 'daniel.wu@csu.fullerton.edu',
        'johan.liman@csu.fullerton.edu': 'johaliman@csu.fullerton.edu',
        'johaliman@csu.fullerton.edu': 'johan.liman@csu.fullerton.edu',
        'jie.chen@csu.fullerton.edu': 'jchen102951@csu.fullerton.edu',
        'jchen102951@csu.fullerton.edu': 'jie.chen@csu.fullerton.edu',
        'yu.chang@csu.fullerton.edu': 'yu-cheng.chang@csu.fullerton.edu',
        'yu-cheng.chang@csu.fullerton.edu': 'yu.chang@csu.fullerton.edu',
        'siling313@csu.fullerton.edu': 'siling.liu@csu.fullerton.edu',
        'siling.liu@csu.fullerton.edu': 'siling313@csu.fullerton.edu'
      };

      const deleted = registeredUsers.delete(emailToDelete);
      const alias = emailAliases[emailToDelete];
      if (alias) registeredUsers.delete(alias);

      broadcastSSE('USER_DELETED', { email: emailToDelete });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `User ${emailToDelete} deleted`, deleted }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 8. GET Research Metrics & Performance Telemetry
  if (method === 'GET' && pathname === '/api/metrics') {
    const studentCount = Array.from(registeredUsers.values()).filter(
      u => u.role !== 'Admin' && u.email !== 'admin@safepath.com'
    ).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      activeConnections: sseClients.size,
      totalRegisteredUsers: studentCount,
      activeAlertsCount: activeAlerts.length,
      serverUptimeSec: Math.round(process.uptime()),
      memoryUsageBytes: process.memoryUsage().heapUsed,
      timestamp: Date.now()
    }));
    return;
  }

  // --- Static Files Serving ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  // Auto add .html extension if missing
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
    filePath += '.html';
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback: if not found, serve 404 or index
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` SafePath Emergency Alert & Safe Route Web System`);
  console.log(` CPSC 515 Mobile Computing Group Project`);
  console.log(` Server running at http://localhost:${PORT}`);
  console.log(` - Admin Panel:       http://localhost:${PORT}/admin.html`);
  console.log(` - User Mobile Panel: http://localhost:${PORT}/user.html`);
  console.log(` - Split Live Demo:   http://localhost:${PORT}/demo.html`);
  console.log(`=======================================================`);
});
