const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production" ? "" : "dev-jwt-secret-change-in-prod");
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";

if (process.env.NODE_ENV === "production" && !JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in production.");
}

/**
 * Register a new user (or update existing) and return a JWT.
 * We verify SMT credentials first (done by caller), then store them.
 */
function registerOrUpdate({ smtUsername, smtPassword, esiid, meterNumber }) {
  const { id, created } = userModel.upsertUser({
    smtUsername,
    smtPassword,
    esiid,
    meterNumber,
  });

  const token = signToken(id);
  return { userId: id, token, created };
}

/**
 * Login an existing user by matching smt_username + esiid in DB.
 * The caller should already have verified SMT credentials.
 * We also update the stored password in case it changed.
 */
function loginExisting({ smtUsername, smtPassword, esiid }) {
  const { id } = userModel.upsertUser({
    smtUsername,
    smtPassword,
    esiid,
  });

  const token = signToken(id);
  return { userId: id, token };
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = {
  registerOrUpdate,
  loginExisting,
  signToken,
  verifyToken,
};
