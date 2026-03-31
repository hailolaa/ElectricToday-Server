const request = require("supertest");
const { applyTestEnv } = require("./helpers/testDb");

describe("auth endpoints", () => {
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

  test("POST /api/auth/login returns JWT + session", async () => {
    jest.doMock("../src/services/smt.service", () => ({
      login: jest.fn().mockResolvedValue({
        success: true,
        meta: { sessionId: "session-1" },
        data: {},
      }),
      getSessionData: jest.fn().mockResolvedValue({ accessToken: "token" }),
    }));
    jest.doMock("../src/services/sync.service", () => ({
      fetchAndStoreDailyUsage: jest.fn().mockResolvedValue({ pointsSynced: 0 }),
    }));
    const app = require("../src/app");
    const response = await request(app)
      .post("/api/auth/login")
      .set("x-api-key", process.env.SMT_BACKEND_API_KEY)
      .send({ username: "user", password: "pass", ESIID: "12345678901234567" });
    expect(response.status).toBe(200);
    expect(response.body.data.token).toBeTruthy();
    expect(response.body.data.smtSessionId).toBe("session-1");
  });

  test("POST /api/auth/login rejects bad password", async () => {
    jest.doMock("../src/services/smt.service", () => ({
      login: jest.fn().mockRejectedValue(Object.assign(new Error("bad creds"), { statusCode: 401 })),
    }));
    const app = require("../src/app");
    const response = await request(app)
      .post("/api/auth/login")
      .set("x-api-key", process.env.SMT_BACKEND_API_KEY)
      .send({ username: "user", password: "wrong", ESIID: "12345678901234567" });
    expect(response.status).toBe(401);
  });

  test("GET /api/auth/me requires valid JWT", async () => {
    const app = require("../src/app");
    const response = await request(app)
      .get("/api/auth/me")
      .set("x-api-key", process.env.SMT_BACKEND_API_KEY);
    expect(response.status).toBe(401);
  });
});
