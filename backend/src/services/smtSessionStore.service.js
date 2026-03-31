const { createClient } = require("redis");

class MemorySessionStore {
  constructor(ttlSeconds) {
    this.ttlSeconds = ttlSeconds;
    this.store = new Map();
  }

  pruneExpired() {
    const now = Date.now();
    for (const [sessionId, entry] of this.store.entries()) {
      if (entry.expiresAtMs <= now) {
        this.store.delete(sessionId);
      }
    }
  }

  async set(sessionId, value) {
    this.pruneExpired();
    this.store.set(sessionId, {
      value,
      expiresAtMs: Date.now() + this.ttlSeconds * 1000,
    });
  }

  async get(sessionId) {
    this.pruneExpired();
    const entry = this.store.get(sessionId);
    if (!entry) {
      return null;
    }

    // Sliding expiration.
    entry.expiresAtMs = Date.now() + this.ttlSeconds * 1000;
    this.store.set(sessionId, entry);

    return entry.value;
  }

  async delete(sessionId) {
    this.store.delete(sessionId);
  }
}

class RedisSessionStore {
  constructor({ redisUrl, keyPrefix, ttlSeconds }) {
    this.redisUrl = redisUrl;
    this.keyPrefix = keyPrefix;
    this.ttlSeconds = ttlSeconds;
    this.client = createClient({ url: redisUrl });
    this.connectionPromise = null;
  }

  async ensureConnected() {
    if (this.client.isOpen) {
      return;
    }

    if (!this.connectionPromise) {
      this.connectionPromise = this.client.connect();
    }

    await this.connectionPromise;
  }

  key(sessionId) {
    return `${this.keyPrefix}${sessionId}`;
  }

  async set(sessionId, value) {
    await this.ensureConnected();
    await this.client.set(this.key(sessionId), JSON.stringify(value), {
      EX: this.ttlSeconds,
    });
  }

  async get(sessionId) {
    await this.ensureConnected();
    const key = this.key(sessionId);
    const raw = await this.client.get(key);
    if (!raw) {
      return null;
    }

    // Sliding expiration.
    await this.client.expire(key, this.ttlSeconds);
    return JSON.parse(raw);
  }

  async delete(sessionId) {
    await this.ensureConnected();
    await this.client.del(this.key(sessionId));
  }
}

function createSmtSessionStore({ ttlSeconds }) {
  const storeType = (process.env.SMT_SESSION_STORE || "memory").toLowerCase();
  const redisUrl = process.env.REDIS_URL;
  const keyPrefix = process.env.SMT_REDIS_KEY_PREFIX || "smt:session:";

  if (storeType === "redis") {
    if (!redisUrl) {
      throw new Error("SMT_SESSION_STORE is redis but REDIS_URL is missing.");
    }

    return new RedisSessionStore({
      redisUrl,
      keyPrefix,
      ttlSeconds,
    });
  }

  return new MemorySessionStore(ttlSeconds);
}

module.exports = {
  createSmtSessionStore,
};
