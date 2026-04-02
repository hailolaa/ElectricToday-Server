function _parseCsv(value) {
  return (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function _normalizePermissions(rawPermissions) {
  if (Array.isArray(rawPermissions)) {
    return rawPermissions
      .map((v) => String(v || "").trim())
      .filter(Boolean);
  }
  if (typeof rawPermissions === "string") {
    return _parseCsv(rawPermissions);
  }
  return [];
}

function resolveUserPermissions(user) {
  if (!user) return [];

  const explicitPermissions = _normalizePermissions(user.permissions);
  if (explicitPermissions.length > 0) return explicitPermissions;

  const role = (user.role || "user").toString().trim().toLowerCase();
  if (role === "admin") return ["*"];

  // Default authenticated user permissions.
  return ["notifications:read", "notifications:write"];
}

function hasPermission(user, requiredPermission) {
  const permissions = resolveUserPermissions(user);
  return (
    permissions.includes("*") || permissions.includes(requiredPermission)
  );
}

module.exports = {
  resolveUserPermissions,
  hasPermission,
};
