// AUTHORED-BY Codex GPT-6.1-Sol
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { ChatWriter } from "@jeswr/solid-chat-interop";
import { createChatPodPort } from "@jeswr/solid-mcp";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { homedir, tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExportImportOptions, runExportImport } from "./export-import.js";
import { digest } from "./parsers.js";
import { createCaptureTestTransport, createCaptureTestZip as zip } from "./testing.js";

vi.mock("@jeswr/guarded-fetch/node", async (original) => {
  const node = await original<typeof import("@jeswr/guarded-fetch/node")>();
  return { ...node, createNodeGuardedFetch: vi.fn(node.createNodeGuardedFetch) };
});
vi.mock("os", async (original) => {
  const os = await original<typeof import("os")>();
  return { ...os, homedir: vi.fn(os.homedir) };
});

const fixture = (provider: string) =>
  readFile(new URL(`./fixtures/${provider}-export.json`, import.meta.url), "utf8");
const chat = (message: unknown, extra: object = {}) =>
  JSON.stringify([{ id: "chat", mapping: { node: { message } }, ...extra }]);
const message = (extra: object = {}) => ({
  author: { role: "user" },
  content: { parts: ["Hello"] },
  ...extra,
});
const claude = (extra: object = {}) =>
  JSON.stringify([{ uuid: "chat", chat_messages: [{ sender: "human", text: "Hello" }], ...extra }]);

let home: string;
let cwd: string;
let source: string;
let transport: ReturnType<typeof createCaptureTestTransport>;
let options: ExportImportOptions;
const env = {
  SOLID_MCP_POD_ROOT: "https://pod.example/alice/",
  SOLID_MCP_WEBID: "https://pod.example/alice/profile/card#me",
  SOLID_MCP_READONLY: "false",
  SOLID_MCP_CLIENT_ID: "fixture-id",
  SOLID_MCP_CLIENT_SECRET: "fixture-secret",
  SOLID_MCP_TOKEN_URL: "https://issuer.example/token",
};
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "capture-export-test-"));
  cwd = join(home, "project");
  await mkdir(cwd);
  source = join(cwd, "conversations.json");
  transport = createCaptureTestTransport();
  options = { home, cwd, env, fetch: transport.fetch };
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("explicit imports with real ChatWriter and DPoP", () => {
  it.each([
    "chatgpt",
    "claude",
  ])("imports %s fixture privately, redacts and re-runs idempotently", async (provider) => {
    await writeFile(
      source,
      (await fixture(provider)).replace("A fixture question.", "sk-fixture-secret"),
    );
    const args = [`${provider}-export`, source];
    expect(await runExportImport(args, options)).toBe(0);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      2,
    );
    expect(JSON.stringify([...transport.resources])).not.toMatch(/sk-fixture|DROP_/);
    const writes = transport.requests.filter((r) => r.method === "PUT");
    expect(writes[0]?.url).toBe(`${env.SOLID_MCP_POD_ROOT}private/chats/.acl`);
    expect(
      writes.every(
        (r) =>
          r.headers.get("authorization") === "DPoP fixture-access-token" && r.headers.has("dpop"),
      ),
    ).toBe(true);
    expect(
      writes
        .filter((r) => /\/m-.*\.ttl$/.test(r.url))
        .every((r) => r.headers.get("if-none-match") === "*"),
    ).toBe(true);
    const original = new Map(transport.resources);
    expect(await runExportImport(args, options)).toBe(0);
    expect(transport.resources).toEqual(original);
  });
  it("imports a deflated archive through the command without filesystem extraction", async () => {
    const path = join(cwd, "export.ZIP");
    await writeFile(
      path,
      zip([{ name: "conversations.json", text: await fixture("chatgpt"), deflate: true }]),
    );
    expect(await runExportImport(["chatgpt-export", "export.ZIP"], options)).toBe(0);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      2,
    );
    expect(await runExportImport(["claude-export", path], options)).toBe(1);
  });
  it("preserves timestamp-tie order and IDs when later exports remove earlier messages", async () => {
    const text = claude({
      chat_messages: ["first", "second", "third"].map((uuid) => ({
        uuid,
        sender: "human",
        text: uuid,
      })),
    });
    await writeFile(source, text);
    await runExportImport(["claude-export", source], options);
    const before = new Map(transport.resources);
    const partial = JSON.parse(text);
    partial[0].chat_messages.shift();
    await writeFile(source, JSON.stringify(partial));
    await runExportImport(["claude-export", source], options);
    expect(transport.resources).toEqual(before);
    const port = createChatPodPort({
      podRoot: env.SOLID_MCP_POD_ROOT,
      webId: env.SOLID_MCP_WEBID,
      fetch: transport.fetch,
    });
    const writer = new ChatWriter({
      ...port,
      async list(container) {
        return [...transport.resources.keys()]
          .filter((url) => url.startsWith(container) && !url.slice(container.length).includes("/"))
          .reverse()
          .map((url) => ({ url, isContainer: false }));
      },
    });
    expect(
      (await writer.get("claude", digest(["claude-export", "chat"]))).messages.map((m) => m.text),
    ).toEqual(["first", "second", "third"]);
  });
  it.each([
    [],
    ["other", "file"],
    ["chatgpt-export"],
    ["chatgpt-export", "file", "extra"],
  ])("refuses invalid arguments: %j", async (...args) => {
    expect(await runExportImport(args, options)).toBe(1);
    expect(transport.requests).toEqual([]);
  });
  it("does no network I/O on invalid files, opt-out, empty input or read-only config", async () => {
    await writeFile(source, "broken");
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(1);
    await writeFile(source, "[]");
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(0);
    await writeFile(source, chat(message()));
    for (const overrides of [
      { SOLID_MCP_READONLY: "true" },
      { SOLID_MCP_CLIENT_ID: "" },
      { SOLID_MCP_WEBID: "" },
    ])
      expect(
        await runExportImport(["chatgpt-export", source], {
          ...options,
          env: { ...env, ...overrides },
        }),
      ).toBe(1);
    await writeFile(join(cwd, ".solid-capture-ignore"), "");
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(1);
    expect(transport.requests).toEqual([]);
  });
  it("checks the export's parent opt-out too and rechecks before upload", async () => {
    await writeFile(source, chat(message()));
    options.cwd = home;
    await writeFile(join(cwd, ".solid-capture-ignore"), "");
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(1);
    await rm(join(cwd, ".solid-capture-ignore"));
    const http = options.fetch as NonNullable<ExportImportOptions["fetch"]>;
    options.fetch = async (input, init) => {
      await writeFile(join(cwd, ".solid-capture-ignore"), "");
      return http(input, init);
    };
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(1);
    expect(transport.requests.every((r) => r.url === env.SOLID_MCP_TOKEN_URL)).toBe(true);
  });
  it("fails closed on auth/ACL errors and can retry partial uploads", async () => {
    await writeFile(source, await fixture("chatgpt"));
    expect(
      await runExportImport(["chatgpt-export", source], {
        ...options,
        fetch: async () => {
          throw new Error("secret body");
        },
      }),
    ).toBe(1);
    expect(
      await runExportImport(["chatgpt-export", source], {
        ...options,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.url.endsWith(".acl") && request.method === "PUT")
            return new Response(null, { status: 403 });
          return transport.fetch(request);
        },
      }),
    ).toBe(1);
    expect(transport.resources.size).toBe(0);
    let count = 0;
    expect(
      await runExportImport(["chatgpt-export", source], {
        ...options,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.method === "PUT" && /\/m-.*\.ttl$/.test(request.url) && ++count === 2)
            return new Response("fixture failure", { status: 500 });
          return transport.fetch(request);
        },
      }),
    ).toBe(1);
    const retained = [...transport.resources.entries()].filter(([url]) => /\/m-.*\.ttl$/.test(url));
    expect(retained).toHaveLength(1);
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(0);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      2,
    );
    expect(transport.resources.get(retained[0]?.[0] as string)).toBe(retained[0]?.[1]);
  });
  it("hashes traversal-shaped source IDs before choosing any pod path", async () => {
    await writeFile(source, chat(message({ id: "../../message" }), { id: "../../conversation" }));
    expect(await runExportImport(["chatgpt-export", source], options)).toBe(0);
    expect(
      [...transport.resources.keys()].every((url) =>
        url.startsWith(`${env.SOLID_MCP_POD_ROOT}private/chats/`),
      ),
    ).toBe(true);
    expect([...transport.resources.keys()].filter((url) => /\/m-/.test(url))).toEqual([
      expect.stringMatching(/\/chatgpt\/[a-f0-9]{64}\/m-[a-f0-9]{64}\.ttl\.acl$/),
      expect.stringMatching(/\/chatgpt\/[a-f0-9]{64}\/m-[a-f0-9]{64}\.ttl$/),
    ]);
  });
  it("bounds the number of messages serialized by each ChatWriter save", async () => {
    await writeFile(
      source,
      claude({
        chat_messages: Array.from({ length: 101 }, (_, index) => ({
          uuid: String(index),
          sender: "human",
          text: "Fixture turn",
        })),
      }),
    );
    const save = vi
      .spyOn(ChatWriter.prototype, "save")
      .mockResolvedValue({ url: "https://pod.example/", saved: 0, skipped: 0 });
    expect(await runExportImport(["claude-export", source], options)).toBe(0);
    expect(save.mock.calls.map(([chat]) => chat.messages.length)).toEqual([100, 1]);
  });
  it("uses default config boundaries and guarded DNS transport with explicit loopback only", async () => {
    await writeFile(source, chat(message()));
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    vi.mocked(homedir).mockReturnValue(home);
    vi.mocked(createNodeGuardedFetch).mockReturnValue(transport.fetch);
    expect(await runExportImport(["chatgpt-export", source])).toBe(0);
    expect(createNodeGuardedFetch).toHaveBeenLastCalledWith({ allowLoopback: false });
    for (const token of [undefined, "http://127.0.0.1/token", "https://issuer.example/token"]) {
      const { SOLID_MCP_TOKEN_URL: _, ...rest } = env;
      await runExportImport(["chatgpt-export", source], {
        home,
        cwd,
        env: {
          ...rest,
          SOLID_MCP_OIDC_ISSUER: "https://issuer.example/",
          ...(token ? { SOLID_MCP_TOKEN_URL: token } : {}),
        },
      });
      expect(createNodeGuardedFetch).toHaveBeenLastCalledWith({
        allowLoopback: token?.includes("127.0.0.1") ?? false,
      });
    }
  });
  it("honors cancellation before reads and in the request transport", async () => {
    await writeFile(source, chat(message()));
    const controller = new AbortController();
    controller.abort();
    expect(
      await runExportImport(["chatgpt-export", source], { ...options, signal: controller.signal }),
    ).toBe(1);
    const during = new AbortController();
    expect(
      await runExportImport(["chatgpt-export", source], {
        ...options,
        signal: during.signal,
        fetch: async (input, init) => {
          const response = await transport.fetch(input, init);
          during.abort();
          return response;
        },
      }),
    ).toBe(1);
    expect(transport.resources.size).toBe(0);
  });
});
