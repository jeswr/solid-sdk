// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist/cli.js");
const preload = join(root, "test/fixtures/cli-preload.mjs");
const POD = "https://pod.example/alice/";
let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solid-mcp-cli-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
function env(extra: Record<string, string> = {}) {
  return { PATH: process.env.PATH ?? "", SOLID_MCP_TEST_HOME: home, ...extra };
}
const credentials = {
  SOLID_MCP_POD_ROOT: POD,
  SOLID_MCP_CLIENT_ID: "fixture-id",
  SOLID_MCP_CLIENT_SECRET: "fixture-secret",
  SOLID_MCP_OIDC_ISSUER: "https://issuer.example/",
};
const text = (result: unknown) =>
  (result as { content: Array<{ text: string }> }).content.map((c) => c.text).join("\n");

describe("stdio executable", () => {
  it.each([
    "environment",
    "file",
  ])("logs in from %s, registers chat tools and calls pod tools over stdio", async (source) => {
    if (source === "file") {
      await mkdir(join(home, ".config/solid-mcp"), { recursive: true });
      await writeFile(
        join(home, ".config/solid-mcp/config.json"),
        JSON.stringify({
          podRoot: POD,
          clientId: "fixture-id",
          clientSecret: "fixture-secret",
          tokenUrl: "https://issuer.example/token",
          readOnly: false,
        }),
        { mode: 0o600 },
      );
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", preload, cli],
      env: env(source === "environment" ? { ...credentials, SOLID_MCP_READONLY: "false" } : {}),
      stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: "fixture-client", version: "1" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "chat_get",
        "chat_list",
        "chat_save",
        "pod_list",
        "pod_read",
        "pod_write",
        "search",
        "solid_list",
        "solid_read",
        "solid_search",
        "solid_write",
      ]);
      for (const [listName, readName, searchName, writeName] of [
        ["pod_list", "pod_read", "search", "pod_write"],
        ["solid_list", "solid_read", "solid_search", "solid_write"],
      ]) {
        const list = await client.callTool({ name: listName, arguments: { container: POD } });
        expect(list.isError, text(list)).toBeFalsy();
        expect(text(list)).toContain(`${POD}note`);
        const read = await client.callTool({ name: readName, arguments: { url: `${POD}note` } });
        expect(read.isError).toBeFalsy();
        expect(text(read)).toContain("hello fixture");
        const search = await client.callTool({ name: searchName, arguments: { query: "note" } });
        expect(search.isError).toBeFalsy();
        expect(text(search)).toContain(`${POD}note`);
        const write = await client.callTool({
          name: writeName,
          arguments: { url: `${POD}written`, content: "hello fixture", contentType: "text/plain" },
        });
        expect(write.isError).toBeFalsy();
      }
      const stats = await client.callTool({
        name: "solid_read",
        arguments: { url: `${POD}stats` },
      });
      expect(text(stats)).toContain('"tokens":1');
      expect(text(stats)).toContain('"writes":2');
      expect(stderr).not.toContain("fixture-secret");
      expect(stderr).not.toContain("fixture-token");
    } finally {
      await client.close();
    }
  });
  it("retains read-only behavior with credentials", async () => {
    const client = new Client({ name: "fixture-client", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", preload, cli],
      env: env(credentials),
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      for (const name of ["pod_write", "solid_write"]) {
        const write = await client.callTool({
          name,
          arguments: { url: `${POD}written`, content: "hello fixture", contentType: "text/plain" },
        });
        expect(write.isError).toBe(true);
        expect(text(write)).toMatch(/read-only/);
      }
    } finally {
      await client.close();
    }
  });
  it.each([
    { SOLID_MCP_POD_ROOT: POD, SOLID_MCP_CLIENT_ID: "fixture-id" },
    { ...credentials, SOLID_MCP_TEST_AUTH_FAIL: "true" },
  ])("fails startup without anonymous fallback or secret diagnostics", async (extra) => {
    const child = spawn(process.execPath, ["--import", preload, cli], {
      env: env(extra),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toMatch(/require|login failed/);
    expect(stderr).not.toContain("fixture-secret");
  });
});
