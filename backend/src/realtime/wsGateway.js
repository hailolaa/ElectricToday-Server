const { WebSocketServer } = require("ws");
const { URL } = require("url");
const { verifyToken } = require("../services/auth.service");
const userModel = require("../models/user.model");
const { buildEnergySnapshotForUser } = require("../services/energySnapshot.service");
const notificationModel = require("../models/notification.model");

const USER_SOCKETS = new Map(); // userId -> Set<WebSocket>
const USER_SEQ = new Map(); // userId -> number
let wss = null;
let heartbeatTimer = null;

function _registerSocket(userId, ws) {
  if (!USER_SOCKETS.has(userId)) {
    USER_SOCKETS.set(userId, new Set());
  }
  USER_SOCKETS.get(userId).add(ws);
}

function _unregisterSocket(userId, ws) {
  const set = USER_SOCKETS.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    USER_SOCKETS.delete(userId);
  }
}

function _nextSequence(userId) {
  const next = (USER_SEQ.get(userId) || 0) + 1;
  USER_SEQ.set(userId, next);
  return next;
}

function _extractToken(req, parsedUrl) {
  const queryToken = parsedUrl.searchParams.get("token");
  if (queryToken) return queryToken;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

function _isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true; // non-browser clients
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return process.env.NODE_ENV !== "production";
  }
  if (allowedOrigins.includes(origin)) return true;

  // Allow localhost on any port (Flutter web dev server uses random ports).
  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return true;
    }
  } catch { /* invalid origin */ }

  return false;
}

function _broadcastToUser(userId, message) {
  const set = USER_SOCKETS.get(userId);
  if (!set || set.size === 0) return 0;

  let delivered = 0;
  const payload = JSON.stringify(message);
  for (const socket of set) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
      delivered += 1;
    }
  }
  return delivered;
}

async function pushLatestEnergySnapshot(userId, reason = "update") {
  const snapshot = buildEnergySnapshotForUser(userId);
  if (!snapshot) return false;
  return pushUserEvent(userId, "energy_snapshot", {
    reason,
    data: snapshot,
  });
}

function pushUserEvent(userId, type, { reason = "update", data = {} } = {}) {
  if (!userId || !type) return false;
  const message = {
    type,
    version: 1,
    reason,
    sequence: _nextSequence(userId),
    emittedAt: new Date().toISOString(),
    data: data && typeof data === "object" ? data : {},
  };
  _broadcastToUser(userId, message);
  return true;
}

function initWsGateway(httpServer, { allowedOrigins = [] } = {}) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const parsedUrl = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (parsedUrl.pathname !== "/ws/energy") {
      socket.destroy();
      return;
    }

    const origin = req.headers.origin;
    if (!_isOriginAllowed(origin, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] === "http") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const token = _extractToken(req, parsedUrl);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let user;
    try {
      const payload = verifyToken(token);
      user = userModel.findById(payload.userId);
      if (!user) throw new Error("user_not_found");
    } catch (_) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = user.id;
      ws.isAlive = true;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws) => {
    const userId = ws.userId;
    _registerSocket(userId, ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      _unregisterSocket(userId, ws);
    });

    ws.on("error", () => {
      _unregisterSocket(userId, ws);
    });

    await pushLatestEnergySnapshot(userId, "connected");

    // Push initial notification count so the app badge updates immediately
    try {
      const unreadCount = notificationModel.countUnread(userId);
      pushUserEvent(userId, "notifications_changed", {
        reason: "connected",
        data: { unreadCount },
      });
    } catch (_) { /* best-effort */ }
  });

  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  return wss;
}

function closeWsGateway() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (wss) {
    for (const ws of wss.clients) {
      ws.terminate();
    }
    wss.close();
    wss = null;
  }
  USER_SOCKETS.clear();
  USER_SEQ.clear();
}

function getConnectedSocketCount(userId) {
  if (userId == null) {
    let total = 0;
    for (const set of USER_SOCKETS.values()) {
      total += set.size;
    }
    return total;
  }
  return USER_SOCKETS.get(userId)?.size || 0;
}

module.exports = {
  initWsGateway,
  closeWsGateway,
  pushLatestEnergySnapshot,
  pushUserEvent,
  getConnectedSocketCount,
};
