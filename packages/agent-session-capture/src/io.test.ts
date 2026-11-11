// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { execFileSync } from "child_process";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import * as fs from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isIgnored, MAX_BYTES, queueDirectory, readRegular } from "./io.js";

vi.mock("fs/promises", async (original) => {
  const fs = await original<typeof import("fs/promises")>();
  return { ...fs, open: vi.fn(fs.open), lstat: vi.fn(fs.lstat) };
});
let root: string;
const signal = () => new AbortController().signal;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "capture-io-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("local capture privacy boundaries", () => {
  it("creates private state and queue directories and reads only private regular snapshots", async () => {
    const queue = await queueDirectory(root);
    expect((await fs.stat(queue)).mode & 0o7777).toBe(0o700);
    expect((await fs.stat(join(root, ".local/state/solid-capture"))).mode & 0o7777).toBe(0o700);
    expect(await queueDirectory(root)).toBe(queue);
    const path = join(queue, "snapshot");
    await fs.writeFile(path, "safe", { mode: 0o600 });
    expect(await readRegular(path, signal(), true)).toBe("safe");
    await fs.chmod(path, 0o644);
    await expect(readRegular(path, signal(), true)).rejects.toThrow("Unsafe");
    expect(await readRegular(path, signal())).toBe("safe");
  });

  it("refuses symlinks, directories, FIFOs, oversized files, and already-aborted reads", async () => {
    const file = join(root, "file");
    await fs.writeFile(file, "safe");
    const link = join(root, "link");
    await fs.symlink(file, link);
    await expect(readRegular(link, signal())).rejects.toThrow();
    await expect(readRegular(root, signal())).rejects.toThrow("Unsafe");
    const fifo = join(root, "fifo");
    execFileSync("mkfifo", [fifo]);
    await expect(readRegular(fifo, signal())).rejects.toThrow("Unsafe");
    await fs.truncate(file, MAX_BYTES + 1);
    await expect(readRegular(file, signal())).rejects.toThrow("Unsafe");
    await expect(readRegular(file, AbortSignal.abort())).rejects.toThrow();
  });

  it("closes a file that grows past the bound after stat", async () => {
    const file = join(root, "file");
    await fs.writeFile(file, "safe");
    const handle = await fs.open(file, "r");
    const close = vi.spyOn(handle, "close");
    vi.spyOn(handle, "readFile").mockResolvedValueOnce("x".repeat(MAX_BYTES + 1));
    vi.mocked(fs.open).mockResolvedValueOnce(handle);
    await expect(readRegular(file, signal())).rejects.toThrow("grew");
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    "base",
    "queue",
  ])("rejects shared or symlinked %s directories without changing their mode", async (which) => {
    const queue = await queueDirectory(root);
    const path = which === "base" ? join(root, ".local/state/solid-capture") : queue;
    await fs.chmod(path, 0o755);
    await expect(queueDirectory(root)).rejects.toThrow("private");
    expect((await fs.stat(path)).mode & 0o7777).toBe(0o755);
    await fs.chmod(path, 0o700);
    await fs.rm(path, { recursive: true });
    const external = join(root, "external");
    await fs.mkdir(external, { mode: 0o700 });
    await fs.symlink(external, path);
    await expect(queueDirectory(root)).rejects.toThrow("private");
  });

  it("checks real and lexical project ancestors and treats any marker inode as opt-out", async () => {
    const real = join(root, "real");
    await fs.mkdir(real);
    const nested = join(real, "nested");
    await fs.mkdir(nested);
    const alias = join(root, "alias");
    await fs.symlink(nested, alias);
    expect(await isIgnored([alias], signal())).toBe(false);
    await fs.mkdir(join(real, ".solid-capture-ignore"));
    expect(await isIgnored([alias], signal())).toBe(true);
    await fs.rm(join(real, ".solid-capture-ignore"), { recursive: true });
    await fs.symlink("missing", join(root, ".solid-capture-ignore"));
    expect(await isIgnored([nested], signal())).toBe(true);
  });

  it("fails closed for non-absolute, secret-bearing, absent, or unreadable project metadata", async () => {
    expect(await isIgnored(["relative"], signal())).toBe(true);
    expect(await isIgnored([join(root, "sk-fixture-secret")], signal())).toBe(true);
    await expect(isIgnored([join(root, "missing")], signal())).rejects.toThrow();
    vi.mocked(fs.lstat).mockRejectedValueOnce(
      Object.assign(new Error("I/O failure"), { code: "EIO" }),
    );
    await expect(isIgnored([root], signal())).rejects.toThrow("I/O failure");
    expect(await isIgnored([], signal())).toBe(false);
  });
});
