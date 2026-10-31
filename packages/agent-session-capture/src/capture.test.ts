// AUTHORED-BY Codex GPT-6.1-Sol

import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
import { ChatWriter } from "@jeswr/solid-chat-interop";
import { createChatPodPort } from "@jeswr/solid-mcp";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { createServer } from "http";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CaptureOptions, runCapture } from "./capture.js";
import { digest } from "./parsers.js";
import { createCaptureTestTransport } from "./testing.js";

vi.mock("@jeswr/guarded-fetch/node", async (original) => {
  const node = await original<typeof import("@jeswr/guarded-fetch/node")>();
  return { ...node, createNodeGuardedFetch: vi.fn(node.createNodeGuardedFetch) };
});

const config = {
  podRoot: "https://pod.example/alice/",
  webId: "https://pod.example/alice/profile/card#me",
  readOnly: false,
  clientId: "fixture-id",
  clientSecret: "fixture-secret",
  tokenUrl: "https://issuer.example/token",
};
const env = {
  SOLID_MCP_POD_ROOT: config.podRoot,
  SOLID_MCP_WEBID: config.webId,
  SOLID_MCP_READONLY: "false",
  SOLID_MCP_CLIENT_ID: config.clientId,
  SOLID_MCP_CLIENT_SECRET: config.clientSecret,
  SOLID_MCP_TOKEN_URL: config.tokenUrl,
};
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/${name}.jsonl`, import.meta.url), "utf8");
let home: string;
let cwd: string;
let transcript: string;
let transport: ReturnType<typeof createCaptureTestTransport>;
let options: CaptureOptions;
const queue = () => join(home, ".local/state/solid-capture/queue");
const queued = async () => (await readdir(queue())).filter((name) => name.endsWith(".json"));
async function* input(value: unknown) {
  yield JSON.stringify(value);
}
async function rollout(text: string, name = "rollout-fixture.jsonl") {
  const dir = join(home, ".codex/sessions/2026/10/25");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, text.replaceAll("/fixture-project", cwd));
  return path;
}
async function storedConversation(provider: "claude" | "codex") {
  const port = createChatPodPort({ ...config, fetch: transport.fetch });
  const writer = new ChatWriter({
    ...port,
    async list(container) {
      return [...transport.resources.keys()]
        .filter((url) => url.startsWith(container) && !url.slice(container.length).includes("/"))
        .reverse()
        .map((url) => ({ url, isContainer: url.endsWith("/") }));
    },
  });
  return writer.get(provider, digest([provider, `${provider}-fixture-session`]));
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "solid-capture-test-"));
  cwd = join(home, "project");
  await mkdir(cwd);
  transcript = join(home, "transcript.jsonl");
  await writeFile(transcript, (await fixture("claude")).replaceAll("/fixture-project", cwd));
  transport = createCaptureTestTransport();
  options = { home, cwd, env, fetch: transport.fetch };
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("capture with real ChatWriter and client credentials", () => {
  it("writes private redacted AS2 with DPoP and re-runs idempotently", async () => {
    const text = await readFile(transcript, "utf8");
    await writeFile(
      transcript,
      text.replace(
        "Please inspect the project. [REDACTED TOKEN]",
        "Please inspect. sk-fixture-capture-secret",
      ),
    );
    expect(await runCapture(["claude", "--transcript", transcript], options)).toBe(0);
    const messages = [...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url));
    expect(messages).toHaveLength(4);
    expect(transport.requests[0]?.url).toBe(config.tokenUrl);
    const writes = transport.requests.filter((r) => r.method === "PUT");
    expect(
      writes.every(
        (r) =>
          r.headers.get("authorization") === "DPoP fixture-access-token" && r.headers.has("dpop"),
      ),
    ).toBe(true);
    expect(writes[0]?.url).toBe(`${config.podRoot}private/chats/.acl`);
    expect(
      writes
        .filter((r) => messages.includes(r.url))
        .every((r) => r.headers.get("if-none-match") === "*"),
    ).toBe(true);
    expect(JSON.stringify([...transport.resources])).not.toMatch(/sk-fixture|DROP_/);
    expect(await queued()).toEqual([]);
    const before = new Map(transport.resources);
    await runCapture(["claude", "--transcript", transcript], options);
    expect(transport.resources).toEqual(before);
    const result = await storedConversation("claude");
    expect(result.messages.map((m) => m.text)).toEqual([
      "Please inspect. [REDACTED TOKEN]",
      "I will inspect it.",
      "Read",
      "The project looks good.",
    ]);
  });

  it.each([
    "claude",
    "codex",
  ] as const)("keeps %s IDs, checkpoints and timestamp-tie order after trimming", async (provider) => {
    const stamp = "2026-10-25T12:00:00.000Z";
    const metadata =
      provider === "claude"
        ? { sessionId: "claude-fixture-session", cwd }
        : { type: "session_meta", payload: { id: "codex-fixture-session", cwd } };
    const row = (id: string, texts: string[]) => {
      const message = { role: "assistant", content: texts.map((text) => ({ type: "text", text })) };
      return provider === "claude"
        ? { type: "assistant", timestamp: stamp, uuid: id, message }
        : { type: "response_item", timestamp: stamp, payload: { ...message, type: "message" } };
    };
    const texts = Array.from({ length: 20 }, (_, index) => `Block ${index}`);
    const retained = row("retained", texts);
    const jsonl = (rows: unknown[]) => rows.map((value) => JSON.stringify(value)).join("\n");
    const original = jsonl([metadata, row("earlier", ["Before"]), retained]);
    const path = provider === "claude" ? transcript : await rollout(original);
    await writeFile(path, original);
    const args = provider === "claude" ? [provider, "--transcript", path] : [provider];
    await runCapture(args, options);
    const first = await storedConversation(provider);
    expect(first.messages.map((message) => message.text)).toEqual(["Before", ...texts]);
    const resources = new Map(transport.resources);
    transport.requests.length = 0;
    await writeFile(path, jsonl([metadata, retained]));
    await runCapture(args, options);
    expect(transport.requests).toEqual([]);
    expect(transport.resources).toEqual(resources);

    const appended = jsonl([metadata, retained, row("appended", ["Appended"])]);
    await writeFile(path, appended);
    await runCapture(args, {
      ...options,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const snapshots = await queued();
    expect(snapshots).toHaveLength(1);
    const snapshot = JSON.parse(await readFile(join(queue(), snapshots[0] as string), "utf8"));
    expect(snapshot.conversation.messages.slice(0, texts.length)).toEqual(first.messages.slice(1));
    // Replay after the source disappears must retain the persisted assignments.
    await rm(path);
    transport.requests.length = 0;
    await runCapture(["codex"], options);
    expect(
      transport.requests.filter(
        (request) => request.method === "PUT" && /\/m-.*\.ttl$/.test(request.url),
      ),
    ).toHaveLength(1);
    const result = await storedConversation(provider);
    expect(result.messages.map((message) => message.text)).toEqual([
      "Before",
      ...texts,
      "Appended",
    ]);
    expect(result.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(await queued()).toEqual([]);
    await writeFile(path, appended);
    transport.requests.length = 0;
    await runCapture(args, options);
    expect(transport.requests).toEqual([]);
  });

  it("queues and uploads native Codex tool names without their arguments or results", async () => {
    const calls = ["web_search_call", "image_generation_call"].map((type) =>
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-10-25T12:00:05.000Z",
        payload: {
          type,
          id: type,
          status: "completed",
          action: { type: "search", query: "DROP_QUERY" },
          revised_prompt: "DROP_PROMPT",
          result: "DROP_RESULT",
        },
      }),
    );
    await rollout(`${await fixture("codex")}\n${calls.join("\n")}`);
    await runCapture(["codex"], {
      ...options,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const snapshots = await queued();
    expect(snapshots).toHaveLength(1);
    const snapshot = await readFile(join(queue(), snapshots[0] as string), "utf8");
    expect(snapshot).not.toContain("DROP_");
    expect(
      JSON.parse(snapshot)
        .conversation.messages.slice(-2)
        .map((m: { text: string }) => m.text),
    ).toEqual(["web_search", "image_generation"]);
    await runCapture(["codex"], options);
    expect(await queued()).toEqual([]);
    const result = await storedConversation("codex");
    expect(
      result.messages.slice(-2).map((message) => ({ role: message.role, text: message.text })),
    ).toEqual([
      { role: "tool", text: "web_search" },
      { role: "tool", text: "image_generation" },
    ]);
    expect(result.messages).toHaveLength(6);
    expect(JSON.stringify([...transport.resources])).not.toContain("DROP_");
  });

  it("reads hook stdin bytes and reuses the private MCP-12 JSON config", async () => {
    const dir = join(home, ".config/solid-mcp");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), JSON.stringify(config), { mode: 0o600 });
    const stdin = (async function* () {
      const bytes = new TextEncoder().encode(JSON.stringify({ transcript_path: transcript, cwd }));
      yield bytes.subarray(0, 12);
      yield bytes.subarray(12);
    })();
    await runCapture(["claude"], { ...options, env: {}, stdin });
    expect(transport.resources.size).toBeGreaterThan(0);
  });

  it("defaults to process stdin and environment overrides", async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv("SOLID_MCP_OIDC_ISSUER", undefined);
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(() =>
      input({ transcript_path: transcript }),
    );
    await runCapture(["claude"], { ...options, env: undefined });
    expect(transport.resources.size).toBeGreaterThan(0);
  });

  it("scans nested Codex rollouts and applies an exclusive message timestamp filter", async () => {
    await rollout(await fixture("codex"));
    await rollout("ignored", "other.txt");
    await symlink(transcript, join(home, ".codex/sessions/rollout-symlink.jsonl"));
    await runCapture(["codex", "--since", "2026-10-25T12:00:01.000Z"], options);
    const messages = [...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url));
    expect(messages).toHaveLength(2);
    expect(JSON.stringify([...transport.resources])).not.toMatch(/DROP_/);
    await runCapture(["codex", "--since", "2026-10-25T12:00:04.000Z"], options);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toEqual(
      messages,
    );
  });

  it("handles Codex notify JSON without capturing its echoed messages or other threads", async () => {
    await rollout(await fixture("codex"));
    await rollout(
      (await fixture("codex")).replaceAll("codex-fixture-session", "another-thread"),
      "rollout-other.jsonl",
    );
    const notify = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "codex-fixture-session",
      cwd,
      "last-assistant-message": "DROP_NOTIFY",
      "input-messages": ["DROP_NOTIFY"],
    });
    await runCapture(["codex", notify], options);
    expect(JSON.stringify([...transport.resources])).not.toMatch(
      /another-thread|DROP_NOTIFY|DROP_/,
    );
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      4,
    );
  });

  it.each([
    "none",
    "initial",
    "replay",
  ])("captures Codex fork notifications and checks inherited project opt-outs: %s", async (optOut) => {
    const parentProject = join(home, "parent-project");
    await mkdir(parentProject);
    const inherited = (await fixture("codex"))
      .replaceAll("codex-fixture-session", "parent-session")
      .replaceAll("/fixture-project", parentProject);
    await rollout(
      `${JSON.stringify({
        type: "session_meta",
        payload: { id: "codex-fixture-session", forked_from_id: "parent-session", cwd },
      })}\n${inherited}\n${JSON.stringify({
        type: "response_item",
        timestamp: "2026-10-25T12:00:05.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Fork answer" }],
        },
      })}`,
    );
    const args = [
      "codex",
      JSON.stringify({ type: "agent-turn-complete", "thread-id": "codex-fixture-session", cwd }),
    ];
    const marker = join(parentProject, ".solid-capture-ignore");
    if (optOut === "initial") await writeFile(marker, "");
    await runCapture(args, {
      ...options,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    expect(await queued()).toHaveLength(optOut === "initial" ? 0 : 1);
    if (optOut === "replay") await writeFile(marker, "");
    await runCapture(args, options);
    expect(await queued()).toEqual([]);
    if (optOut === "none") {
      const result = await storedConversation("codex");
      expect(result.conversationId).toBe(digest(["codex", "codex-fixture-session"]));
      expect(result.messages.map((message) => message.text)).toEqual([
        "Inspect this project. [REDACTED TOKEN]",
        "exec_command",
        "apply_patch",
        "The project looks good.",
        "Fork answer",
      ]);
      const before = new Map(transport.resources);
      transport.requests.length = 0;
      await runCapture(args, options);
      expect(transport.requests).toEqual([]);
      expect(transport.resources).toEqual(before);
    } else {
      expect(transport.requests).toEqual([]);
      expect(transport.resources.size).toBe(0);
    }
  });

  it("skips completed Codex scans and uploads only newly eligible or appended messages", async () => {
    const path = await rollout(await fixture("codex"));
    await runCapture(["codex", "--since", "2026-10-25T12:00:01.000Z"], options);
    const uploaded = [...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url));
    expect(uploaded).toHaveLength(2);
    transport.requests.length = 0;
    await runCapture(["codex", "--since", "2026-10-25T12:00:01.000Z"], options);
    expect(transport.requests).toEqual([]);
    await runCapture(["codex"], options);
    expect(
      transport.requests.filter((request) => uploaded.some((url) => request.url.startsWith(url))),
    ).toEqual([]);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      4,
    );
    transport.requests.length = 0;
    await writeFile(
      path,
      `${await readFile(path, "utf8")}\n${JSON.stringify({
        type: "response_item",
        timestamp: "2026-10-25T12:00:05Z",
        payload: {
          type: "message",
          id: "appended",
          role: "assistant",
          content: [{ type: "output_text", text: "New answer" }],
        },
      })}`,
    );
    await runCapture(["codex"], options);
    expect(
      transport.requests.filter(
        (request) => request.method === "PUT" && /\/m-.*\.ttl$/.test(request.url),
      ),
    ).toHaveLength(1);
    transport.requests.length = 0;
    await runCapture(["codex"], options);
    expect(transport.requests).toEqual([]);
    expect(await queued()).toEqual([]);
  });

  it("advances to later Codex rollouts across deadlines without revisiting completed ones", async () => {
    const text = await fixture("codex");
    const ids = ["scan-1", "scan-2", "scan-3"];
    for (const id of ids) {
      await rollout(text.replaceAll("codex-fixture-session", id), `rollout-${id}.jsonl`);
    }
    vi.useFakeTimers();
    for (let index = 0; index < ids.length; index++) {
      let stalled: (() => void) | undefined;
      const requestStalled = new Promise<void>((resolve) => {
        stalled = resolve;
      });
      const current = digest(["codex", ids[index]]);
      const limitedTransport: NonNullable<CaptureOptions["fetch"]> = async (input, init) => {
        const request = new Request(input, init);
        const conversation = /\/codex\/([a-f0-9]{64})\//.exec(request.url)?.[1];
        if (conversation !== undefined && conversation !== current) {
          stalled?.();
          return new Promise((_resolve, reject) =>
            request.signal.addEventListener("abort", () => reject(new Error("deadline")), {
              once: true,
            }),
          );
        }
        return transport.fetch(request);
      };
      const running = runCapture(["codex"], {
        ...options,
        fetch: limitedTransport,
        budgetMs: 100,
      });
      if (index < ids.length - 1) {
        await requestStalled;
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(await running).toBe(0);
      expect(
        [...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url)),
      ).toHaveLength((index + 1) * 4);
    }
    expect(await queued()).toEqual([]);
    transport.requests.length = 0;
    await runCapture(["codex"], options);
    expect(transport.requests).toEqual([]);
  });

  it.each([
    "podRoot",
    "webId",
  ] as const)("keeps completion checkpoints scoped to %s", async (field) => {
    await rollout(await fixture("codex"));
    await runCapture(["codex"], options);
    transport.requests.length = 0;
    await runCapture(["codex"], {
      ...options,
      env: {
        ...env,
        [field === "podRoot" ? "SOLID_MCP_POD_ROOT" : "SOLID_MCP_WEBID"]:
          field === "podRoot"
            ? "https://pod.example/bob/"
            : "https://pod.example/bob/profile/card#me",
      },
    });
    expect(
      transport.requests.filter(
        (request) => request.method === "PUT" && /\/m-.*\.ttl$/.test(request.url),
      ),
    ).toHaveLength(4);
  });

  it.each([
    "\n",
    "\r\n",
  ])("queues redacted continuations with %j and recovers without a transcript", async (newline) => {
    await writeFile(
      transcript,
      (await readFile(transcript, "utf8")).replace(
        "Please inspect the project. [REDACTED TOKEN]",
        JSON.stringify(
          `API_TOKEN="FAKE_QUEUE_SECRET\\${newline}FAKE_CONTINUATION\\${newline}FAKE_LAST`,
        ).slice(1, -1),
      ),
    );
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () => {
        throw new Error("FAKE_SECRET_IN_ERROR");
      },
    });
    const files = await queued();
    expect(files).toHaveLength(1);
    const stored = await readFile(join(queue(), files[0] as string), "utf8");
    expect(stored).not.toMatch(
      /FAKE_QUEUE_SECRET|FAKE_CONTINUATION|FAKE_LAST|fixture-secret|DROP_/,
    );
    expect(stored).toContain("[REDACTED ENV]");
    // Re-running offline does not duplicate the local snapshot.
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () => {
        throw new Error();
      },
    });
    expect(await queued()).toHaveLength(1);
    await runCapture(["codex"], options);
    expect(await queued()).toEqual([]);
    expect(transport.resources.size).toBeGreaterThan(0);
    expect(JSON.stringify([...transport.resources])).not.toMatch(
      /FAKE_QUEUE_SECRET|FAKE_CONTINUATION|FAKE_LAST/,
    );
  });

  it("keeps partial uploads queued and resumes with create-only messages", async () => {
    let messages = 0;
    const failing: NonNullable<CaptureOptions["fetch"]> = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "PUT" && /\/m-.*\.ttl$/.test(request.url) && ++messages > 1)
        return new Response(null, { status: 503 });
      return transport.fetch(request);
    };
    await runCapture(["claude", "--transcript", transcript], { ...options, fetch: failing });
    expect(await queued()).toHaveLength(1);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      1,
    );
    const completed = [...transport.resources.keys()].find((url) =>
      /\/m-.*\.ttl$/.test(url),
    ) as string;
    transport.requests.length = 0;
    await runCapture(["claude", "--transcript", transcript], options);
    expect(transport.requests.filter((request) => request.url.startsWith(completed))).toEqual([]);
    expect(await queued()).toEqual([]);
    expect([...transport.resources.keys()].filter((url) => /\/m-.*\.ttl$/.test(url))).toHaveLength(
      4,
    );
  });

  it("replays queued work before rollout discovery can fail or exhaust the hook budget", async () => {
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await mkdir(join(home, ".codex"));
    await writeFile(join(home, ".codex/sessions"), "not a directory");
    await runCapture(["codex"], options);
    expect(await queued()).toEqual([]);
    expect(transport.resources.size).toBeGreaterThan(0);
  });

  it("queues the current Claude transcript before a stalled backlog login consumes the budget", async () => {
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () => {
        throw new Error("offline");
      },
    });
    await writeFile(
      transcript,
      `${await readFile(transcript, "utf8")}\n${JSON.stringify({
        type: "assistant",
        sessionId: "claude-fixture-session",
        uuid: "new-message",
        timestamp: "2026-10-25T12:00:05Z",
        message: { role: "assistant", content: "Before compaction" },
      })}`,
    );
    vi.useFakeTimers();
    let started: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const running = runCapture(["claude", "--transcript", transcript], {
      ...options,
      budgetMs: 100,
      fetch: async () => {
        started?.();
        return new Promise<Response>(() => {});
      },
    });
    await requestStarted;
    await vi.advanceTimersByTimeAsync(100);
    expect(await running).toBe(0);
    expect(await queued()).toHaveLength(2);
  });

  it.each([
    "podRoot",
    "webId",
  ] as const)("never replays a different account's queue (%s)", async (field) => {
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () => {
        throw new Error();
      },
    });
    await runCapture(["codex"], {
      ...options,
      env: {
        ...env,
        [field === "podRoot" ? "SOLID_MCP_POD_ROOT" : "SOLID_MCP_WEBID"]:
          field === "podRoot"
            ? "https://pod.example/bob/"
            : "https://pod.example/bob/profile/card#me",
      },
    });
    expect(await queued()).toHaveLength(1);
    expect(transport.resources.size).toBe(0);
  });

  it("rechecks opt-out on offline snapshots before replay and discards opted-out ones", async () => {
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () => {
        throw new Error();
      },
    });
    await writeFile(join(cwd, ".solid-capture-ignore"), "");
    await runCapture(["codex"], { ...options, cwd: home });
    expect(await queued()).toEqual([]);
    expect(transport.resources.size).toBe(0);
  });

  it.each([
    "invocation",
    "transcript",
    "hook",
    "notify",
    "ancestor",
  ])("respects %s project opt-out without uploading or queueing", async (where) => {
    const ignored = join(home, "ignored");
    await mkdir(ignored);
    await writeFile(join(ignored, ".solid-capture-ignore"), "");
    let args = ["claude", "--transcript", transcript];
    let opts = options;
    if (where === "invocation") opts = { ...options, cwd: ignored };
    if (where === "transcript")
      await writeFile(transcript, (await readFile(transcript, "utf8")).replaceAll(cwd, ignored));
    if (where === "hook") {
      args = ["claude"];
      opts = { ...options, stdin: input({ transcript_path: transcript, cwd: ignored }) };
    }
    if (where === "notify")
      args = [
        "codex",
        JSON.stringify({ type: "agent-turn-complete", "thread-id": "fixture", cwd: ignored }),
      ];
    if (where === "ancestor") {
      const nested = join(ignored, "nested");
      await mkdir(nested);
      opts = { ...options, cwd: nested };
    }
    expect(await runCapture(args, opts)).toBe(0);
    expect(transport.requests).toEqual([]);
    expect(await readdir(queue()).catch(() => [])).toEqual([]);
  });

  describe.each(["claude", "codex"] as const)("%s transcript project metadata", (command) => {
    it.each([
      { project: undefined },
      { project: null },
      { project: 42 },
      { project: {} },
      { project: [] },
      { project: "" },
      { project: "relative-project" },
    ])("fails closed for cwd $project even with valid invocation and hook directories", async ({
      project,
    }) => {
      const text = (await fixture(command))
        .trim()
        .split("\n")
        .map((line) => {
          const row = JSON.parse(line);
          const metadata = command === "claude" ? row : row.payload;
          if (Object.hasOwn(metadata, "cwd")) metadata.cwd = project;
          return JSON.stringify(row);
        })
        .join("\n");
      let args = ["claude"];
      if (command === "claude") await writeFile(transcript, text);
      else {
        await rollout(text);
        args = [
          "codex",
          JSON.stringify({
            type: "agent-turn-complete",
            "thread-id": "codex-fixture-session",
            cwd: home,
          }),
        ];
      }
      expect(
        await runCapture(args, {
          ...options,
          stdin: input({ transcript_path: transcript, cwd: home }),
        }),
      ).toBe(0);
      expect(transport.requests).toHaveLength(0);
      expect(await readdir(queue())).toEqual([]);
    });
  });

  it.each([
    [],
    ["bad"],
    ["claude", "--bad"],
    ["claude", "--transcript"],
    ["codex", "--since"],
    ["codex", "--since", "yesterday"],
    ["codex", "--since", "2026-99-99T00:00:00Z"],
    ["codex", "{}"],
    ["codex", '{"type":"agent-turn-complete"}'],
    ["codex", '{"type":"wrong","thread-id":"fixture"}'],
  ])("always succeeds for malformed arguments: %j", async (...args) => {
    expect(await runCapture(args, options)).toBe(0);
    expect(transport.requests).toEqual([]);
  });

  it.each([
    "{}",
    "not-json",
    "x".repeat(65537),
  ])("ignores malformed/oversized hook stdin %#", async (value) => {
    const stdin = (async function* () {
      yield value;
    })();
    expect(await runCapture(["claude"], { ...options, stdin })).toBe(0);
    expect(transport.requests).toEqual([]);
  });

  it.each([
    { SOLID_MCP_READONLY: "true" },
    { SOLID_MCP_WEBID: undefined },
    {
      SOLID_MCP_CLIENT_ID: undefined,
      SOLID_MCP_CLIENT_SECRET: undefined,
      SOLID_MCP_TOKEN_URL: undefined,
    },
    { SOLID_MCP_WEBID: "not-a-webid" },
    { SOLID_MCP_CLIENT_SECRET: undefined },
  ])("fails closed for disabled/incomplete config %#", async (overrides) => {
    expect(
      await runCapture(["claude", "--transcript", transcript], {
        ...options,
        env: { ...env, ...overrides },
      }),
    ).toBe(0);
    expect(transport.requests).toEqual([]);
  });

  it("refuses insecure MCP-12 config even with environment overrides", async () => {
    const dir = join(home, ".config/solid-mcp");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "config.json"), JSON.stringify(config), { mode: 0o644 });
    await runCapture(["claude", "--transcript", transcript], options);
    expect(transport.requests).toEqual([]);
  });

  it("handles missing/empty/unsafe rollouts and directory errors silently", async () => {
    await rollout("null\nmalformed\n");
    await runCapture(["claude", "--transcript", "missing.jsonl"], options);
    await runCapture(["codex"], options);
    expect(transport.resources.size).toBe(0);
    await rm(join(home, ".codex/sessions"), { recursive: true });
    await writeFile(join(home, ".codex/sessions"), "not a directory");
    expect(await runCapture(["codex"], options)).toBe(0);
  });

  it("uses defaults without touching the network for an unknown command", async () => {
    expect(await runCapture([])).toBe(0);
  });

  it("aborts a stalled token request within the budget and leaves redacted work queued", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let started: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hangingTransport: NonNullable<CaptureOptions["fetch"]> = async (_input, init) => {
      signal = init?.signal as AbortSignal;
      started?.();
      return new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    };
    const running = runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: hangingTransport,
      budgetMs: 100,
    });
    await requestStarted;
    await vi.advanceTimersByTimeAsync(100);
    expect(await running).toBe(0);
    expect(signal?.aborted).toBe(true);
    expect(await queued()).toHaveLength(1);
  });

  it("bounds an indefinitely open hook stdin and ignores a transport that resolves after timeout", async () => {
    const hanging = {
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<string>>(() => {}) }),
    };
    expect(await runCapture(["claude"], { ...options, stdin: hanging, budgetMs: 10 })).toBe(0);
    vi.useFakeTimers();
    let release: ((response: Response) => void) | undefined;
    let started: (() => void) | undefined;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const running = runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
          started?.();
        }),
      budgetMs: 100,
    });
    await requestStarted;
    await vi.advanceTimersByTimeAsync(100);
    expect(await running).toBe(0);
    vi.useRealTimers();
    release?.(
      Response.json({ access_token: "fixture-token", token_type: "DPoP", expires_in: 3600 }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(transport.resources.size).toBe(0);
    expect(await queued()).toHaveLength(1);
  });

  it.each([
    "https://pod.example/alice/",
    "http://127.0.0.1:3000/alice/",
  ])("uses the guarded Node transport when not injected (%s)", async (podRoot) => {
    vi.mocked(createNodeGuardedFetch).mockReturnValueOnce(transport.fetch);
    await runCapture(["claude", "--transcript", transcript], {
      ...options,
      fetch: undefined,
      env: { ...env, SOLID_MCP_POD_ROOT: podRoot },
    });
    expect(createNodeGuardedFetch).toHaveBeenLastCalledWith({
      allowLoopback: podRoot.startsWith("http:"),
    });
    expect(transport.resources.size).toBeGreaterThan(0);
  });
  it("uploads through the production DNS-pinned transport to a loopback fixture pod", async () => {
    const resources = new Map<string, string>();
    const writes: { path: string; authorization?: string; dpop?: string; condition?: string }[] =
      [];
    const server = createServer(async (request, response) => {
      try {
        let body = "";
        for await (const chunk of request) body += chunk.toString();
        const path = request.url as string;
        if (path === "/token") {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              access_token: "fixture-http-token",
              token_type: "DPoP",
              expires_in: 3600,
            }),
          );
        } else if (request.method === "HEAD") {
          response.setHeader("link", `<${path}.acl>; rel="acl"`);
          response.writeHead(resources.has(path) ? 200 : 404);
          response.end();
        } else if (request.method === "PUT") {
          writes.push({
            path,
            authorization: request.headers.authorization,
            dpop: request.headers.dpop as string,
            condition: request.headers["if-none-match"] as string,
          });
          if (request.headers["if-none-match"] === "*" && resources.has(path))
            response.writeHead(412);
          else {
            resources.set(path, body);
            response.writeHead(201);
          }
          response.end();
        } else {
          response.setHeader("content-type", "text/turtle");
          response.writeHead(resources.has(path) ? 200 : 404);
          response.end(resources.get(path));
        }
      } catch {
        response.destroy();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      expect(
        await runCapture(["claude", "--transcript", transcript], {
          ...options,
          fetch: undefined,
          env: {
            ...env,
            SOLID_MCP_POD_ROOT: `${origin}/pod/`,
            SOLID_MCP_WEBID: `${origin}/pod/profile/card#me`,
            SOLID_MCP_TOKEN_URL: `${origin}/token`,
          },
        }),
      ).toBe(0);
      expect(writes[0]?.path).toBe("/pod/private/chats/.acl");
      expect(
        writes.every(
          (r) => r.authorization === "DPoP fixture-http-token" && r.dpop?.split(".").length === 3,
        ),
      ).toBe(true);
      expect(writes.filter((r) => /\/m-.*\.ttl$/.test(r.path))).toHaveLength(4);
      expect(
        writes.filter((r) => /\/m-.*\.ttl$/.test(r.path)).every((r) => r.condition === "*"),
      ).toBe(true);
      expect(await queued()).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
