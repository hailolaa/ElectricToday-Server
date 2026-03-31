describe("production env guards", () => {
  const originalEnv = process.env;

  afterEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  test("database refuses default encryption key in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SMT_ENCRYPTION_KEY;
    expect(() => require("../src/db/database")).toThrow();
  });

  test("auth service refuses missing JWT secret in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => require("../src/services/auth.service")).toThrow();
  });
});
