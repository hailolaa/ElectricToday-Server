const request = require("supertest");
const { applyTestEnv } = require("./helpers/testDb");

describe("security middleware", () => {
  beforeEach(() => {
    jest.resetModules();
    applyTestEnv();
    jest.doMock("../src/providers/smt", () => ({
      getProviderName: jest.fn().mockReturnValue("test"),
      getSmtProvider: jest.fn().mockReturnValue({
        login: jest.fn(),
        getUsage: jest.fn(),
      }),
    }));
  });

  test("missing API key returns 401", async () => {
    const app = require("../src/app");
    const response = await request(app).get("/api/auth/me");
    expect(response.status).toBe(401);
  });

  test("wrong API key returns 401", async () => {
    const app = require("../src/app");
    const response = await request(app).get("/api/auth/me").set("x-api-key", "bad-key");
    expect(response.status).toBe(401);
  });

  test("rate limiting eventually returns 429", async () => {
    process.env.API_RATE_LIMIT_MAX = "3";
    process.env.API_RATE_LIMIT_WINDOW_MS = "10000";
    const app = require("../src/app");
    let lastStatus = 200;
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-api-key", process.env.SMT_BACKEND_API_KEY);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
