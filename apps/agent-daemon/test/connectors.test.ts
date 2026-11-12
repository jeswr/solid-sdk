// AUTHORED-BY Codex GPT-6.1-Sol
import { createConnectionStore, ReauthoriseError } from "@jeswr/pod-connectors";
import { expect, it, vi } from "vitest";
import { type CliHost, runCli } from "../src/cli.js";
import {
  type ConnectorsJobOptions,
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
