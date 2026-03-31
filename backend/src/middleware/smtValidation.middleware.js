const { getProviderName } = require("../providers/smt");
const { createSmtError } = require("../utils/smtResponse");

function sendValidationError(res, operation, message, details = null) {
  return res.status(400).json(
    createSmtError({
      provider: getProviderName(),
      operation,
      message,
      code: "SMT_VALIDATION_ERROR",
      details,
    })
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

exports.validateLoginBody = (req, res, next) => {
  const body = req.body || {};
  const loginId = body.username || body.userId || body.userid;
  const password = body.password;

  if (!isNonEmptyString(loginId) || !isNonEmptyString(password)) {
    return sendValidationError(
      res,
      "login",
      "Invalid request body. login id (username/userId) and password are required non-empty strings.",
      {
        requiredFields: ["username or userId", "password"],
      }
    );
  }

  return next();
};

exports.validateUsagePayloadBody = (req, res, next) => {
  const body = req.body;

  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return sendValidationError(
      res,
      "usage",
      "Invalid request body. usage payload must be a JSON object.",
      {
        expectedType: "object",
      }
    );
  }

  const optionalStringFields = [
    "trans_id",
    "requesterType",
    "requesterAuthenticationID",
    "requestorID",
    "deliveryMode",
    "ESIID",
    "SMTTermsandConditions",
  ];

  for (const field of optionalStringFields) {
    if (body[field] !== undefined && typeof body[field] !== "string") {
      return sendValidationError(
        res,
        "usage",
        `Invalid field type for "${field}". Expected string.`,
        {
          field,
          expectedType: "string",
        }
      );
    }
  }

  return next();
};

exports.validateOnDemandBody = (req, res, next) => {
  const body = req.body;
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return sendValidationError(
      res,
      "meter_read_request",
      "Invalid request body. meter-read payload must be a JSON object.",
      {
        expectedType: "object",
      }
    );
  }

  if (body.ESIID !== undefined && !isNonEmptyString(body.ESIID)) {
    return sendValidationError(
      res,
      "meter_read_request",
      'Invalid "ESIID". When provided, it must be a non-empty string.',
      {
        field: "ESIID",
      }
    );
  }

  if (body.MeterNumber !== undefined && !isNonEmptyString(body.MeterNumber)) {
    return sendValidationError(
      res,
      "meter_read_request",
      'Invalid "MeterNumber". When provided, it must be a non-empty string.',
      {
        field: "MeterNumber",
      }
    );
  }

  if (body.meterNumber !== undefined && !isNonEmptyString(body.meterNumber)) {
    return sendValidationError(
      res,
      "meter_read_request",
      'Invalid "meterNumber". When provided, it must be a non-empty string.',
      {
        field: "meterNumber",
      }
    );
  }

  return next();
};

exports.validateMeterReadStatusBody = (req, res, next) => {
  const body = req.body;
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return sendValidationError(
      res,
      "meter_read_status",
      "Invalid request body. meter-read status payload must be a JSON object.",
      {
        expectedType: "object",
      }
    );
  }

  if (body.ESIID !== undefined && !isNonEmptyString(body.ESIID)) {
    return sendValidationError(
      res,
      "meter_read_status",
      'Invalid "ESIID". When provided, it must be a non-empty string.',
      {
        field: "ESIID",
      }
    );
  }

  if (body.trans_id !== undefined && !isNonEmptyString(body.trans_id)) {
    return sendValidationError(
      res,
      "meter_read_status",
      'Invalid "trans_id". When provided, it must be a non-empty string.',
      {
        field: "trans_id",
      }
    );
  }

  if (body.transId !== undefined && !isNonEmptyString(body.transId)) {
    return sendValidationError(
      res,
      "meter_read_status",
      'Invalid "transId". When provided, it must be a non-empty string.',
      {
        field: "transId",
      }
    );
  }

  if (body.correlationId !== undefined && !isNonEmptyString(body.correlationId)) {
    return sendValidationError(
      res,
      "meter_read_status",
      'Invalid "correlationId". When provided, it must be a non-empty string.',
      {
        field: "correlationId",
      }
    );
  }

  return next();
};

exports.validateUsageHistoryBody = (req, res, next) => {
  const body = req.body;
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return sendValidationError(
      res,
      "usage_history",
      "Invalid request body. usage-history payload must be a JSON object.",
      {
        expectedType: "object",
      }
    );
  }

  const allowedGranularity = new Set([
    "15m",
    "1h",
    "1d",
    "1mo",
    "hourly",
    "daily",
    "monthly",
  ]);
  if (
    body.granularity !== undefined &&
    (typeof body.granularity !== "string" ||
      !allowedGranularity.has(body.granularity.toLowerCase()))
  ) {
    return sendValidationError(
      res,
      "usage_history",
      'Invalid "granularity". Allowed values: 15m, 1h, 1d, 1mo, hourly, daily, monthly.',
      {
        field: "granularity",
        allowed: ["15m", "1h", "1d", "1mo", "hourly", "daily", "monthly"],
      }
    );
  }

  const granularity = typeof body.granularity === "string" ? body.granularity.toLowerCase() : null;
  if ((granularity === "1d" || granularity === "daily" || granularity === "1mo" || granularity === "monthly") &&
      (!isNonEmptyString(body.startDate) || !isNonEmptyString(body.endDate))) {
    return sendValidationError(
      res,
      "usage_history",
      'startDate and endDate are required for daily/monthly history requests.',
      {
        requiredFields: ["startDate", "endDate"],
      }
    );
  }

  if (body.ESIID !== undefined && !isNonEmptyString(body.ESIID)) {
    return sendValidationError(
      res,
      "usage_history",
      'Invalid "ESIID". When provided, it must be a non-empty string.',
      {
        field: "ESIID",
      }
    );
  }

  return next();
};
