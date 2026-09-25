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

// Connected / Registered Users Store
let registeredUsers = new Map();
// Seed with realistic demo student accounts
registeredUsers.set("daniel.wu@csu.fullerton.edu", {
  email: "daniel.wu@csu.fullerton.edu",
  name: "Daniel",
  role: "Student",
  latitude: 33.8813,
  longitude: -117.8854,
  accuracy: 4.5,
  networkState: "WiFi",
  batteryLevel: 92,
  lastPing: Date.now(),
  isSimulated: false,
  status: "NORMAL"
});
registeredUsers.set("johan.liman@csu.fullerton.edu", {
  email: "johan.liman@csu.fullerton.edu",
  name: "Johan",
  role: "Student",
  latitude: 33.8802,
  longitude: -117.8858,
  accuracy: 12.0,
  networkState: "4G",
  batteryLevel: 84,
  lastPing: Date.now(),
  isSimulated: true,
  status: "NORMAL"
});
registeredUsers.set("jie.chen@csu.fullerton.edu", {
  email: "jie.chen@csu.fullerton.edu",
  name: "Jie",
  role: "Student",
  latitude: 33.8829,
  longitude: -117.8828,
  accuracy: 3.2,
  networkState: "WiFi",
  batteryLevel: 78,
  lastPing: Date.now(),
  isSimulated: true,
  status: "NORMAL"
});
registeredUsers.set("yucheng.chang@csu.fullerton.edu", {
  email: "yucheng.chang@csu.fullerton.edu",
  name: "Yu",
  role: "Student",
  latitude: 33.8820,
  longitude: -117.8885,
  accuracy: 18.5,
  networkState: "WeakCellular",
  batteryLevel: 45,
  lastPing: Date.now(),
  isSimulated: true,
  status: "NORMAL"
});
registeredUsers.set("siling.liu@csu.fullerton.edu", {
  email: "siling.liu@csu.fullerton.edu",
  name: "Siling",
  role: "Student",
  latitude: 33.8835,
  longitude: -117.8870,
  accuracy: 5.0,
  networkState: "WiFi",
  batteryLevel: 89,
  lastPing: Date.now(),
  isSimulated: true,
  status: "NORMAL"
});

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

// Distance Calculation (Haversine in meters)
function getDistanceMeters(lat1, lon1, lat2, lon2) {
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

      // Evaluate proximity for all registered users
      const affectedUsers = [];
      for (const [email, user] of registeredUsers.entries()) {
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
        recipientsNotified: Math.max(registeredUsers.size, sseClients.size),
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
      const email = (data.email || '').trim().toLowerCase();
      if (!email) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'User email is required' }));
        return;
      }

      let user = registeredUsers.get(email);
      if (!user) {
        user = {
          email,
          name: email.split('@')[0],
          role: 'Student',
          latitude: parseFloat(data.latitude),
          longitude: parseFloat(data.longitude),
          accuracy: parseFloat(data.accuracy || 5.0),
          networkState: data.networkState || 'WiFi',
          batteryLevel: data.batteryLevel !== undefined ? data.batteryLevel : 90,
          lastPing: Date.now(),
          isSimulated: false,
          status: 'NORMAL'
        };
        registeredUsers.set(email, user);
      } else {
        user.latitude = parseFloat(data.latitude);
        user.longitude = parseFloat(data.longitude);
        user.accuracy = parseFloat(data.accuracy || user.accuracy);
        if (data.networkState) user.networkState = data.networkState;
        if (data.batteryLevel !== undefined) user.batteryLevel = data.batteryLevel;
        user.lastPing = Date.now();
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
        lastPing: user.lastPing
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        status: user.status,
        distanceMeters: user.distanceMeters,
        estMinutes: user.estMinutes,
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
      'johan.liman@csu.fullerton.edu': { lat: 33.8802, lng: -117.8858, name: 'Johan' },
      'jie.chen@csu.fullerton.edu': { lat: 33.8829, lng: -117.8828, name: 'Jie' },
      'yucheng.chang@csu.fullerton.edu': { lat: 33.8820, lng: -117.8885, name: 'Yu' },
      'siling.liu@csu.fullerton.edu': { lat: 33.8835, lng: -117.8870, name: 'Siling' }
    };
    for (const [email, user] of registeredUsers.entries()) {
      const init = initialCoords[email];
      if (init) {
        user.latitude = init.lat;
        user.longitude = init.lng;
        user.status = 'NORMAL';
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
          lastPing: Date.now()
        });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'All student coordinates reset to initial campus locations' }));
    return;
  }

  // 7. GET Users (For Admin Fleet Display)
  if (method === 'GET' && pathname === '/api/users') {
    const list = Array.from(registeredUsers.values());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      totalUsers: list.length,
      users: list
    }));
    return;
  }

  // 8. GET Research Metrics & Performance Telemetry
  if (method === 'GET' && pathname === '/api/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      activeConnections: sseClients.size,
      totalRegisteredUsers: registeredUsers.size,
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
