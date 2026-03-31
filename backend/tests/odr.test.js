const request = require("supertest");
const { applyTestEnv } = require("./helpers/testDb");

describe("odr endpoints", () => {
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

  test("POST /api/smt/meter-read/request succeeds", async () => {
    jest.doMock("../src/services/smt.service", () => ({
      requestOnDemandRead: jest.fn().mockResolvedValue({
        success: true,
        data: { result: { message: "queued" } },
      }),
      getSessionData: jest.fn().mockResolvedValue({}),
    }));
    const app = require("../src/app");
    const response = await request(app)
      .post("/api/smt/meter-read/request")
      .set("x-api-key", process.env.SMT_BACKEND_API_KEY)
      .set("x-smt-session-id", "session-1")
      .send({ ESIID: "12345678901234567", MeterNumber: "100200300" });
    expect(response.status).toBe(200);
  });

  test("GET /api/user/odr-rate-limit requires auth", async () => {
    const app = require("../src/app");
    const response = await request(app)
      .get("/api/user/odr-rate-limit")
      .set("x-api-key", process.env.SMT_BACKEND_API_KEY);
    expect(response.status).toBe(401);
  });
});
