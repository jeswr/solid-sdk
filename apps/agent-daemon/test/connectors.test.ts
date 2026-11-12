// AUTHORED-BY Codex GPT-6.1-Sol
import { createConnectionStore, ReauthoriseError } from "@jeswr/pod-connectors";
import { expect, it, vi } from "vitest";
import { type CliHost, runCli } from "../src/cli.js";
import {
  type ConnectorsJobOptions,
  connectorsPollDelay,
  createConnectorsJob,
  pendingVaultTokenSource,
} from "../src/connectors.js";
import { createMemoryPod } from "../src/testing.js";

const ROOT = "https://pod.example/",
  OWNER = `${ROOT}profile#me`,
  AT = Date.parse("2026-11-01T12:00:00.000Z");
function fixture() {
  const pod = createMemoryPod();
  const io: ConnectorsJobOptions["podFetch"] = async (input, init) => {
    const tag = new Headers(init?.headers).get("if-none-match");
    const current = pod.resources.get(String(input));
    if ((init?.method ?? "GET") === "GET" && tag && tag !== "*" && current?.etag === tag) {
      pod.requests.push({
        url: String(input),
        method: "GET",
        body: "",
        headers: new Headers(init?.headers),
      });
      return new Response(null, { status: 304, headers: { etag: tag } });
    }
    if (init?.method === "HEAD")
      return new Response(null, {
        status: pod.resources.has(String(input)) ? 200 : 404,
        headers: { link: `<${String(input)}.acl>; rel="acl"` },
      });
    return pod.io(input, {
      ...init,
      body: init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : init?.body,
    });
  };
  return {
    pod,
    io,
    options: {
      podRoot: ROOT,
      webId: OWNER,
      podFetch: io,
      profileDocumentUrl: `${ROOT}profile`,
      now: () => AT,
    },
  };
}
it("wires owner-only connection loading, vault stub, durable needs-reauth and safe health listing", async () => {
  const h = fixture(),
    config = createConnectionStore({ podRoot: ROOT, webId: OWNER, fetch: h.io });
  await config.read();
  await config.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
  const runner = vi.fn(),
    log = vi.fn();
  const job = createConnectorsJob({ ...h.options, runner, log });
  await job.tick();
  expect(runner).not.toHaveBeenCalled();
  expect(await config.read()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: false, status: "needs-reauth" },
  ]);
  expect(await job.list()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: false, health: "needs-reauth" },
  ]);
  expect(log).toHaveBeenCalledWith("Connectors pass complete");
  expect(h.pod.resources.get(`${ROOT}integrations/spotify/state.json`)?.body).toContain(
    '"outcome":"needs-reauth"',
  );
  await expect(pendingVaultTokenSource.accessToken("spotify", "fixture")).rejects.toBeInstanceOf(
    ReauthoriseError,
  );
  await job.tick();
  expect(runner).not.toHaveBeenCalled();
});
it("refreshes settings and executes the existing runner seam with a source token and cancellation signal", async () => {
  const h = fixture(),
    config = createConnectionStore({ podRoot: ROOT, webId: OWNER, fetch: h.io });
  await config.read();
  await config.write([{ connectorId: "spotify", account: "fixture", enabled: true }]);
  const tokenSource = { accessToken: vi.fn(async () => "synthetic") };
  const runner = vi.fn(async () => ({
    adapterId: "spotify",
    mode: "live" as const,
    written: [],
    categories: [],
    indexUrl: "https://pod.example/index",
    counts: { created: 1, updated: 0, unchanged: 0, skipped: 0 },
  }));
  const job = createConnectorsJob({ ...h.options, tokenSource, runner });
  const controller = new AbortController();
  await job.tick(controller.signal);
  expect(tokenSource.accessToken).toHaveBeenCalledWith("spotify", "fixture");
  expect(runner).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "live",
      signal: expect.any(AbortSignal),
      sourceAuth: { fetch: expect.any(Function) },
    }),
  );
  expect(await job.list()).toEqual([
    {
      connectorId: "spotify",
      account: "fixture",
      enabled: true,
      health: "ok",
      nextRunAt: "2026-11-01T13:00:00.000Z",
    },
  ]);
});
it("uses the same cancellable job loop on local/cloud hosts and avoids provider text in logs", async () => {
  const h = fixture(),
    controller = new AbortController(),
    log = vi.fn();
  const sleep = vi.fn(async () => {
    controller.abort();
  });
  const job = createConnectorsJob({ ...h.options, sleep, log });
  await job.run(controller.signal);
  expect(sleep).toHaveBeenCalledOnce();
  const bad = createConnectorsJob({
    ...h.options,
    podFetch: async () => {
      throw new Error("token=secret https://private.example");
    },
    log,
  });
  await expect(bad.tick()).rejects.toThrow();
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private/);
});
it("lists only validated opaque connection fields through awp connectors and scrubs errors", async () => {
  const print = vi.fn(),
    io = { print, confirm: vi.fn(), signal: new AbortController().signal };
  const connectors = vi.fn(async () => [
    { connectorId: "spotify", account: "fixture", enabled: false, health: "needs-reauth" as const },
  ]);
  const host = { connectors } as unknown as CliHost;
  expect(await runCli(["connectors"], host, io)).toBe(0);
  expect(print).toHaveBeenCalledWith("spotify fixture disabled needs-reauth");
  expect(await runCli(["connectors", "--unknown"], host, io)).toBe(2);
  connectors.mockRejectedValueOnce(new Error("secret https://private.example"));
  expect(await runCli(["connectors"], host, io)).toBe(1);
  expect(JSON.stringify(print.mock.calls)).not.toContain("secret");
  expect(await runCli(["connectors"], {} as CliHost, io)).toBe(1);
});

const settings = (h: ReturnType<typeof fixture>) =>
  createConnectionStore({ podRoot: ROOT, webId: OWNER, fetch: h.io });
async function seed(h: ReturnType<typeof fixture>, rows: readonly unknown[]) {
  const config = settings(h);
  await config.read();
  await config.write(rows);
  return config;
}
const okRun = async () => ({
  adapterId: "spotify",
  mode: "live" as const,
  written: [],
  categories: [],
  indexUrl: "https://pod.example/index",
  counts: { created: 0, updated: 0, unchanged: 1, skipped: 0 },
});

it("keeps polling with its own 30 s → 30 min back-off after failed passes and never rejects", async () => {
  expect([0, 1, 2, 3, 6, 7, 20].map(connectorsPollDelay)).toEqual([
    30_000, 30_000, 60_000, 120_000, 960_000, 1_800_000, 1_800_000,
  ]);
  const h = fixture(),
    controller = new AbortController(),
    log = vi.fn(),
    delays: number[] = [];
  let failing = 3;
  const podFetch: ConnectorsJobOptions["podFetch"] = async (input, init) => {
    if (failing > 0 && String(input).endsWith("connections.json")) {
      failing--;
      throw new Error("token=secret https://private.example");
    }
    return h.io(input, init);
  };
  const sleep = vi.fn(async (ms: number) => {
    delays.push(ms);
    if (delays.length === 5) controller.abort();
  });
  const job = createConnectorsJob({ ...h.options, podFetch, sleep, log });
  await expect(job.run(controller.signal)).resolves.toBeUndefined();
  expect(delays).toEqual([30_000, 60_000, 120_000, 30_000, 30_000]);
  expect(log.mock.calls.filter(([m]) => m === "Connectors pass failed")).toHaveLength(3);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private/);
});
it("polls settings with a conditional GET, protects ACLs once and reads state only when due", async () => {
  const h = fixture();
  await seed(h, [{ connectorId: "spotify", account: "fixture", enabled: true }]);
  let now = AT;
  const controller = new AbortController();
  let polls = 0;
  const sleep = vi.fn(async () => {
    polls++;
    now += 30_000;
    // Let the dispatched worker finish before the next poll.
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (polls === 20) controller.abort();
  });
  h.pod.requests.length = 0;
  const runner = vi.fn(okRun);
  const job = createConnectorsJob({
    ...h.options,
    now: () => now,
    sleep,
    runner,
    tokenSource: { accessToken: async () => "synthetic" },
  });
  await job.run(controller.signal);
  expect(runner).toHaveBeenCalledOnce();
  const settingsGets = h.pod.requests.filter(
    (r) => r.method === "GET" && r.url.endsWith("connections.json"),
  );
  expect(settingsGets).toHaveLength(20);
  expect(settingsGets.slice(1).every((r) => r.headers.get("if-none-match"))).toBe(true);
  const aclPuts = h.pod.requests.filter((r) => r.method === "PUT" && r.url.endsWith(".acl"));
  expect(aclPuts.map((r) => r.url).sort()).toEqual([
    `${ROOT}integrations/connections.json.acl`,
    `${ROOT}integrations/spotify/state.json.acl`,
    `${ROOT}integrations/spotify/state.json.acl`,
  ]);
  const stateGets = h.pod.requests.filter(
    (r) => r.method === "GET" && r.url.endsWith("spotify/state.json"),
  );
  // The initial load plus the conditional health update; idle polls read nothing.
  expect(stateGets).toHaveLength(2);
});
it("lists connections read-only, including invalid rows as invalid-config", async () => {
  const h = fixture();
  await seed(h, [
    { connectorId: "spotify", account: "fixture", enabled: true },
    { connectorId: "netflix", account: "fixture", enabled: true },
    { connectorId: "Bad", account: "x\nsecret", enabled: true },
  ]);
  h.pod.requests.length = 0;
  const job = createConnectorsJob({ ...h.options });
  expect(await job.list()).toEqual([
    { connectorId: "spotify", account: "fixture", enabled: true, health: "stale" },
    { connectorId: "netflix", account: "fixture", enabled: false, health: "invalid-config" },
    { connectorId: "-", account: "-", enabled: false, health: "invalid-config" },
  ]);
  expect(h.pod.requests.every((r) => r.method === "GET")).toBe(true);
  const print = vi.fn();
  const host = { connectors: job.list } as unknown as CliHost;
  expect(
    await runCli(["connectors"], host, {
      print,
      confirm: vi.fn(),
      signal: new AbortController().signal,
    }),
  ).toBe(0);
  expect(print.mock.calls.map(([line]) => line)).toEqual([
    "spotify fixture enabled stale",
    "netflix fixture disabled invalid-config",
    "- - disabled invalid-config",
  ]);
  expect(JSON.stringify(print.mock.calls)).not.toContain("secret");
});
it("schedules valid rows when another row is invalid", async () => {
  const h = fixture();
  await seed(h, [
    { connectorId: "unknown-connector", account: "fixture", enabled: true },
    { connectorId: "spotify", account: "fixture", enabled: true },
    "garbage",
  ]);
  const runner = vi.fn(okRun);
  const job = createConnectorsJob({
    ...h.options,
    runner,
    tokenSource: { accessToken: async () => "synthetic" },
  });
  await job.tick();
  expect(runner).toHaveBeenCalledOnce();
});
it("a fresh process sees the owner's durable re-enable through enabledAt", async () => {
  const h = fixture();
  const config = await seed(h, [{ connectorId: "spotify", account: "fixture", enabled: true }]);
  await createConnectorsJob({ ...h.options }).tick();
  expect((await config.read())?.[0]).toMatchObject({ enabled: false, status: "needs-reauth" });
  // The owner's UI re-enables: enabled, no status, newer enabledAt.
  await config.read();
  await config.write([
    {
      connectorId: "spotify",
      account: "fixture",
      enabled: true,
      enabledAt: "2026-11-01T12:10:00.000Z",
    },
  ]);
  const runner = vi.fn(okRun);
  const fresh = createConnectorsJob({
    ...h.options,
    now: () => AT + 15 * 60_000,
    runner,
    tokenSource: { accessToken: async () => "synthetic" },
  });
  expect((await fresh.list())[0]?.health).toBe("stale");
  await fresh.tick();
  expect(runner).toHaveBeenCalledOnce();
  expect((await fresh.list())[0]?.health).toBe("ok");
});
