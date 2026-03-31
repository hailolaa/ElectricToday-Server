function createSmtSuccess({ provider, operation, data, meta = {} }) {
  return {
    success: true,
    provider,
    operation,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

function createSmtError({
  provider = "unknown",
  operation = "unknown",
  message = "Request failed",
  code = "SMT_REQUEST_ERROR",
  details = null,
}) {
  return {
    success: false,
    provider,
    operation,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}

module.exports = {
  createSmtSuccess,
  createSmtError,
};
