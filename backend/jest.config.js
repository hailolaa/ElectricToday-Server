module.exports = {
  testEnvironment: "node",
  transformIgnorePatterns: [
    "/node_modules/(?!axios-cookiejar-support|http-cookie-agent)/",
  ],
};
