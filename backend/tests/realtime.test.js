const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const { applyTestEnv } = require("./helpers/testDb");

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws_open_timeout")), 2000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("ws_message_timeout"));
    }, timeoutMs);

    function onMessage(raw) {
      try {
        const parsed = JSON.parse(String(raw));
        if (!predicate(parsed)) return;
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(parsed);
      } catch (_) {
        // ignore non-json payloads
      }
    }

    ws.on("message", onMessage);
  });
}

describe("realtime websocket energy updates", () => {
  let server;
  let port;
  let wsGateway;

  beforeEach((done) => {
    jest.resetModules();
    applyTestEnv();
    const app = express();
    app.get("/", (req, res) => res.json({ ok: true }));
    wsGateway = require("../src/realtime/wsGateway");
    server = http.createServer(app);
    wsGateway.initWsGateway(server, { allowedOrigins: [] });
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      done();
    });
  });

  afterEach((done) => {
    if (wsGateway?.closeWsGateway) {
      wsGateway.closeWsGateway();
    }
    if (server) {
      server.close(() => done());
      return;
    }
    done();
  });

  test("requires JWT token for websocket handshake", async () => {
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/energy`);
      ws.on("unexpected-response", (req, res) => {
        expect(res.statusCode).toBe(401);
        resolve();
      });
      ws.on("error", () => {
        // depending on ws internals, unexpected-response might not always fire first
      });
    });
  });

  test("pushes snapshots only to the matching user channel", async () => {
    const authService = require("../src/services/auth.service");
    const { userId: user1Id, token: user1Token } = authService.registerOrUpdate({
      smtUsername: "ws-u1",
      smtPassword: "pass",
      esiid: "12345678901234567",
      meterNumber: "11111",
    });
    const { userId: user2Id, token: user2Token } = authService.registerOrUpdate({
      smtUsername: "ws-u2",
      smtPassword: "pass",
      esiid: "12345678901234568",
      meterNumber: "22222",
    });
    expect(user1Id).not.toBe(user2Id);

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/energy?token=${user1Token}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/energy?token=${user2Token}`);
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    await wsGateway.pushLatestEnergySnapshot(user1Id, "manual_test");

    const user1Push = await waitForMessage(
      ws1,
      (m) => m.type === "energy_snapshot" && m.reason === "manual_test"
    );
    expect(user1Push.data).toBeTruthy();

    await expect(
      waitForMessage(ws2, (m) => m.type === "energy_snapshot" && m.reason === "manual_test", 500)
    ).rejects.toThrow("ws_message_timeout");

    ws1.close();
    ws2.close();
  });

  test("pushes typed non-snapshot events to the matching user channel", async () => {
    const authService = require("../src/services/auth.service");
    const { userId, token } = authService.registerOrUpdate({
      smtUsername: "ws-events-u1",
      smtPassword: "pass",
      esiid: "12345678901234610",
    });
    const { token: otherToken } = authService.registerOrUpdate({
      smtUsername: "ws-events-u2",
      smtPassword: "pass",
      esiid: "12345678901234611",
    });

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/energy?token=${token}`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/energy?token=${otherToken}`);
    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    wsGateway.pushUserEvent(userId, "history_changed", { reason: "manual_test" });

    const user1Push = await waitForMessage(
      ws1,
      (m) => m.type === "history_changed" && m.reason === "manual_test"
    );
    expect(user1Push.sequence).toBeGreaterThan(0);

    await expect(
      waitForMessage(ws2, (m) => m.type === "history_changed" && m.reason === "manual_test", 500)
    ).rejects.toThrow("ws_message_timeout");

    ws1.close();
    ws2.close();
  });

  test("cleans up disconnected sockets", async () => {
    const authService = require("../src/services/auth.service");
    const { userId, token } = authService.registerOrUpdate({
      smtUsername: "ws-cleanup",
      smtPassword: "pass",
      esiid: "12345678901234569",
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/energy?token=${token}`);
    await waitForOpen(ws);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(wsGateway.getConnectedSocketCount(userId)).toBe(1);

    ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(wsGateway.getConnectedSocketCount(userId)).toBe(0);
  });
});
