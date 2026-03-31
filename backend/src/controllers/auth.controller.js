const smtService = require("../services/smt.service");
const authService = require("../services/auth.service");
const { fetchAndStoreDailyUsage } = require("../services/sync.service");
const userModel = require("../models/user.model");
const { resolveUserRole } = require("../services/role.service");
const DEMO_ADMIN_USERNAME =
  process.env.DEMO_ADMIN_USERNAME ||
  (process.env.NODE_ENV === "production" ? "" : "admin");
const DEMO_ADMIN_PASSWORD =
  process.env.DEMO_ADMIN_PASSWORD ||
  (process.env.NODE_ENV === "production" ? "" : "admin123");

function isDemoAdminLogin(username, password) {
  if (!DEMO_ADMIN_USERNAME || !DEMO_ADMIN_PASSWORD) return false;
  return (
    username.toString().trim().toLowerCase() ===
      DEMO_ADMIN_USERNAME.toString().trim().toLowerCase() &&
    password.toString().trim() === DEMO_ADMIN_PASSWORD.toString().trim()
  );
}

/**
 * POST /api/auth/login
 *
 * 1. Login to SMT **once** via the service layer (verifies creds + creates managed session)
 * 2. Store / update user in local DB
 * 3. Grab the access-token from the session store and immediately sync 30 days of usage
 * 4. Return JWT + SMT session info
 *
 * ESIID is optional at login time — the SMT API authenticates with
 * username + password alone.  If omitted, the backend will try to
 * discover the default ESIID from the SMT session.  The Flutter app
 * collects the ESIID later during onboarding and can PATCH it via
 * PUT /api/user/esiid.
 */
exports.login = async (req, res) => {
  try {
    const { username, password, ESIID, esiid } = req.body;
    const resolvedEsiid = ESIID || esiid || null;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: "AUTH_VALIDATION_ERROR",
          message: "username and password are required.",
        },
      });
    }

    // Dev/staging demo-admin login path (disabled by default in production).
    if (isDemoAdminLogin(username, password)) {
      const syntheticEsiid =
        resolvedEsiid || `admin-demo-${username.toString().trim().toLowerCase()}`;
      const { userId, token, created } = authService.registerOrUpdate({
        smtUsername: username,
        smtPassword: password,
        esiid: syntheticEsiid,
        meterNumber: req.body.meterNumber || null,
      });
      const user = userModel.findById(userId);
      return res.json({
        success: true,
        operation: "login",
        data: {
          userId,
          token,
          accountCreated: created,
          smtSessionId: null,
          defaultEsiid: user?.esiid || syntheticEsiid,
          esiid: user?.esiid || syntheticEsiid,
          role: "admin",
          meterNumber: user?.meter_number || null,
          syncedPoints: 0,
        },
        meta: {
          timestamp: new Date().toISOString(),
          mode: "demo_admin",
        },
      });
    }

    // 1) Single SMT login – creates the managed session in the store
    const smtResult = await smtService.login({
      username,
      password,
      ...(resolvedEsiid ? { ESIID: resolvedEsiid } : {}),
      rememberMe: "true",
    });

    const smtSessionId = smtResult?.meta?.sessionId || null;

    // If caller didn't provide an ESIID, use the one SMT discovered.
    const discoveredEsiid = smtResult?.data?.defaultEsiid || null;
    const finalEsiid = resolvedEsiid || discoveredEsiid;

    // 2) Store user in DB (creates or updates)
    const { userId, token, created } = authService.registerOrUpdate({
      smtUsername: username,
      smtPassword: password,
      esiid: finalEsiid,
      meterNumber: req.body.meterNumber || null,
    });
    const user = userModel.findById(userId);
    const effectiveEsiid = finalEsiid || user?.esiid || null;
    const role = resolveUserRole(user);

    // 3) Retrieve the access-token from the session store (no second login)
    let syncResult = null;
    if (smtSessionId && finalEsiid) {
      try {
        const sessionData = await smtService.getSessionData(smtSessionId);
        const accessToken = sessionData?.accessToken;

        if (accessToken) {
          syncResult = await fetchAndStoreDailyUsage({
            userId,
            esiid: finalEsiid,
            meterNumber: req.body.meterNumber || null,
            accessToken,
            session: sessionData?.providerSession || null,
          });
          console.log(`[auth] Login sync for user ${userId}:`, syncResult);
        }
      } catch (syncErr) {
        console.warn(`[auth] Post-login sync failed (non-fatal):`, syncErr.message);
      }
    }

    // 4) Return JWT + SMT session
    res.json({
      success: true,
      operation: "login",
      data: {
        userId,
        token,
        accountCreated: created,
        smtSessionId,
        defaultEsiid: effectiveEsiid,
        esiid: effectiveEsiid,
        role,
        meterNumber: user?.meter_number || null,
        syncedPoints: syncResult?.pointsSynced || 0,
        ...(smtResult?.data || {}),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const rawStatus =
      error?.statusCode ||
      error?.status ||
      error?.response?.status ||
      error?.cause?.statusCode ||
      500;
    const message = (error?.message || "Login failed.").toString();
    const lower = message.toLowerCase();
    const looksLikeCredentialFailure =
      lower.includes("invalid") ||
      lower.includes("unauthorized") ||
      lower.includes("forbidden") ||
      lower.includes("credential") ||
      lower.includes("username") ||
      lower.includes("password") ||
      lower.includes("authenticate");
    const status =
      looksLikeCredentialFailure && rawStatus >= 500 ? 401 : rawStatus;
    res.status(status).json({
      success: false,
      error: {
        code: status === 401 ? "AUTH_INVALID_CREDENTIALS" : "AUTH_ERROR",
        message:
          status === 401
            ? "Incorrect username or password. Please try again."
            : message,
      },
    });
  }
};

/**
 * GET /api/auth/me
 * Returns current user info (requires JWT).
 */
exports.me = async (req, res) => {
  const user = req.user;
  res.json({
    success: true,
    data: {
      userId: user.id,
      smtUsername: user.smt_username,
      esiid: user.esiid,
      meterNumber: user.meter_number,
      role: user.role || "user",
      createdAt: user.created_at,
    },
  });
};
