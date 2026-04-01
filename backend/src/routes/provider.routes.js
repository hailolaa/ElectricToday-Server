const express = require("express");
const router = express.Router();
const providerController = require("../controllers/provider.controller");
const { apiKeyAuth } = require("../middleware/apiKeyAuth.middleware");

// Public endpoints for reading provider data
router.get("/", providerController.listProviders);
router.get("/cheapest", providerController.cheapest);

// Admin upsert (protect with API key)
router.post("/", apiKeyAuth, providerController.upsertProvider);

module.exports = router;

