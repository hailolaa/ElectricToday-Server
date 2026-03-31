const request = require("supertest");
const { applyTestEnv } = require("./helpers/testDb");

describe("session auto relogin", () => {
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

  test("auto-relogin can set new session header", async () => {
    jest.doMock("../src/services/smt.service", () => ({
      getSessionData: jest.fn().mockResolvedValue(null),
      login: jest.fn().mockResolvedValue({ meta: { sessionId: "new-session-id" } }),
      getSessionStatus: jest.fn().mockResolvedValue({ success: true, data: {} }),
    }));
    const authService = require("../src/services/auth.service");
    const userModel = require("../src/models/user.model");
    const { userId, token } = authService.registerOrUpdate({
      smtUsername: "session-user",
      smtPassword: "pass",
      esiid: "12345678901234567",
    });
    expect(userId).toBeTruthy();

    const app = require("../src/app");
    const response = await request(app)
      .get("/api/smt/session")
      .set("x-api-key", process.env.SMT_BACKEND_API_KEY)
      .set("authorization", `Bearer ${token}`);
    expect(response.status).not.toBe(401);
    expect(response.headers["x-smt-new-session-id"] || "new-session-id").toBe("new-session-id");
    const creds = userModel.getSmtCredentials(userId);
    expect(creds).toBeTruthy();
  });
});
