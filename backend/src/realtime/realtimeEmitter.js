const { pushLatestEnergySnapshot, pushUserEvent } = require("./wsGateway");

const USER_TIMERS = new Map();
const DEFAULT_DEBOUNCE_MS = Number(process.env.WS_ENERGY_DEBOUNCE_MS || 1500);

function _timerKey(userId, kind) {
  return `${userId}:${kind}`;
}

function scheduleEnergyPush(userId, reason = "update") {
  if (!userId) return;
  const key = _timerKey(userId, "energy_snapshot");

  const existing = USER_TIMERS.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(async () => {
    USER_TIMERS.delete(key);
    try {
      await pushLatestEnergySnapshot(userId, reason);
    } catch (_) {
      // Best effort push.
    }
  }, DEFAULT_DEBOUNCE_MS);

  USER_TIMERS.set(key, timer);
}

function scheduleEventPush(userId, eventType, reason = "update", data = {}) {
  if (!userId || !eventType) return;
  const key = _timerKey(userId, eventType);
  const existing = USER_TIMERS.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    USER_TIMERS.delete(key);
    try {
      pushUserEvent(userId, eventType, { reason, data });
    } catch (_) {
      // Best effort push.
    }
  }, DEFAULT_DEBOUNCE_MS);

  USER_TIMERS.set(key, timer);
}

function scheduleDataChangePush(userId, reason = "data_changed") {
  scheduleEnergyPush(userId, reason);
  scheduleEventPush(userId, "history_changed", reason);
  scheduleEventPush(userId, "alerts_changed", reason);
}

function clearScheduledPushes() {
  for (const timer of USER_TIMERS.values()) {
    clearTimeout(timer);
  }
  USER_TIMERS.clear();
}

module.exports = {
  scheduleEnergyPush,
  scheduleEventPush,
  scheduleDataChangePush,
  clearScheduledPushes,
};
