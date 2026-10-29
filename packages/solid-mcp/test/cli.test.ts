// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSolidMcpServer } from "../src/server.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "dist/cli.js");
const preload = join(root, "test/fixtures/cli-preload.mjs");
const POD = "https://pod.example/alice/";
const WEBID = `${POD}profile/card#me`;
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
  SOLID_MCP_WEBID: WEBID,
  SOLID_MCP_CLIENT_ID: "fixture-id",
  SOLID_MCP_CLIENT_SECRET: "fixture-secret",
  SOLID_MCP_OIDC_ISSUER: "https://issuer.example/",
};
const text = (result: unknown) =>
  (result as { content: Array<{ text: string }> }).content.map((c) => c.text).join("\n");

async function registeredToolNames() {
  // Read the server's complete registry, including fetch-backed tools and aliases.
  const server = createSolidMcpServer({
    podRoot: POD,
    webId: WEBID,
    readOnly: false,
    fetch: async () => {
      throw new Error("Tool listing must not fetch pod data");
    },
  });
  const client = new Client({ name: "registry-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

describe("stdio executable", () => {
  it.each([
    "environment",
    "file",
  ])("logs in from %s and calls every registered tool over stdio", async (source) => {
    const expectedNames = await registeredToolNames();
    if (source === "file") {
      await mkdir(join(home, ".config/solid-mcp"), { recursive: true });
      await writeFile(
        join(home, ".config/solid-mcp/config.json"),
        JSON.stringify({
          podRoot: POD,
          webId: WEBID,
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
    const calledTools = new Set<string>();
    const callTool = async (request: Parameters<Client["callTool"]>[0]) => {
      const result = await client.callTool(request);
      expect(result.isError, `${request.name}: ${text(result)}`).toBeFalsy();
      calledTools.add(request.name);
      return result;
    };
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(expectedNames);
      for (const [listName, readName, searchName, writeName] of [
        ["pod_list", "pod_read", "search", "pod_write"],
        ["solid_list", "solid_read", "solid_search", "solid_write"],
      ]) {
        const list = await callTool({ name: listName, arguments: { container: POD } });
        expect(text(list)).toContain(`${POD}note`);
        const read = await callTool({ name: readName, arguments: { url: `${POD}note` } });
        expect(text(read)).toContain("hello fixture");
        const search = await callTool({ name: searchName, arguments: { query: "note" } });
        expect(text(search)).toContain(`${POD}note`);
        await callTool({
          name: writeName,
          arguments: { url: `${POD}written`, content: "hello fixture", contentType: "text/plain" },
        });
      }
      const stats = await callTool({
        name: "solid_read",
        arguments: { url: `${POD}stats` },
      });
      expect(text(stats)).toContain('"tokens":1');
      expect(text(stats)).toContain('"writes":2');

      const conversation = {
        provider: "codex",
        conversationId: "stdio-fixture",
        title: "Stdio fixture",
        messages: [
          {
            id: "m1",
            role: "user",
            text: "hello chat fixture",
            createdAt: "2026-10-25T12:00:00.000Z",
          },
        ],
      };
      const url = `${POD}private/chats/codex/stdio-fixture/`;
      const saved = await callTool({ name: "chat_save", arguments: conversation });
      expect(JSON.parse(text(saved))).toEqual({ url, saved: 1, skipped: 0 });
      const chats = await callTool({ name: "chat_list", arguments: {} });
      expect(JSON.parse(text(chats))).toEqual({
        conversations: [
          {
            url,
            provider: conversation.provider,
            conversationId: conversation.conversationId,
            title: conversation.title,
            updatedAt: conversation.messages[0]?.createdAt,
          },
        ],
      });
      const chat = await callTool({
        name: "chat_get",
        arguments: { provider: conversation.provider, conversationId: conversation.conversationId },
      });
      expect(JSON.parse(text(chat))).toEqual({ ...conversation, url });
      // New registrations require a successful stdio exercise, not just a listing update.
      expect([...calledTools].sort()).toEqual(expectedNames);
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
