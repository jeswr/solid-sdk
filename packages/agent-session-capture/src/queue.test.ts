// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import * as fs from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BYTES, queueDirectory } from "./io.js";
import { digest, parseClaudeTranscript } from "./parsers.js";
import { enqueue, type QueueEntry, replay } from "./queue.js";

let home: string;
let directory: string;
let entry: QueueEntry;
const target = { podRoot: "https://pod.example/", webId: "https://pod.example/profile/card#me" };
const stamp = "2026-10-25T12:00:00Z";
const signal = () => new AbortController().signal;
const files = async () => (await fs.readdir(directory)).filter((name) => name.endsWith(".json"));
const progress = () =>
  join(
    directory,
    `.progress-${digest([target, entry.conversation.provider, entry.conversation.conversationId])}`,
  );
async function store(value: unknown, mode = 0o600) {
  const path = join(directory, `${digest(value)}.json`);
  await fs.writeFile(path, JSON.stringify(value), { mode });
  return path;
}
beforeEach(async () => {
  home = await fs.mkdtemp(join(tmpdir(), "capture-queue-"));
  directory = await queueDirectory(home);
  entry = {
    version: 1,
    target,
    ...parseClaudeTranscript(
      JSON.stringify({
        type: "user",
        sessionId: "session",
        uuid: "message",
        timestamp: stamp,
        message: { role: "user", content: "Safe" },
      }),
    ),
  };
  entry.projectDirectories = [home];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(home, { recursive: true, force: true });
});

describe("offline queue", () => {
  it("uses atomic private, deterministic snapshots, re-redacts replay data and removes only complete saves", async () => {
    entry.conversation.title = "sk-fixture-title";
    (entry.conversation.messages[0] as { text: string }).text = "sk-fixture-body";
    await enqueue(directory, entry, signal());
    await enqueue(directory, entry, signal());
    expect(await files()).toEqual([`${digest(entry)}.json`]);
    expect((await fs.stat(join(directory, (await files())[0] as string))).mode & 0o7777).toBe(
      0o600,
    );
    const save = vi.fn().mockResolvedValue({});
    await replay(directory, target, save, signal());
    expect(save).toHaveBeenCalledWith({
      ...entry.conversation,
      title: "[REDACTED TOKEN]",
      messages: [{ ...entry.conversation.messages[0], text: "[REDACTED TOKEN]" }],
    });
    expect(await files()).toEqual([]);
    expect((await fs.stat(progress())).mode & 0o7777).toBe(0o600);
    expect(await fs.readFile(progress(), "utf8")).not.toMatch(/sk-fixture|REDACTED/);
  });

  it("retains failed or aborted uploads and cleans failed writes", async () => {
    await enqueue(directory, entry, signal());
    await replay(
      directory,
      target,
      async () => {
        throw new Error();
      },
      signal(),
    );
    expect(await files()).toHaveLength(1);
    const controller = new AbortController();
    await replay(
      directory,
      target,
      async () => {
        controller.abort();
      },
      controller.signal,
    );
    expect(await files()).toHaveLength(1);
    await expect(replay(directory, target, vi.fn(), AbortSignal.abort())).rejects.toThrow();
    await expect(enqueue(directory, entry, AbortSignal.abort())).rejects.toThrow();
    await expect(enqueue(join(directory, "missing"), entry, signal())).rejects.toThrow();
    expect((await fs.readdir(directory)).every((name) => name.endsWith(".json"))).toBe(true);
  });

  it.each([
    "failure",
    "deadline",
  ])("resumes acknowledged messages after %s, including overlapping and completed snapshots", async (reason) => {
    entry.conversation.messages.push(
      { id: "b".repeat(64), role: "assistant", text: "Answer", createdAt: stamp },
      { id: "c".repeat(64), role: "tool", text: "Read", createdAt: stamp },
    );
    await enqueue(directory, entry, signal());
    const controller = new AbortController();
    const first = vi.fn(async () => {
      if (first.mock.calls.length === 2) {
        if (reason === "deadline") controller.abort();
        throw new Error("interrupted");
      }
    });
    await replay(directory, target, first, controller.signal);
    expect(first).toHaveBeenCalledTimes(2);
    expect(await files()).toHaveLength(1);
    expect(JSON.parse(await fs.readFile(progress(), "utf8")).messageIds).toEqual([
      entry.conversation.messages[0]?.id,
    ]);
    // Requeueing and overlapping snapshots cannot reset acknowledged progress.
    await enqueue(directory, entry, signal());
    const next = vi.fn().mockResolvedValue({});
    await replay(directory, target, next, signal());
    expect(next.mock.calls.map(([chat]) => chat.messages[0].id)).toEqual([
      "b".repeat(64),
      "c".repeat(64),
    ]);
    expect(await files()).toEqual([]);
    expect(await enqueue(directory, entry, signal())).toBeUndefined();
    // A stale pending snapshot is also safe after a crash before deletion.
    await store(entry);
    await replay(directory, target, next, signal());
    expect(next).toHaveBeenCalledTimes(2);
    expect(await files()).toEqual([]);
    entry.conversation.messages.push({
      id: "d".repeat(64),
      role: "assistant",
      text: "Appended",
      createdAt: stamp,
    });
    await enqueue(directory, entry, signal());
    await replay(directory, target, next, signal());
    expect(next).toHaveBeenLastCalledWith({
      ...entry.conversation,
      messages: [entry.conversation.messages[3]],
    });
    expect(next).toHaveBeenCalledTimes(3);
  });

  it.each([
    null,
    { version: 2 },
    { key: "another-account" },
    { messageIds: null },
    { messageIds: [5] },
    { messageIds: ["unsafe/path"] },
  ])("fails closed on malformed acknowledgement data %#", async (override) => {
    await enqueue(directory, entry, signal());
    await replay(directory, target, vi.fn().mockResolvedValue({}), signal());
    const original = JSON.parse(await fs.readFile(progress(), "utf8"));
    await fs.writeFile(
      progress(),
      JSON.stringify(override === null ? null : { ...original, ...override }),
    );
    await store(entry);
    await expect(enqueue(directory, entry, signal())).rejects.toThrow("Invalid capture progress");
    const save = vi.fn();
    await replay(directory, target, save, signal());
    expect(save).not.toHaveBeenCalled();
    expect(await files()).toHaveLength(1);
  });

  it.each(["symlink", "permissions", "json"])("refuses unsafe %s progress files", async (kind) => {
    await enqueue(directory, entry, signal());
    await replay(directory, target, vi.fn().mockResolvedValue({}), signal());
    const original = await fs.readFile(progress(), "utf8");
    await fs.rm(progress());
    if (kind === "symlink") {
      const external = join(home, "external-progress");
      await fs.writeFile(external, original, { mode: 0o600 });
      await fs.symlink(external, progress());
    } else {
      await fs.writeFile(progress(), kind === "json" ? "not-json" : original, { mode: 0o644 });
      if (kind === "json") await fs.chmod(progress(), 0o600);
    }
    await store(entry);
    await expect(enqueue(directory, entry, signal())).rejects.toThrow();
    const save = vi.fn();
    await replay(directory, target, save, signal());
    expect(save).not.toHaveBeenCalled();
    expect(await files()).toHaveLength(1);
  });

  it("rejects oversize snapshots before writing", async () => {
    entry.conversation.title = "x".repeat(MAX_BYTES);
    await expect(enqueue(directory, entry, signal())).rejects.toThrow("exceeds");
    expect(await files()).toEqual([]);
  });

  it("does not follow symlinks, read permissive files or consume partial/forged/foreign entries", async () => {
    const path = await store(entry, 0o644);
    const save = vi.fn();
    await replay(directory, target, save, signal());
    await fs.rm(path);
    const external = join(home, "external.json");
    await fs.writeFile(external, JSON.stringify(entry), { mode: 0o600 });
    await fs.symlink(external, path);
    await replay(directory, target, save, signal());
    await fs.rm(path);
    await fs.writeFile(path, "not-json", { mode: 0o600 });
    await replay(directory, target, save, signal());
    await fs.writeFile(path, JSON.stringify({ ...entry, version: 2 }), { mode: 0o600 });
    await replay(directory, target, save, signal());
    await store({ ...entry, version: 2 });
    await store(null);
    await store({ ...entry, target: { ...target, webId: "different" } });
    await fs.writeFile(join(directory, ".tmp-partial"), "partial");
    await replay(directory, target, save, signal());
    expect(save).not.toHaveBeenCalled();
    expect(await fs.readFile(external, "utf8")).toBe(JSON.stringify(entry));
  });

  it.each([
    undefined,
    [],
    [7],
    ["relative"],
    ["/sk-fixture-secret"],
    ["/missing-fixture-directory"],
  ])("fails closed on invalid/missing project locations %#", async (projectDirectories) => {
    await store({ ...entry, projectDirectories });
    const save = vi.fn();
    await replay(directory, target, save, signal());
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { provider: "chatgpt" },
    { conversationId: 7 },
    { conversationId: "unsafe/path" },
    { title: null },
    { messages: null },
    { messages: [null] },
    { messages: [{ id: 3 }] },
    { messages: [{ id: "unsafe/path" }] },
    { messages: [{ id: "a".repeat(64), role: "system" }] },
    { messages: [{ id: "a".repeat(64), role: "assistant", text: 7 }] },
    { messages: [{ id: "a".repeat(64), role: "tool", text: "Read", createdAt: 7 }] },
  ])("retains malformed conversation/message shapes without saving %#", async (override) => {
    await store({
      ...entry,
      conversation: override === null ? null : { ...entry.conversation, ...override },
    });
    const save = vi.fn();
    await replay(directory, target, save, signal());
    expect(save).not.toHaveBeenCalled();
    expect(await files()).toHaveLength(1);
  });

  it("handles both providers/all captured roles and does not starve valid entries after failures", async () => {
    await store({ ...entry, conversation: null });
    entry.conversation.provider = "codex";
    entry.conversation.messages.push(
      { id: "b".repeat(64), role: "assistant", text: "Answer", createdAt: stamp },
      { id: "c".repeat(64), role: "tool", text: "Read", createdAt: stamp },
    );
    await store(entry);
    const save = vi.fn().mockResolvedValue({});
    await replay(directory, target, save, signal());
    expect(save).toHaveBeenCalledTimes(3);
    expect(await files()).toHaveLength(1);
  });

  it("replays just a newly queued snapshot without retrying unrelated failures", async () => {
    await store({ ...entry, conversation: null });
    const name = await enqueue(directory, entry, signal());
    const save = vi.fn().mockResolvedValue({});
    await replay(directory, target, save, signal(), name);
    expect(save).toHaveBeenCalledOnce();
    expect(await files()).toHaveLength(1);
  });

  it("does not let another account's backlog starve this account's pending captures", async () => {
    while (!digest(entry).startsWith("f")) entry.conversation.title += "x";
    await store(entry);
    let stored = 0;
    for (let index = 0; stored < 101; index++) {
      const foreign = { ...entry, target: { ...target, webId: `https://other.example/${index}` } };
      if (!digest(foreign).startsWith("0")) continue;
      await store(foreign);
      stored++;
    }
    const save = vi.fn().mockResolvedValue({});
    await replay(directory, target, save, signal());
    expect(save).toHaveBeenCalledOnce();
    expect(await files()).toHaveLength(101);
  });
});
