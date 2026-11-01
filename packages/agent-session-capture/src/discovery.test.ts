// AUTHORED-BY Codex GPT-6.1-Sol

// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRollouts } from "./discovery.js";
import { queueDirectory } from "./io.js";
import { digest } from "./parsers.js";

let home: string;
let root: string;
let directory: string;
const target = { podRoot: "https://pod.example/", webId: "https://pod.example/profile/card#me" };
const signal = () => new AbortController().signal;
const checkpoint = (thread?: string) =>
  join(directory, `.scan-${digest([target, thread ?? null])}`);
const scan = (thread?: string) => discoverRollouts(root, directory, target, signal(), thread);
const collect = async (files: AsyncIterable<string>) => {
  const paths: string[] = [];
  for await (const path of files) paths.push(path);
  return paths;
};
const file = async (name: string) => {
  const path = join(root, name);
  await writeFile(path, "transcript contents are not read during discovery");
  return path;
};

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "capture-discovery-"));
  root = join(home, "sessions");
  await mkdir(root);
  directory = await queueDirectory(home);
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("Codex discovery", () => {
  it("resumes after an interrupted scan and wraps to retry the previous rollout", async () => {
    const c = await file("rollout-c.jsonl");
    const b = await file("rollout-b.jsonl");
    const a = await file("rollout-a.jsonl");
    for await (const path of scan()) {
      expect(path).toBe(a);
      break;
    }
    expect(JSON.parse(await readFile(checkpoint(), "utf8"))).toBe(digest(a));
    expect((await stat(checkpoint())).mode & 0o7777).toBe(0o600);
    expect(await readFile(checkpoint(), "utf8")).not.toContain(home);
    const d = await file("rollout-d.jsonl");
    expect(await collect(scan())).toEqual([b, c, d, a]);
    expect(await collect(scan())).toEqual([b, c, d, a]);
  });

  it("recovers when the checkpoint's rollout disappears", async () => {
    const a = await file("rollout-a.jsonl");
    for await (const _ of scan()) break;
    await rm(a);
    const b = await file("rollout-b.jsonl");
    expect(await collect(scan())).toEqual([b]);
  });

  it("prioritizes notification filenames across nested directories and skips unsafe entries", async () => {
    const a = await file("rollout-a.jsonl");
    const b = await file("rollout-b.jsonl");
    await file("other.txt");
    await symlink(a, join(root, "rollout-symlink.jsonl"));
    const nested = join(root, "nested");
    await mkdir(nested);
    const preferred = join(nested, "rollout-2026-10-25-thread.jsonl");
    await writeFile(preferred, "");
    // Even an existing fallback cursor cannot demote the notified thread.
    await writeFile(checkpoint("thread"), JSON.stringify(digest(a)), { mode: 0o600 });
    expect(await collect(scan("thread"))).toEqual([preferred, b, a]);
    expect(await collect(scan("missing"))).toEqual([preferred, a, b]);
  });

  it.each(["podRoot", "webId"] as const)("scopes traversal progress to %s", async (field) => {
    const a = await file("rollout-a.jsonl");
    const b = await file("rollout-b.jsonl");
    for await (const _ of scan()) break;
    const other = { ...target, [field]: "https://other.example/" };
    expect(await collect(discoverRollouts(root, directory, other, signal()))).toEqual([a, b]);
    expect(await collect(scan())).toEqual([b, a]);
    expect(await collect(scan("unknown-thread"))).toEqual([a, b]);
  });

  it("handles absent session directories but propagates other traversal errors", async () => {
    await rm(root, { recursive: true });
    expect(await collect(scan())).toEqual([]);
    await writeFile(root, "not a directory");
    await expect(collect(scan())).rejects.toThrow();
  });

  it("stops traversal when the budget expires", async () => {
    await file("rollout-a.jsonl");
    await file("rollout-b.jsonl");
    await expect(
      collect(discoverRollouts(root, directory, target, AbortSignal.abort())),
    ).rejects.toThrow();
    const controller = new AbortController();
    const files = discoverRollouts(root, directory, target, controller.signal);
    expect((await files.next()).done).toBe(false);
    controller.abort();
    await expect(files.next()).rejects.toThrow();
  });

  it.each([
    "json",
    "type",
    "digest",
    "permissions",
    "symlink",
  ])("fails closed on unsafe %s checkpoints", async (kind) => {
    await file("rollout-a.jsonl");
    const path = checkpoint();
    if (kind === "symlink") {
      const external = join(home, "external");
      await writeFile(external, JSON.stringify("a".repeat(64)), { mode: 0o600 });
      await symlink(external, path);
    } else {
      const value = kind === "type" ? null : kind === "digest" ? "invalid" : "a".repeat(64);
      await writeFile(path, kind === "json" ? "not-json" : JSON.stringify(value), { mode: 0o600 });
      if (kind === "permissions") await chmod(path, 0o644);
    }
    await expect(collect(scan())).rejects.toThrow();
  });
});
