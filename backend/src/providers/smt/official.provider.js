const axios = require("axios");

const OFFICIAL_BASE_URL =
  process.env.SMT_OFFICIAL_BASE_URL || "https://uatservices.smartmetertexas.net";

function buildOfficialUsagePayload(overrides = {}) {
  return {
    trans_id: overrides.trans_id || String(Date.now()),
    requesterType: overrides.requesterType || process.env.SMT_REQUESTER_TYPE || "TDSP",
    requesterAuthenticationID:
      overrides.requesterAuthenticationID ||
      process.env.SMT_REQUESTER_AUTH_ID ||
      "",
    requestorID: overrides.requestorID || process.env.SMT_SERVICE_USERNAME || "",
    deliveryMode: overrides.deliveryMode || process.env.SMT_DELIVERY_MODE || "API",
    ESIID: overrides.ESIID || process.env.SMT_ESIID || "",
    SMTTermsandConditions:
      overrides.SMTTermsandConditions || process.env.SMT_TERMS_ACCEPTED || "Y",
  };
}

exports.login = async (credentials = {}) => {
  const username = credentials.username || process.env.SMT_SERVICE_USERNAME;
  const password = credentials.password || process.env.SMT_SERVICE_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Official provider requires service credentials. Set SMT_SERVICE_USERNAME and SMT_SERVICE_PASSWORD."
    );
  }

  const response = await axios.post(
    `${OFFICIAL_BASE_URL}/v2/token/`,
    {
      username,
      password,
    },
    {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    }
  );

  return {
    provider: "official",
    statusCode: response.data?.statusCode,
    accessToken: response.data?.accessToken,
    expiresIn: response.data?.expiresIn,
    issuedAt: response.data?.issuedAt,
    expiresAt: response.data?.expiresAt,
  };
};

exports.getUsage = async (options = {}) => {
  const token = options.accessToken;
  if (!token) {
    throw new Error(
      "Official provider getUsage requires accessToken. Call login first and pass the token."
    );
  }

  const payload = buildOfficialUsagePayload(options.payload);
  if (!payload.requestorID || !payload.ESIID) {
    throw new Error(
      "Official provider requires requestorID and ESIID. Set SMT_SERVICE_USERNAME and SMT_ESIID or provide payload."
    );
  }

  const response = await axios.post(`${OFFICIAL_BASE_URL}/v2/odr/`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  return {
    provider: "official",
    request: payload,
    result: response.data,
  };
};

exports.requestOnDemandRead = async (options = {}) => {
  // Official ODR request flow already maps to usage request submission.
  return exports.getUsage(options);
};

exports.getMeterReadStatus = async (options = {}) => {
  // Official flow can query status via ODR usage call contract.
  return exports.getUsage(options);
};

exports.getUsageHistory = async () => {
  const error = new Error(
    "Official provider getUsageHistory is not implemented yet for this backend."
  );
  error.statusCode = 501;
  throw error;
};
