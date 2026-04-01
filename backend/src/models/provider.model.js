const { getDb } = require("../db/database");

function getAll() {
  return getDb().prepare(`SELECT * FROM providers ORDER BY energy_rate_cents ASC`).all();
}

function findByName(name) {
  return getDb().prepare(`SELECT * FROM providers WHERE name = ?`).get(name);
}

function upsert(p) {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM providers WHERE name = ?`).get(p.name);
  if (existing) {
    db.prepare(
      `UPDATE providers
         SET energy_rate_cents = ?,
             avg_all_in_cents = ?,
             plan_type = ?,
             term_months = ?,
             cancellation_fee = ?,
             updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      Number(p.energy_rate_cents),
      p.avg_all_in_cents != null ? Number(p.avg_all_in_cents) : null,
      p.plan_type || null,
      p.term_months != null ? Number(p.term_months) : null,
      p.cancellation_fee || null,
      existing.id
    );
    return existing.id;
  }
  const info = db.prepare(
    `INSERT INTO providers
      (name, energy_rate_cents, avg_all_in_cents, plan_type, term_months, cancellation_fee)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    p.name,
    Number(p.energy_rate_cents),
    p.avg_all_in_cents != null ? Number(p.avg_all_in_cents) : null,
    p.plan_type || null,
    p.term_months != null ? Number(p.term_months) : null,
    p.cancellation_fee || null
  );
  return info.lastInsertRowid;
}

function getCheapestByUsage(usageKwh = 1000) {
  // For 1000 kWh, prefer avg_all_in_cents if present; otherwise fallback to energy_rate_cents.
  const rows = getAll();
  if (!rows.length) return null;
  let cheapest = null;
  let cheapestCost = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const cents = r.avg_all_in_cents != null ? r.avg_all_in_cents : r.energy_rate_cents;
    const totalCost = (cents / 100.0) * usageKwh;
    if (totalCost < cheapestCost) {
      cheapestCost = totalCost;
      cheapest = r;
    }
  }
  return { provider: cheapest, monthlyCost: cheapestCost };
}

module.exports = {
  getAll,
  findByName,
  upsert,
  getCheapestByUsage,
};

