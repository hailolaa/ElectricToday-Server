const { hasPermission } = require("../services/permission.service");

function requirePermission(permission) {
  return (req, res, next) => {
    if (hasPermission(req.user, permission)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      error: {
        code: "AUTH_FORBIDDEN",
        message: `Missing required permission: ${permission}`,
      },
    });
  };
}

module.exports = { requirePermission };
