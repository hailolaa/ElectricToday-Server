const { getDb } = require("../db/database");

/**
 * SQLite-backed ODR rate limiter.
 * Attempts are persisted, so rate limits survive backend restarts.
 */
class SqliteOdrRateLimiter {
  pruneOld() {
    const db = getDb();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare("DELETE FROM odr_attempts WHERE attempted_at < ?").run(oneDayAgo);
  }

  async getState({ esiid, maxPerHour, maxPerDay }) {
    this.pruneOld();
    const db = getDb();
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const hourRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM odr_attempts WHERE esiid = ? AND attempted_at >= ?")
      .get(esiid, oneHourAgo);
    const dayRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM odr_attempts WHERE esiid = ? AND attempted_at >= ?")
      .get(esiid, oneDayAgo);

    const inLastHour = hourRow?.cnt ?? 0;
    const inLastDay = dayRow?.cnt ?? 0;

    return {
      inLastHour,
      inLastDay,
      remainingThisHour: Math.max(0, maxPerHour - inLastHour),
      remainingToday: Math.max(0, maxPerDay - inLastDay),
    };
  }

  async registerAttempt({ esiid, maxPerHour, maxPerDay }) {
    const db = getDb();
    db.prepare("INSERT INTO odr_attempts (esiid, attempted_at) VALUES (?, ?)").run(
      esiid,
      new Date().toISOString()
    );
    return this.getState({ esiid, maxPerHour, maxPerDay });
  }
}

/**
 * Redis-backed ODR rate limiter (kept for production deployments).
 */
class RedisOdrRateLimiter {
  constructor({ redisUrl, keyPrefix }) {
    const { createClient } = require("redis");
    this.client = createClient({ url: redisUrl });
    this.keyPrefix = keyPrefix;
    this.connectionPromise = null;
  }

  async ensureConnected() {
    if (this.client.isOpen) return;
    if (!this.connectionPromise) {
      this.connectionPromise = this.client.connect();
    }
    await this.connectionPromise;
  }

  key(esiid) {
    return `${this.keyPrefix}${esiid}`;
  }

  async getCounts(esiid) {
    await this.ensureConnected();
    const nowMs = Date.now();
    const oneHourAgo = nowMs - 60 * 60 * 1000;
    const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
    const key = this.key(esiid);

    await this.client.zRemRangeByScore(key, 0, oneDayAgo);
    const [inLastHour, inLastDay] = await Promise.all([
      this.client.zCount(key, oneHourAgo, "+inf"),
      this.client.zCount(key, oneDayAgo, "+inf"),
    ]);
    await this.client.expire(key, 24 * 60 * 60);

    return {
      inLastHour: Number(inLastHour),
      inLastDay: Number(inLastDay),
      nowMs,
    };
  }

  async getState({ esiid, maxPerHour, maxPerDay }) {
    const counts = await this.getCounts(esiid);
    return {
      inLastHour: counts.inLastHour,
      inLastDay: counts.inLastDay,
      remainingThisHour: Math.max(0, maxPerHour - counts.inLastHour),
      remainingToday: Math.max(0, maxPerDay - counts.inLastDay),
    };
  }

  async registerAttempt({ esiid, maxPerHour, maxPerDay }) {
    await this.ensureConnected();
    const key = this.key(esiid);
    const nowMs = Date.now();
    const member = `${nowMs}-${Math.random().toString(16).slice(2, 10)}`;
    await this.client.zAdd(key, [{ score: nowMs, value: member }]);
    await this.client.expire(key, 24 * 60 * 60);
    return this.getState({ esiid, maxPerHour, maxPerDay });
  }
}

function createSmtOdrRateLimiter() {
  const storeType = (
    process.env.SMT_ODR_LIMIT_STORE ||
    process.env.SMT_SESSION_STORE ||
    "sqlite"
  ).toLowerCase();

  if (storeType === "redis") {
    const redisUrl = process.env.REDIS_URL;
    const keyPrefix = process.env.SMT_ODR_REDIS_KEY_PREFIX || "smt:odr:";
    if (!redisUrl) {
      throw new Error("ODR limiter store is redis but REDIS_URL is missing.");
    }
    return new RedisOdrRateLimiter({ redisUrl, keyPrefix });
  }

  // Default: SQLite-backed (persists across restarts)
  return new SqliteOdrRateLimiter();
}

module.exports = { createSmtOdrRateLimiter };
