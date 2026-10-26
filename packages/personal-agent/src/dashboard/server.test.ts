import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, Settings } from "./model.js";
import { DENY_ALL } from "./model.js";
import { createDashboardApp, type DashboardApp, listenDashboard } from "./server.js";

// Synthetic fixtures only: invented accounts on example.* domains.
const KEY = "ts-test-KEY-do-not-leak-0123456789";
const NOW = new Date("2026-10-19T08:00:00Z");

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      const port = typeof address === "object" && address ? address.port : 0;
      s.close(() => done(port));
    });
  });
}

interface Res {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected structurally
  json: any;
}

let port = 0;
function http(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown; raw?: string } = {},
): Promise<Res> {
  const payload = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload !== undefined
            ? {
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(payload)),
              }
            : {}),
          ...opts.headers,
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
          done({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", fail);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

const origin = () => `http://127.0.0.1:${port}`;

function connection(id: string, extra: Partial<Connection> = {}): Connection {
  return {
    id,
    label: `Synthetic ${id}`,
    channel: "email",
    provider: "gmail",
    organisation: "Example Org",
    identifiers: [`${id}@example.org`],
    origin: "demo",
    evidence: [],
    conflicts: [],
    localConnector: { state: "setup-required" },
    restrictions: { ...DENY_ALL },
    notes: "",
    updatedAt: NOW.toISOString(),
    updatedBy: "demo setup",
    ...extra,
  };
}

const POLICY: NonNullable<Settings["workflowPolicy"]> = {
  source: "synthetic",
  lastUpdated: "2026-09-01",
  askWhenUncertain: ["classification"],
  defaultAllowed: ["classify", "draft", "read_via_approved_workflow"],
  requiresCurrentInstruction: [],
  requiresFreshExplicitInstruction: ["send_after_exact_draft_review"],
  taxonomy: {},
};

const GOOD_ANSWER = {
  model: "jev-1.13.0",
  answers: {
    primary: {
      type: "choice",
      choice: "needs_reply",
      probabilities: {
        needs_reply: 0.93,
        action: 0.02,
        waiting: 0.01,
        read_later: 0.01,
        fyi: 0.01,
        noise: 0.01,
        uncertain: 0.01,
      },
      confidence: 0.91,
    },
    urgency: {
      type: "choice",
      choice: "not_urgent",
      probabilities: { urgent: 0.05, not_urgent: 0.95 },
      confidence: 0.92,
    },
    needs_reply: { type: "noul", noul: 0.95 },
  },
};

let dir: string;
let server: Server;
let dash: DashboardApp;
let fetchMock: ReturnType<typeof vi.fn>;
let logs: string[];

async function start(
  env: NodeJS.ProcessEnv = {},
  clocks: { now?: () => Date; schedulingNow?: () => Date } = {},
) {
  port = await freePort();
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(GOOD_ANSWER), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  logs = [];
  dash = createDashboardApp({
    stateDir: join(dir, "state"),
    agentsDir: join(dir, "agents"),
    port,
    now: clocks.now ?? (() => NOW),
    ...(clocks.schedulingNow ? { schedulingNow: clocks.schedulingNow } : {}),
    env,
    fetchImpl: fetchMock as unknown as typeof fetch,
    log: (l) => logs.push(l),
  });
  server = await listenDashboard(dash, port);
}

async function signIn(): Promise<{ cookie: string; csrf: string }> {
  const code = dash.issueBootstrapCode();
  const r = await http("POST", "/api/session", { headers: { origin: origin() }, body: { code } });
  expect(r.status).toBe(200);
  return {
    cookie: String(r.headers["set-cookie"]).split(";")[0] as string,
    csrf: r.json.csrf as string,
  };
}

function seed(change: (d: Settings) => void) {
  const s = dash.store.read();
  dash.store.update(s.revision, "demo setup", "seed", "test fixture", change);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-dash-test-"));
  mkdirSync(join(dir, "agents"));
});
afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  server?.closeAllConnections();
  rmSync(dir, { recursive: true, force: true });
});

describe("dashboard server: loopback trust boundary", () => {
  beforeEach(() => start());

  it("refuses a foreign Host (DNS rebinding) for pages and API", async () => {
    for (const host of [`evil.example:${port}`, `127.0.0.1:${port + 1}`, "localhost"]) {
      expect((await http("GET", "/", { headers: { host } })).status).toBe(421);
      expect((await http("GET", "/api/overview", { headers: { host } })).status).toBe(421);
    }
    expect((await http("GET", "/", { headers: { host: `localhost:${port}` } })).status).toBe(200);
  });

  it("serves the page with a strict CSP and security headers and never sends CORS headers", async () => {
    const r = await http("GET", "/");
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-(inline|eval)/);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    const pre = await http("OPTIONS", "/api/overview", {
      headers: { origin: origin(), "access-control-request-method": "PUT" },
    });
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("requires a session for every private API call", async () => {
    for (const path of [
      "/api/overview",
      "/api/connections",
      "/api/calendars",
      "/api/permissions",
      "/api/triage",
      "/api/history",
      "/api/session",
    ]) {
      const r = await http("GET", path);
      expect(r.status, path).toBe(401);
      expect(r.text).not.toMatch(/example\.org/);
    }
  });

  it("exchanges a one-time code for an HttpOnly SameSite=Strict session once", async () => {
    const code = dash.issueBootstrapCode();
    const cross = await http("POST", "/api/session", {
      headers: { origin: "http://evil.example" },
      body: { code },
    });
    const none = await http("POST", "/api/session", { body: { code } });
    const site = await http("POST", "/api/session", {
      headers: { origin: origin(), "sec-fetch-site": "cross-site" },
      body: { code },
    });
    expect([cross.status, none.status, site.status]).toEqual([403, 403, 403]);
    const ok = await http("POST", "/api/session", {
      headers: { origin: origin() },
      body: { code },
    });
    expect(ok.status).toBe(200);
    const cookie = String(ok.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Domain=/);
    const again = await http("POST", "/api/session", {
      headers: { origin: origin() },
      body: { code },
    });
    expect(again.status).toBe(401);
  });

  it("stops accepting codes after repeated wrong guesses", async () => {
    const code = dash.issueBootstrapCode();
    for (let i = 0; i < 10; i++)
      await http("POST", "/api/session", {
        headers: { origin: origin() },
        body: { code: `wrong-code-${i}-xxxxxxxxxxxxxxxx` },
      });
    const r = await http("POST", "/api/session", { headers: { origin: origin() }, body: { code } });
    expect(r.status).toBe(401);
  });

  it("requires the CSRF token, an Origin and a JSON body for writes", async () => {
    const { cookie, csrf } = await signIn();
    const body = { baseRevision: 0, hostedEnabled: true };
    expect(
      (await http("PUT", "/api/triage", { headers: { cookie, origin: origin() }, body })).status,
    ).toBe(403);
    expect(
      (
        await http("PUT", "/api/triage", {
          headers: { cookie, origin: origin(), "x-csrf-token": "forged" },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (await http("PUT", "/api/triage", { headers: { cookie, "x-csrf-token": csrf }, body }))
        .status,
    ).toBe(403);
    expect(
      (
        await http("PUT", "/api/triage", {
          headers: { cookie, origin: origin(), "x-csrf-token": csrf, "content-type": "text/plain" },
          raw: JSON.stringify(body),
        })
      ).status,
    ).toBe(415);
    const ok = await http("PUT", "/api/triage", {
      headers: { cookie, origin: origin(), "x-csrf-token": csrf },
      body,
    });
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
  });

  it("caps bodies, refuses unknown fields and malformed JSON with sanitised errors", async () => {
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const big = await http("PUT", "/api/triage", {
      headers,
      raw: `{"x":"${"a".repeat(300_000)}"}`,
    });
    expect(big.status).toBe(413);
    const extra = await http("PUT", "/api/triage", {
      headers,
      body: { baseRevision: 0, hostedEnabled: true, endpoint: "https://evil.example/v1" },
    });
    expect(extra.status).toBe(400);
    const bad = await http("PUT", "/api/triage", { headers, raw: "{not json" });
    expect(bad.status).toBe(400);
    for (const r of [big, extra, bad])
      expect(r.text).not.toMatch(/\/Users\/|node_modules|at .*\.js/);
  });

  it("serves only the allowlisted static files", async () => {
    const { cookie } = await signIn();
    for (const path of ["/assets/app.js", "/assets/app.css", "/assets/icon.svg", "/"])
      expect((await http("GET", path)).status, path).toBe(200);
    for (const path of [
      "/package.json",
      "/settings.json",
      "/state/settings.json",
      "/assets/../package.json",
      "/assets/%2e%2e/%2e%2e/package.json",
      "/assets/app.js.map",
      "/index.html",
      "/agents/",
      "/src/dashboard/server.ts",
    ])
      expect((await http("GET", path, { headers: { cookie } })).status, path).toBe(404);
  });
});

describe("dashboard server: settings", () => {
  beforeEach(() => start());

  it("round-trips a record, keeps hostile labels as data and refuses stale revisions", async () => {
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const evil = `<img src=x onerror="alert(1)"></title><script>alert(2)</script>`;
    const add = await http("POST", "/api/connections", {
      headers,
      body: {
        baseRevision: 0,
        record: {
          label: evil,
          channel: "slack",
          provider: "slack",
          organisation: evil,
          identifiers: [evil],
          notes: evil,
        },
      },
    });
    expect(add.status).toBe(201);
    const list = await http("GET", "/api/connections", { headers: { cookie } });
    expect(list.headers["content-type"]).toMatch(/^application\/json/);
    const c = list.json.connections.find((x: Connection) => x.id === add.json.id);
    expect(c.label).toBe(evil);
    expect(c.restrictions).toEqual(DENY_ALL);
    expect(c.status.state).toBe("setup-required");
    // Survives a restart: a new app on the same state directory sees it.
    const again = createDashboardApp({
      stateDir: join(dir, "state"),
      agentsDir: join(dir, "agents"),
      port,
      now: () => NOW,
    });
    expect(again.store.read().connections.some((x) => x.label === evil)).toBe(true);
    // Stale revision: 409 with the current revision, nothing merged.
    const stale = await http("PUT", `/api/connections/${add.json.id}`, {
      headers,
      body: { baseRevision: 0, changes: { notes: "lost update" } },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.revision).toBe(1);
    expect(dash.store.read().connections[0]?.notes).toBe(evil);
  });

  it("keeps imported records read-only except for the owner's own settings", async () => {
    seed((d) => {
      d.connections.push(
        connection("imported-1", { origin: "inventory", localConnector: { state: "none" } }),
      );
    });
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const rename = await http("PUT", "/api/connections/imported-1", {
      headers,
      body: { baseRevision: 1, changes: { label: "renamed" } },
    });
    expect(rename.status).toBe(400);
    const del = await http("DELETE", "/api/connections/imported-1", {
      headers,
      body: { baseRevision: 1 },
    });
    expect(del.status).toBe(400);
    const restrict = await http("PUT", "/api/connections/imported-1", {
      headers,
      body: {
        baseRevision: 1,
        changes: { restrictions: { ...DENY_ALL, agentEnabled: true, read: true } },
      },
    });
    expect(restrict.status).toBe(200);
    expect(dash.store.read().connections[0]?.restrictions.read).toBe(true);
    const history = await http("GET", "/api/history", { headers: { cookie } });
    expect(history.json.history[0]).toMatchObject({ actor: "owner (dashboard)", revision: 2 });
  });

  it("never reports a provider-backed connection from inventory or Codex evidence", async () => {
    seed((d) => {
      d.connections.push(
        connection("codex-seen", {
          origin: "inventory",
          localConnector: { state: "none" },
          evidence: [{ kind: "codex-connector", observedOn: "2026-09-20", summary: "historic" }],
        }),
      );
    });
    const { cookie } = await signIn();
    const list = await http("GET", "/api/connections", { headers: { cookie } });
    expect(list.json.connections[0].status.state).toBe("previously-codex");
    const perms = await http("GET", "/api/permissions", { headers: { cookie } });
    const caps = perms.json.matrix[0].capabilities;
    expect(caps.every((c: { allowed: boolean }) => !c.allowed)).toBe(true);
    expect(caps.find((c: { capability: string }) => c.capability === "send").allowed).toBe(false);
  });
});

describe("dashboard server: triage", () => {
  const sample = { subject: "Lunch?", body: "Could you let me know if Thursday works?" };

  it("never calls the provider when no key is configured", async () => {
    await start({});
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    await http("PUT", "/api/triage", { headers, body: { baseRevision: 0, hostedEnabled: true } });
    const r = await http("POST", "/api/triage/classify", {
      headers,
      body: { sample, synthetic: true, useHosted: true, consent: true },
    });
    expect(r.status).toBe(200);
    expect(r.json.source).toBe("deterministic-baseline");
    expect(r.json.hosted.status).toBe("not-allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with a key: no call while disabled or without consent; one call with both; key never exposed", async () => {
    await start({ TYPESAFE_API_KEY: KEY });
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const classify = (consent: boolean) =>
      http("POST", "/api/triage/classify", {
        headers,
        body: { sample, synthetic: true, useHosted: true, consent },
      });
    const off = await classify(true);
    expect(off.json.hosted.status).toBe("not-allowed");
    await http("PUT", "/api/triage", { headers, body: { baseRevision: 0, hostedEnabled: true } });
    const noConsent = await classify(false);
    expect(noConsent.json.hosted.status).toBe("not-allowed");
    expect(fetchMock).not.toHaveBeenCalled();
    const ok = await classify(true);
    expect(ok.json.source).toBe("typesafe");
    expect(ok.json.primary).toBe("needs_reply");
    expect(ok.json.mayAct).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.redirect).toBe("error");
    // The key appears in no response, settings file or log.
    const everything = [
      off.text,
      noConsent.text,
      ok.text,
      (await http("GET", "/api/triage", { headers: { cookie } })).text,
      (await http("GET", "/api/overview", { headers: { cookie } })).text,
      JSON.stringify(dash.store.read()),
      logs.join("\n"),
    ].join("\n");
    expect(everything).not.toContain(KEY);
  });

  it("enforces account restrictions for local and hosted triage (consent never overrides triage off)", async () => {
    await start({ TYPESAFE_API_KEY: KEY });
    seed((d) => {
      d.workflowPolicy = POLICY;
      d.triage.hostedEnabled = true;
      d.connections.push(
        connection("excluded"),
        connection("hosted-only", {
          restrictions: { ...DENY_ALL, agentEnabled: true, hostedTriage: true },
        }),
        connection("local-ok", {
          restrictions: { ...DENY_ALL, agentEnabled: true, read: true, triage: true },
        }),
        connection("all-ok", {
          restrictions: {
            ...DENY_ALL,
            agentEnabled: true,
            read: true,
            triage: true,
            hostedTriage: true,
          },
        }),
      );
    });
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const classify = (accountId: string, useHosted: boolean) =>
      http("POST", "/api/triage/classify", {
        headers,
        body: { sample, synthetic: true, accountId, useHosted, consent: true },
      });
    expect((await classify("excluded", false)).status).toBe(403);
    expect((await classify("hosted-only", true)).status).toBe(403);
    const local = await classify("local-ok", false);
    expect(local.status).toBe(200);
    const hostedDenied = await classify("local-ok", true);
    expect(hostedDenied.json.hosted.status).toBe("not-allowed");
    expect(fetchMock).not.toHaveBeenCalled();
    const hosted = await classify("all-ok", true);
    expect(hosted.json.source).toBe("typesafe");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await classify("no-such-account", false)).status).toBe(404);
    // The capability display agrees with enforcement.
    const perms = await http("GET", "/api/permissions", { headers: { cookie } });
    const hostedCap = (id: string) =>
      perms.json.matrix
        .find((r: { id: string }) => r.id === id)
        .capabilities.find((c: { capability: string }) => c.capability === "hostedTriage");
    expect(hostedCap("hosted-only").allowed).toBe(false);
    expect(hostedCap("local-ok").allowed).toBe(false);
    expect(hostedCap("all-ok").allowed).toBe(true);
  });

  it("refuses samples not declared synthetic", async () => {
    await start({});
    const { cookie, csrf } = await signIn();
    const r = await http("POST", "/api/triage/classify", {
      headers: { cookie, origin: origin(), "x-csrf-token": csrf },
      body: { sample, useHosted: false, consent: false },
    });
    expect(r.status).toBe(400);
  });
});

describe("dashboard server: calendars", () => {
  beforeEach(() => start());

  function agent(name: string) {
    const d = join(dir, "agents", name);
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "identity.json"),
      JSON.stringify({ name, role: "personal", timeZone: "UTC" }),
    );
    // An initialised (empty) synthetic calendar: a missing one is unavailable, not free.
    writeFileSync(
      join(d, "calendar.json"),
      JSON.stringify({
        timeZone: "UTC",
        workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
        busy: [],
        holds: {},
      }),
    );
  }

  it("applies under the settings revision: a stale revision installs nothing", async () => {
    agent("owner-agent");
    seed((d) => {
      d.managedAgents = ["owner-agent"];
      d.calendars = [
        {
          id: "own",
          label: "Own",
          kind: "agent-synthetic",
          agent: "owner-agent",
          busy: [],
          enabled: true,
          permissions: { readAvailability: true, createBookings: true },
        },
      ];
      d.availability = {
        ...d.availability,
        authoritative: ["own"],
        bookingTarget: "own",
      };
    });
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const stale = await http("POST", "/api/calendars/apply", {
      headers,
      body: { baseRevision: 0, agent: "owner-agent" },
    });
    expect(stale.status).toBe(409);
    let cal = await http("GET", "/api/calendars", { headers: { cookie } });
    expect(cal.json.managedAgents[0].matchesSaved).toBeNull();
    const ok = await http("POST", "/api/calendars/apply", {
      headers,
      body: { baseRevision: 1, agent: "owner-agent" },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.applied.blocked).toBeNull();
    cal = await http("GET", "/api/calendars", { headers: { cookie } });
    // The history entry bumps the revision, but the applied content still matches the saved settings.
    expect(cal.json.revision).toBe(2);
    expect(cal.json.managedAgents[0].matchesSaved).toBe(true);
    expect(cal.json.managedAgents[0].availability.use).toBe("next-start");
    const unmanaged = await http("POST", "/api/calendars/apply", {
      headers,
      body: { baseRevision: 2, agent: "other" },
    });
    expect(unmanaged.status).toBe(400);
    expect(unmanaged.text).not.toContain(dir);
  });

  it("refuses calendar settings with unknown references or a foreign agent", async () => {
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const base = dash.store.read();
    const r = await http("PUT", "/api/calendars", {
      headers,
      body: {
        baseRevision: base.revision,
        calendars: [
          {
            id: "x",
            label: "X",
            kind: "agent-synthetic",
            agent: "alice",
            busy: [],
            enabled: true,
            permissions: { readAvailability: true, createBookings: true },
          },
        ],
        availability: { ...base.availability, authoritative: ["x"], bookingTarget: "x" },
      },
    });
    expect(r.status).toBe(400);
  });
});

describe("dashboard server: real clock versus synthetic scheduling clock", () => {
  const Real = new Date("2026-09-26T12:00:00Z");
  beforeEach(() => start({}, { now: () => Real, schedulingNow: () => NOW }));

  it("judges freshness and dates history with the real clock; previews use the demo clock", async () => {
    seed((d) => {
      d.connections.push(
        connection("seen-yesterday", {
          origin: "inventory",
          localConnector: { state: "none" },
          inventory: {
            observedAt: "2026-09-25T10:00:00Z",
            registryUpdated: "2026-09-12",
            connectorTarget: "gmail",
            setupStatus: "not_configured",
          },
        }),
      );
    });
    const { cookie, csrf } = await signIn();
    const headers = { cookie, origin: origin(), "x-csrf-token": csrf };
    const list = await http("GET", "/api/connections", { headers: { cookie } });
    // Observed yesterday by the real clock: fresh, although the demo clock is weeks later.
    expect(list.json.connections[0].status).toMatchObject({ state: "inventory", stale: false });
    const change = await http("PUT", "/api/connections/seen-yesterday", {
      headers,
      body: { baseRevision: 1, changes: { notes: "checked" } },
    });
    expect(change.json.connection.updatedAt).toBe(Real.toISOString());
    const history = await http("GET", "/api/history", { headers: { cookie } });
    expect(history.json.history[0].at).toBe(Real.toISOString());
    const cal = await http("GET", "/api/calendars", { headers: { cookie } });
    expect(cal.json.schedulingClock).toEqual({ now: NOW.toISOString(), synthetic: true });
    expect(cal.json.clock).toBe(NOW.toISOString());
  });
});
