// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { createFixtureRecorder } from "../core/fixture-recorder.js";
import * as importRunner from "../core/import-runner.js";
import { TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import type { IntegrationAdapter } from "../core/types.js";
import { githubAdapter } from "../github/adapter.js";
import * as registry from "../registry.js";
import { EXIT_CODES, runCli } from "./cli.js";
import * as config from "./config.js";
import * as loopback from "./loopback.js";
import * as podAuth from "./pod-auth.js";
import * as state from "./state.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  ["import runner", "own"],
  ["fixture recorder", "own"],
  ["fixture recorder", "inherited"],
  ["fixture recorder", "hidden"],
])("keeps per-request cancellation through CLI withSignal and %s (%s init)", async (wrapper, kind) => {
  const target = "https://api.github.com/user";
  const command = new AbortController();
  const perRequest = new AbortController();
  const reason = new DOMException("Per-request cancellation", "AbortError");
  perRequest.abort(reason);
  const send = vi.fn();
  const sourceTransport = vi.fn<typeof fetch>(async (input, init) => {
    init?.signal?.throwIfAborted();
    send(new Request(input, init));
    return Response.json({});
  });
  vi.spyOn(config, "readNodeConfig").mockResolvedValue({
    webId: TEST_WEBID,
    podRoot: TEST_POD_ROOT,
    profileDocumentUrl: TEST_PROFILE_DOC,
    oidcIssuer: "https://issuer.test/",
    clientId: "synthetic-client",
    clientSecret: "synthetic-secret",
    connectors: {},
  });
  vi.spyOn(podAuth, "createClientCredentialsFetch").mockResolvedValue(vi.fn<typeof fetch>());
  vi.spyOn(state, "createStateStore").mockReturnValue({
    url: `${TEST_POD_ROOT}state.json`,
    read: async () => undefined,
    write: vi.fn(),
  });
  vi.spyOn(loopback, "authorizeLoopback").mockResolvedValue({
    accessToken: "synthetic-token",
    tokenType: "Bearer",
  });
  const adapter: IntegrationAdapter = {
    ...githubAdapter,
    createSourceAuth:
      wrapper === "fixture recorder"
        ? (_config, _token, fetch) => createFixtureRecorder({ fetch, routes: [{ url: target }] })
        : undefined,
  };
  const actualRegistry = registry.createRegistry();
  vi.spyOn(registry, "createRegistry").mockReturnValue({
    ...actualRegistry,
    adapterById: () => adapter,
  });
  let rejection: unknown;
  const runImport = vi.spyOn(importRunner, "runImport").mockImplementation(async (options) => {
    // Keep the real source wrappers and CLI transport closure; only replace the adapter run.
    try {
      const init =
        kind === "inherited"
          ? Object.create({ signal: perRequest.signal })
          : kind === "hidden"
            ? Object.defineProperty({}, "signal", { value: perRequest.signal })
            : { signal: perRequest.signal };
      await options.sourceAuth?.fetch(new Request(target), init);
    } catch (error) {
      rejection = error;
    }
    throw reason;
  });

  expect(
    await runCli(["import", "github"], {
      signal: command.signal,
      sourceTransport,
      stdout: vi.fn(),
      stderr: vi.fn(),
    }),
  ).toBe(EXIT_CODES.import);

  expect(runImport).toHaveBeenCalledOnce();
  expect(sourceTransport).toHaveBeenCalledOnce();
  expect(sourceTransport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  expect(rejection).toBe(reason);
  expect(send).not.toHaveBeenCalled();
  expect(command.signal.aborted).toBe(false);
});
