import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addFixtureProviderCalendars } from "../actions/cli.js";
import { fixtureProviders } from "../actions/providers/fixtures.js";
import { createDashboardApp, type DashboardApp, listenDashboard } from "./server.js";

// Synthetic only: fixture providers, temporary state, loopback.
const REAL = new Date("2026-10-19T07:00:00Z");
const DEMO = new Date("2026-10-19T08:00:00Z");
let dir: string;
let port = 0;
let server: Server;
let dash: DashboardApp;

const freePort = () =>
  new Promise<number>((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() => done(typeof a === "object" && a ? a.port : 0));
    });
  });

// biome-ignore lint/suspicious/noExplicitAny: responses are inspected structurally
type Loose = any;

function http(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; text: string; json: Loose }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(payload)),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.on("data", (d) => {
          text += d;
        });
        res.on("end", () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {}
          done({ status: res.statusCode ?? 0, text, json });
        });
      },
    );
    req.on("error", fail);
    if (payload) req.write(payload);
    req.end();
  });
}

async function start(withFixtures: boolean) {
  port = await freePort();
  dash = createDashboardApp({
    stateDir: join(dir, "state"),
    agentsDir: join(dir, "agents"),
    port,
    now: () => REAL,
    schedulingNow: () => DEMO,
    ...(withFixtures
      ? { actions: { providers: fixtureProviders(), configuredConnections: [] } }
      : {}),
  });
  addFixtureProviderCalendars(dash.store, REAL.toISOString());
  server = await listenDashboard(dash, port);
  const origin = `http://127.0.0.1:${port}`;
  return { origin, cookie: await sessionCookie(origin) };
}

/** Sign in with a one-time code and return the session cookie (from Set-Cookie). */
function sessionCookie(origin: string): Promise<string> {
  return new Promise((done, fail) => {
    const payload = JSON.stringify({ code: dash.issueBootstrapCode() });
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/session",
        headers: {
          host: `127.0.0.1:${port}`,
          origin,
          "content-type": "application/json",
          "content-length": String(payload.length),
        },
      },
      (res) => {
        res.resume();
        done(String(res.headers["set-cookie"]).split(";")[0] as string);
      },
    );
    req.on("error", fail);
    req.end(payload);
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-dash-actions-"));
  mkdirSync(join(dir, "agents"));
});
afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  server?.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});

describe("dashboard actions API", () => {
  it("needs a session and CSRF; lists the catalogue with the owner's permissions", async () => {
    const { origin, cookie } = await start(true);
    const csrf = (await http("GET", "/api/session", { cookie })).json.csrf as string;
    expect((await http("GET", "/api/actions")).status).toBe(401);
    const cat = await http("GET", "/api/actions", { cookie });
    expect(cat.json.providerMode).toBe("fixture");
    expect(cat.json.schedulingClock).toEqual({ now: DEMO.toISOString(), synthetic: true });
    expect(cat.json.actions).toHaveLength(8);
    expect(cat.json.permissions.calendars.map((p: { allowed: boolean }) => p.allowed)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      cat.json.permissions.accounts.find((a: { id: string }) => a.id === "demo-google-account"),
    ).toMatchObject({ included: true, draft: false, credential: "fixture-simulation" });
    const input = {
      window: { start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z" },
      durationMinutes: 30,
    };
    const noCsrf = await http(
      "POST",
      "/api/actions/calendar.availability/prepare",
      { cookie, origin },
      { input },
    );
    expect(noCsrf.status).toBe(403);
    const r = await http(
      "POST",
      "/api/actions/calendar.availability/prepare",
      { cookie, origin, "x-csrf-token": csrf },
      { input },
    );
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      status: "ok",
      origin: "dashboard",
      deterministic: true,
      computedAt: REAL.toISOString(),
    });
    expect(r.json.result.sources.map((s: { state: string }) => s.state)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(r.json.result.proposals[0].start).toBe("2026-10-20T09:00:00.000Z");
    expect(r.text).not.toMatch(/fixture-access-token|Private stand-up/);
  });

  it("without provider configuration, provider calendars need setup (never free); no execute route exists", async () => {
    const { origin, cookie } = await start(false);
    const csrf = (await http("GET", "/api/session", { cookie })).json.csrf as string;
    const headers = { cookie, origin, "x-csrf-token": csrf };
    const r = await http("POST", "/api/actions/calendar.availability/prepare", headers, {
      input: {
        window: { start: "2026-10-20T00:00:00Z", end: "2026-10-21T00:00:00Z" },
        durationMinutes: 30,
      },
    });
    expect(r.json.status).toBe("needs-setup");
    expect(r.json.result.proposals).toEqual([]);
    expect(
      (await http("POST", "/api/actions/agent.propose-meeting/execute", headers, { token: "x" }))
        .status,
    ).toBe(404);
    expect(
      (await http("POST", "/api/actions/unknown.action/prepare", headers, { input: {} })).json
        .status,
    ).toBe("refused");
    expect(
      (
        await http("POST", "/api/actions/calendar.availability/prepare", headers, {
          input: {},
          path: "/etc",
        })
      ).status,
    ).toBe(400);
  });
});
