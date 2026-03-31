const { applyTestEnv } = require("./testDb");

function getTestApp() {
  applyTestEnv();
  // Lazy require after env setup.
  // eslint-disable-next-line global-require
  return require("../../src/app");
}

module.exports = { getTestApp };
