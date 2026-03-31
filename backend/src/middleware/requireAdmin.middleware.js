function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({
    success: false,
    error: {
      code: "AUTH_FORBIDDEN",
      message: "Admin access required.",
    },
  });
}

module.exports = { requireAdmin };
