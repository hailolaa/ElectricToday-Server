const { verifyToken } = require("../services/auth.service");
const userModel = require("../models/user.model");
const { resolveUserRole } = require("../services/role.service");

/**
 * JWT authentication middleware.
 * Expects: Authorization: Bearer <token>
 * Sets req.user = { id, smt_username, esiid, meter_number, ... }
 */
function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication required. Please log in.",
      },
    });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const user = userModel.findById(payload.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: "AUTH_USER_NOT_FOUND",
          message: "User not found. Please register again.",
        },
      });
    }
    req.user = {
      ...user,
      role: resolveUserRole(user),
    };
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: {
        code: "AUTH_TOKEN_INVALID",
        message: "Invalid or expired token. Please log in again.",
      },
    });
  }
}

module.exports = { jwtAuth };
