function _parseCsv(value) {
  return (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

const ADMIN_USER_IDS = new Set(
  _parseCsv(process.env.ADMIN_USER_IDS).map((v) => Number(v)).filter((v) =>
    Number.isFinite(v)
  )
);

const ADMIN_SMT_USERNAMES = new Set(
  _parseCsv(process.env.ADMIN_SMT_USERNAMES).map((v) => v.toLowerCase())
);
const DEMO_ADMIN_USERNAME =
  process.env.DEMO_ADMIN_USERNAME ||
  (process.env.NODE_ENV === "production" ? "" : "admin");

function resolveUserRole(user) {
  if (!user) return "user";
  if (typeof user.role === "string" && user.role.trim()) {
    return user.role.trim().toLowerCase();
  }

  const userId = Number(user.id);
  if (Number.isFinite(userId) && ADMIN_USER_IDS.has(userId)) {
    return "admin";
  }

  const username = (user.smt_username || "").toString().trim().toLowerCase();
  if (
    username &&
    (ADMIN_SMT_USERNAMES.has(username) ||
      (DEMO_ADMIN_USERNAME && username === DEMO_ADMIN_USERNAME.toLowerCase()))
  ) {
    return "admin";
  }

  return "user";
}

module.exports = { resolveUserRole };
