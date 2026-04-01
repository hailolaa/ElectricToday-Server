const providerModel = require("../models/provider.model");

function listProviders(req, res) {
  const rows = providerModel.getAll();
  res.json({ success: true, data: rows });
}

function cheapest(req, res) {
  const usage = Number(req.query.usage || 1000);
  const result = providerModel.getCheapestByUsage(usage);
  res.json({ success: true, data: result });
}

function upsertProvider(req, res) {
  const body = req.body || {};
  if (!body.name || body.energy_rate_cents == null) {
    return res.status(400).json({ success: false, message: "name and energy_rate_cents are required" });
  }
  const id = providerModel.upsert(body);
  res.json({ success: true, id });
}

module.exports = { listProviders, cheapest, upsertProvider };

