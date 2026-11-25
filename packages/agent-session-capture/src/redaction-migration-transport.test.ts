// AUTHORED-BY Claude Sonnet 5.5
// The default transport: createNodeGuardedFetch is allowed loopback only for a local pod.
import type { ChatRedactionReport } from "@jeswr/solid-chat-interop";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { mkdtemp, rm } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureTestTransport } from "./testing.js";

const guarded = vi.hoisted(() => ({
  create: vi.fn(),
  fetch: undefined as typeof fetch | undefined,
}));
vi.mock("@jeswr/guarded-fetch/node", () => ({
  createNodeGuardedFetch: (options: unknown) => {
    guarded.create(options);
    return guarded.fetch;
  },
}));

const { runRedactionMigration } = await import("./redaction-migration.js");

const base = {
  SOLID_MCP_WEBID: "https://pod.example/alice/profile/card#me",
  SOLID_MCP_READONLY: "false",
  SOLID_MCP_CLIENT_ID: "fixture-id",
  SOLID_MCP_CLIENT_SECRET: "fixture-secret",
};
let home: string;
let reports: ChatRedactionReport[];
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "capture-redact-transport-"));
  guarded.create.mockClear();
  guarded.fetch = createCaptureTestTransport().fetch;
  reports = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});
const run = (env: Record<string, string>, args = ["redact-archive"]) =>
  runRedactionMigration(args, {
    home,
    env: { ...base, ...env },
    report: (report) => reports.push(report),
  });

describe("redact-archive default transport", () => {
  it.each([
    [
      "a remote pod",
      {
        SOLID_MCP_POD_ROOT: "https://pod.example/alice/",
        SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      },
      false,
    ],
    [
      "localhost",
      {
        SOLID_MCP_POD_ROOT: "http://localhost:3000/alice/",
        SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      },
      true,
    ],
    [
      "127.0.0.1",
      {
        SOLID_MCP_POD_ROOT: "http://127.0.0.1:3000/alice/",
        SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      },
      true,
    ],
    [
      "[::1]",
      {
        SOLID_MCP_POD_ROOT: "http://[::1]:3000/alice/",
        SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      },
      true,
    ],
    [
      "a local token endpoint",
      {
        SOLID_MCP_POD_ROOT: "https://pod.example/alice/",
        SOLID_MCP_TOKEN_URL: "http://localhost:3000/token",
      },
      true,
    ],
    [
      "a lookalike host",
      {
        SOLID_MCP_POD_ROOT: "https://localhost.evil.example/alice/",
        SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      },
      false,
    ],
  ])("sets allowLoopback for %s", async (_name, env, allowLoopback) => {
    // Whether the later login accepts the endpoint is not the point: the transport is built first.
    await run(env);
    expect(guarded.create).toHaveBeenCalledTimes(1);
    expect(guarded.create).toHaveBeenCalledWith({ allowLoopback });
  });

  it("checks the OIDC issuer too", async () => {
    await run({
      SOLID_MCP_POD_ROOT: "https://pod.example/alice/",
      SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      SOLID_MCP_OIDC_ISSUER: "http://127.0.0.1:4000/",
    });
    expect(guarded.create).toHaveBeenCalledWith({ allowLoopback: true });
  });

  it("prints the report as one JSON line on stdout by default", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const code = await runRedactionMigration(["redact-archive", "--dry-run"], {
      home,
      env: {
        ...base,
        SOLID_MCP_POD_ROOT: "https://pod.example/alice/",
        SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
      },
    });
    expect(code).toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({
      dryRun: true,
      conversations: 0,
    });
  });

  it("uses the process environment and home directory when none are given", async () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.stubEnv("SOLID_MCP_POD_ROOT", "");
    vi.stubEnv("HOME", home);
    // No owner config in the environment or home: fails closed before any request.
    expect(await runRedactionMigration(["redact-archive"])).toBe(1);
    vi.unstubAllEnvs();
    expect(guarded.create).not.toHaveBeenCalled();
  });
});
