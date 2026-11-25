// AUTHORED-BY Claude Opus 5.5
import type { ChatRedactionReport } from "@jeswr/solid-chat-interop";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { mkdtemp, rm } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRedactionMigration } from "./redaction-migration.js";
import { createCaptureTestTransport } from "./testing.js";

const env = {
  SOLID_MCP_POD_ROOT: "https://pod.example/alice/",
  SOLID_MCP_WEBID: "https://pod.example/alice/profile/card#me",
  SOLID_MCP_READONLY: "false",
  SOLID_MCP_CLIENT_ID: "fixture-id",
  SOLID_MCP_CLIENT_SECRET: "fixture-secret",
  SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
};
let home: string;
let transport: ReturnType<typeof createCaptureTestTransport>;
let reports: ChatRedactionReport[];
const run = (args: string[], overrides: Record<string, string> = {}) =>
  runRedactionMigration(args, {
    home,
    env: { ...env, ...overrides },
    fetch: transport.fetch,
    report: (report) => reports.push(report),
  });

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "capture-redact-test-"));
  transport = createCaptureTestTransport();
  reports = [];
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("solid-capture redact-archive (sst-5ax.39)", () => {
  it("runs with DPoP over the chat archive and reports content-free counts", async () => {
    for (const args of [["redact-archive"], ["redact-archive", "--dry-run"]]) {
      transport.requests.length = 0;
      expect(await run(args)).toBe(0);
      // Authenticated reads of the archive's provider containers, no writes on an empty pod.
      const pod = transport.requests.filter((r) => r.url.startsWith(env.SOLID_MCP_POD_ROOT));
      expect(pod.map((r) => r.url)).toEqual(
        ["claude", "chatgpt", "codex"].map(
          (provider) => `${env.SOLID_MCP_POD_ROOT}private/chats/${provider}/`,
        ),
      );
      expect(pod.every((r) => r.method === "GET" && r.headers.has("dpop"))).toBe(true);
    }
    expect(reports).toEqual([
      {
        dryRun: false,
        conversations: 0,
        titles: 0,
        messagesRewritten: 0,
        messagesReplaced: 0,
        conflicts: 0,
        failed: 0,
      },
      expect.objectContaining({ dryRun: true, conversations: 0 }),
    ]);
  });

  it("allows a read-only dry run but needs writable owner config to change anything", async () => {
    expect(await run(["redact-archive", "--dry-run"], { SOLID_MCP_READONLY: "true" })).toBe(0);
    transport.requests.length = 0;
    expect(await run(["redact-archive"], { SOLID_MCP_READONLY: "true" })).toBe(1);
    expect(await run(["redact-archive"], { SOLID_MCP_CLIENT_ID: "" })).toBe(1);
    expect(await run(["redact-archive"], { SOLID_MCP_WEBID: "" })).toBe(1);
    expect(transport.requests).toEqual([]);
  });

  it("rejects unknown arguments before any request", async () => {
    for (const args of [
      [],
      ["redact"],
      ["redact-archive", "--force"],
      ["redact-archive", "--dry-run", "--dry-run"],
    ])
      expect(await run(args)).toBe(1);
    expect(transport.requests).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("prints the counts but exits 1 when a chat could not be checked", async () => {
    const root = env.SOLID_MCP_POD_ROOT;
    const result = await runRedactionMigration(["redact-archive", "--dry-run"], {
      home,
      env,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        // One conversation is listed, but its metadata cannot be read.
        if (request.url === `${root}private/chats/claude/`)
          return new Response(
            `<${root}private/chats/claude/> <http://www.w3.org/ns/ldp#contains> <${root}private/chats/claude/thread-1/>.`,
            { headers: { "content-type": "text/turtle" } },
          );
        if (request.url.startsWith(root) && request.url.includes("thread-1"))
          return new Response("secret detail", { status: 500 });
        return transport.fetch(input, init);
      },
      report: (report) => reports.push(report),
    });
    expect(result).toBe(1);
    expect(reports).toEqual([expect.objectContaining({ conversations: 1, failed: 1 })]);
    expect(JSON.stringify(reports)).not.toContain("secret detail");
  });

  it("fails closed without exposing remote errors", async () => {
    const failing = createCaptureTestTransport();
    const result = await runRedactionMigration(["redact-archive"], {
      home,
      env,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url.startsWith(env.SOLID_MCP_POD_ROOT))
          return new Response("secret detail", { status: 500 });
        return failing.fetch(input, init);
      },
      report: (report) => reports.push(report),
    });
    expect(result).toBe(1);
    expect(reports).toEqual([]);
  });
});
