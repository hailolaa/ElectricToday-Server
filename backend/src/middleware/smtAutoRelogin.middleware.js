/**
 * Middleware that transparently re-creates an SMT session when the in-memory
 * session has been lost (e.g. server restart) but the client carries a valid JWT.
 *
 * Flow:
 * 1. Check whether the request already has a valid SMT session ID.
 * 2. If yes → pass through.
 * 3. If not, but a valid JWT is present:
 *    a. Look up the user's stored SMT credentials.
 *    b. Re-login to SMT via the service layer.
 *    c. Inject the new session ID into the request headers so downstream
 *       handlers work as if nothing happened.
 *    d. Send the new session ID back via a response header so Flutter
 *       can update its local store.
 */
const jwt = require("jsonwebtoken");
const smtService = require("../services/smt.service");
const userModel = require("../models/user.model");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? "" : "supersecretjwtkey");

if (process.env.NODE_ENV === "production" && !JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in production.");
}

async function smtAutoRelogin(req, res, next) {
  // Skip for login / logout / provider-info – they don't need an existing session
  const path = req.path.toLowerCase();
  if (path === "/login" || path === "/logout" || path === "/provider") {
    return next();
  }

  // If there's already a session header, let the normal flow check it
  const existingSessionId =
    (req.headers["x-smt-session-id"] || "").trim() || null;

  if (existingSessionId) {
    // Quick check: does the session actually exist in the store?
    const sessionData = await smtService.getSessionData(existingSessionId);
    if (sessionData) {
      return next(); // Session is alive – proceed normally
    }
    // Session header is present but the session is gone. Fall through to re-login.
  }

  // Try to extract a JWT
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return next(); // No JWT either – let downstream handlers produce the normal error
  }

  const token = authHeader.split(" ")[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return next(); // Invalid JWT – not our problem here
  }

  const user = userModel.findById(decoded.userId);
  if (!user) {
    return next();
  }

  // Get the stored (encrypted) SMT credentials
  const creds = userModel.getSmtCredentials(user.id);
  if (!creds) {
    return next();
  }

  try {
    // Re-login to SMT (single call – no double login)
    const smtResult = await smtService.login({
      username: creds.username,
      password: creds.password,
      ESIID: creds.esiid,
      rememberMe: "true",
    });

    const newSessionId = smtResult?.meta?.sessionId;
    if (newSessionId) {
      // Inject into this request so downstream handlers pick it up
      req.headers["x-smt-session-id"] = newSessionId;

      // Tell the Flutter client to update its stored session ID
      res.setHeader("x-smt-new-session-id", newSessionId);

      console.log(
        `[auto-relogin] Re-created SMT session for user ${user.id} → ${newSessionId}`
      );
    }
  } catch (err) {
    console.warn(
      `[auto-relogin] Failed to re-login for user ${user.id}:`,
      err.message
    );
    // Fall through – the downstream handler will produce the normal session-expired error
  }

  next();
}

module.exports = { smtAutoRelogin };
