function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function floorTo15Min(date) {
  const d = new Date(date);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15);
  return d;
}

function floorToHour(date) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d;
}

function floorToDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function floorToMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function floorDateByGranularity(date, granularity) {
  if (granularity === "15m") return floorTo15Min(date);
  if (granularity === "1h") return floorToHour(date);
  if (granularity === "1mo") return floorToMonth(date);
  return floorToDay(date);
}

function aggregateUsagePoints(points = [], granularity = "15m") {
  const map = new Map();

  for (const point of points) {
    const date = toDate(point?.timestamp);
    const usage = Number(point?.usage);
    if (!date || Number.isNaN(usage)) continue;

    const bucket = floorDateByGranularity(date, granularity).toISOString();
    const current = map.get(bucket) || 0;
    map.set(bucket, current + usage);
  }

  return Array.from(map.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([timestamp, usage]) => ({
      timestamp,
      usage: Number(usage.toFixed(5)),
    }));
}

module.exports = {
  aggregateUsagePoints,
};
