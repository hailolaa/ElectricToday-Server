const officialProvider = require("./official.provider");
const unofficialProvider = require("./unofficial.provider");

function getProviderName() {
  return (process.env.SMT_PROVIDER || "unofficial").toLowerCase();
}

function getSmtProvider() {
  const name = getProviderName();

  if (name === "official") {
    return officialProvider;
  }

  if (name === "unofficial") {
    return unofficialProvider;
  }

  throw new Error(
    `Unsupported SMT_PROVIDER "${name}". Use "official" or "unofficial".`
  );
}

module.exports = {
  getProviderName,
  getSmtProvider,
};
