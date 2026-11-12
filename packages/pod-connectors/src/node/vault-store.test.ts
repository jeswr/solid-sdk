// AUTHORED-BY Codex GPT-6.1-Sol

import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorTokenVault,
  generateBrowserVaultKey,
  MAX_VAULT_RECORDS,
  vaultId,
} from "../vault.js";
import { FileVaultStore } from "./vault-store.js";

vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
}));
vi.mock("node:fs", async (original) => ({ ...(await original<typeof import("node:fs")>()) }));
vi.mock("node:process", async (original) => ({
  ...(await original<typeof import("node:process")>()),
  get platform() {
    return process.platform;
  },
}));
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((path) => fs.rm(path, { recursive: true, force: true })));
});
const key = { connectorId: "spotify", account: "synthetic" };
const id = vaultId(key);
const name = createHash("sha256").update(id).digest("hex");
const sensitive = "sensitive-token-key-never-echo";
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "connector-vault-")));
  dirs.push(root);
  const directory = join(root, "nested", "vault");
  const store = new FileVaultStore(directory);
  return { root, directory, store, path: join(directory, name) };
}
async function fails(operation: Promise<unknown>) {
  const error = await operation.catch((error) => error);
  expect(error.cause).toBeUndefined();
  expect(error).toMatchObject({
    name: "ConnectorVaultError",
    message: "Connector vault operation failed.",
  });
}
describe("private file vault store", () => {
  it("refuses writable or foreign-owned ancestor directories", async () => {
    const { root, store } = await fixture();
    await store.put(id, "sealed");
    await fs.chmod(root, 0o777);
    await fails(store.get(id));
    await fs.chmod(root, 0o700);
    const original = fs.lstat;
    vi.spyOn(fs, "lstat").mockImplementation(async (path) => {
      const info = await original(path);
      return String(path) === root ? Object.assign(info, { uid: 12345 }) : info;
    });
    await Promise.all(
      [store.get(id), store.put(id, "replacement"), store.delete(id), store.list()].map(fails),
    );
  });
  it("creates private directories/files, fsyncs and atomically replaces complete ciphertext", async () => {
    const { store, directory, path } = await fixture();
    const events: string[] = [];
    const originalOpen = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        events.push(String(args[0]) === directory ? "dir-sync" : "file-sync");
        await sync();
      });
      return handle;
    });
    const originalRename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      events.push("rename");
      return originalRename(...args);
    });
    expect(await store.get(id)).toBeUndefined();
    await store.put(id, "first");
    const before = await fs.stat(path);
    expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
    expect(before.mode & 0o777).toBe(0o600);
    expect(events).toEqual(["file-sync", "rename", "dir-sync"]);
    await store.put(id, "second");
    expect((await fs.stat(path)).ino).not.toBe(before.ino);
    expect(await store.get(id)).toBe("second");
    expect(await store.list()).toEqual([id]);
    expect(await fs.readdir(directory)).toEqual([name]);
    await store.delete(id);
    await store.delete(id);
    expect(await store.list()).toEqual([]);
  });
  it.each([
    0o644, 0o640, 0o604, 0o660,
  ])("refuses exposed files on read/write/delete/list: %s", async (mode) => {
    const { store, path } = await fixture();
    await store.put(id, "sealed");
    await fs.chmod(path, mode);
    await Promise.all(
      [store.get(id), store.put(id, "replacement"), store.delete(id), store.list()].map(fails),
    );
  });
  it.each([
    0o755, 0o750, 0o707, 0o770,
  ])("refuses exposed directories for every operation: %s", async (mode) => {
    const { store, directory } = await fixture();
    await store.put(id, "sealed");
    await fs.chmod(directory, mode);
    await Promise.all(
      [store.get(id), store.put(id, "replacement"), store.delete(id), store.list()].map(fails),
    );
  });
  it("refuses final directory, dangling and record symlinks plus hardlinks", async () => {
    const { root, directory, path, store } = await fixture();
    await store.put(id, "sealed");
    const target = join(root, "target");
    await fs.writeFile(target, sensitive, { mode: 0o600 });
    await fs.unlink(path);
    await fs.symlink(target, path);
    await Promise.all(
      [store.get(id), store.put(id, "other"), store.delete(id), store.list()].map(fails),
    );
    expect(await fs.readFile(target, "utf8")).toBe(sensitive);
    await fs.unlink(path);
    await fs.symlink(join(root, "missing"), path);
    await fails(store.get(id));
    await fs.unlink(path);
    await fs.link(target, path);
    await fails(store.get(id));
    const link = join(root, "alias");
    await fs.symlink(directory, link);
    expect(() => new FileVaultStore(link)).toThrow("Connector vault operation failed.");
    await new FileVaultStore(join(link, "child")).put(id, "sealed");
    expect(() => new FileVaultStore(target)).toThrow("Connector vault operation failed.");
  });
  it("bounds reads and rejects corrupt, misplaced, oversized and non-regular files", async () => {
    const { store, path, directory } = await fixture();
    await store.put(id, "sealed");
    for (const content of [
      sensitive,
      "null",
      "{}",
      JSON.stringify({ id: vaultId({ ...key, account: "other" }), sealed: "x" }),
      JSON.stringify({ id, sealed: 1 }),
      JSON.stringify({ id, sealed: "x".repeat(65537) }),
      "x".repeat(100000),
    ]) {
      await fs.writeFile(path, content);
      await fails(store.get(id));
    }
    await fs.unlink(path);
    await fs.mkdir(path, { mode: 0o700 });
    await fails(store.get(id));
    await fs.rm(path, { recursive: true });
    await fs.writeFile(join(directory, "unexpected"), sensitive, { mode: 0o600 });
    await fails(store.list());
  });
  it("retains the old record and cleans temporary files after failed write, sync or rename", async () => {
    const { store, directory } = await fixture();
    await store.put(id, "old");
    const originalOpen = fs.open;
    for (const stage of ["writeFile", "sync", "rename"] as const) {
      if (stage === "rename") vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error(sensitive));
      else
        vi.spyOn(fs, "open").mockImplementation(async (...args) => {
          const handle = await originalOpen(...args);
          if (String(args[0]).endsWith(".tmp"))
            vi.spyOn(handle, stage).mockRejectedValueOnce(new Error(sensitive));
          return handle;
        });
      await fails(store.put(id, "new"));
      expect(await store.get(id)).toBe("old");
      expect(await fs.readdir(directory)).toEqual([name]);
      vi.restoreAllMocks();
    }
  });
  it("persists only ciphertext across fresh vault instances and refuses overflow", async () => {
    const { store, directory } = await fixture();
    const cryptoKey = await generateBrowserVaultKey();
    await new ConnectorTokenVault(cryptoKey, store).put(key, {
      refreshToken: sensitive,
      obtainedAt: 1,
    });
    expect(await fs.readFile(join(directory, name), "utf8")).not.toContain(sensitive);
    expect(
      (await new ConnectorTokenVault(cryptoKey, new FileVaultStore(directory)).get(key))
        ?.refreshToken,
    ).toBe(sensitive);
    // Bound directory enumeration without materializing an unbounded readdir result.
    for (let index = 0; index < MAX_VAULT_RECORDS; index++)
      await fs.writeFile(join(directory, index.toString(16).padStart(64, "0")), "{}", {
        mode: 0o600,
      });
    await fails(store.list());
    await fails(store.put(vaultId({ ...key, account: "new" }), "sealed"));
  });
  it("pins the real directory through ancestor aliases and rejects win32 at construction", async () => {
    const { root, directory, store } = await fixture();
    await store.put(id, "real");
    const alias = join(root, "alias");
    await fs.symlink(join(root, "nested"), alias);
    const canonical = new FileVaultStore(join(alias, "vault"));
    await fs.unlink(alias);
    expect(await canonical.get(id)).toBe("real");
    expect(await fs.realpath(directory)).toBe(directory);
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      expect(() => new FileVaultStore(directory)).toThrow(
        "FileVaultStore requires a POSIX filesystem",
      );
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });
  it("breaks stale locks, releases on throw, and creates private locks", async () => {
    const { directory, store } = await fixture();
    const lock = join(directory, `${name}.lock`);
    await fs.writeFile(lock, "", { mode: 0o600 });
    const old = new Date(Date.now() - 61000);
    await fs.utimes(lock, old, old);
    await expect(
      store.withLock(id, async () => {
        expect((await fs.stat(lock)).mode & 0o777).toBe(0o600);
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: "ENOENT" });
    // The claimed stale file was the one judged stale, so the takeover deleted it.
    expect(await fs.readdir(directory)).toEqual([]);
    expect(await store.withLock(id, async () => 42)).toBe(42);
    await fs.writeFile(lock, "", { mode: 0o644 });
    await fails(store.withLock(id, async () => {}));
    await fs.unlink(lock);
    await fs.symlink(join(directory, "missing"), lock);
    await fails(store.withLock(id, async () => {}));
  });
  it("restores a live lock claimed by mistake so only one holder exists", async () => {
    const { directory, store } = await fixture();
    const owner = new FileVaultStore(directory);
    const lock = join(directory, `${name}.lock`);
    await fs.writeFile(lock, "", { mode: 0o600 });
    const old = new Date(Date.now() - 61000);
    await fs.utimes(lock, old, old);
    // Keep the judged inode allocated so the owner's lock cannot reuse its number.
    const judgedHandle = await fs.open(lock, "r");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    let holders = 0;
    let maxHolders = 0;
    const hold = async (label: string, wait?: Promise<void>) => {
      maxHolders = Math.max(maxHolders, ++holders);
      events.push(`${label}-entered`);
      if (wait) {
        entered.resolve();
        await wait;
      }
      events.push(`${label}-released`);
      holders--;
      return label;
    };
    let ownerLock: fsSync.Stats | undefined;
    let first: Promise<string> | undefined;
    const originalRename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(".stale") && !first) {
        // Between this waiter's staleness judgement and its rename, the owner claimed and
        // deleted the stale lock, then acquired a fresh one at the same path.
        await fs.unlink(lock);
        first = owner.withLock(id, () => hold("owner", release.promise));
        await entered.promise;
        ownerLock = await fs.lstat(lock);
      }
      return originalRename(from, to);
    });
    const originalLink = fs.link;
    const linked = vi.spyOn(fs, "link").mockImplementation((...args) => originalLink(...args));
    try {
      const second = store.withLock(id, () => hold("waiter"));
      await vi.waitFor(async () => {
        expect(linked).toHaveBeenCalledTimes(1);
        expect((await fs.readdir(directory)).filter((entry) => entry.endsWith(".stale"))).toEqual(
          [],
        );
      });
      // The owner's lock is back under the original name, as the only link to that file.
      const restored = await fs.lstat(lock);
      expect([restored.dev, restored.ino, restored.nlink]).toEqual([
        ownerLock?.dev,
        ownerLock?.ino,
        1,
      ]);
      expect(events).toEqual(["owner-entered"]);
      release.resolve();
      expect(await first).toBe("owner");
      expect(await second).toBe("waiter");
      expect(events).toEqual([
        "owner-entered",
        "owner-released",
        "waiter-entered",
        "waiter-released",
      ]);
      expect(maxHolders).toBe(1);
      // The owner's normal release removed its restored lock; nothing is left behind.
      expect(await fs.readdir(directory)).toEqual([]);
    } finally {
      release.resolve();
      await judgedHandle.close();
    }
  });
  it("leaves a claimed live lock to age out when a third lock already holds the path", async () => {
    const { directory, store } = await fixture();
    const lock = join(directory, `${name}.lock`);
    await fs.writeFile(lock, "", { mode: 0o600 });
    const old = new Date(Date.now() - 61000);
    await fs.utimes(lock, old, old);
    // Keep the judged inode allocated so the replacement cannot reuse its number.
    const judgedHandle = await fs.open(lock, "r");
    const judged = await judgedHandle.stat();
    let replacement: fsSync.Stats | undefined;
    let third: fsSync.Stats | undefined;
    const originalRename = fs.rename;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(".stale") && !replacement) {
        // Another waiter claimed and deleted the stale lock, then acquired a fresh one.
        await fs.unlink(lock);
        await fs.writeFile(lock, "", { mode: 0o600, flag: "wx" });
        replacement = await fs.lstat(lock);
      }
      return originalRename(from, to);
    });
    const originalLink = fs.link;
    vi.spyOn(fs, "link").mockImplementation(async (...args) => {
      if (!third) {
        // A third party acquired the now-empty path before the restore.
        await fs.writeFile(lock, "", { mode: 0o600, flag: "wx" });
        third = await fs.lstat(lock);
      }
      return originalLink(...args);
    });
    try {
      const second = store.withLock(id, async () => "second");
      await vi.waitFor(() => expect(third).toBeDefined());
      const claimed = (await fs.readdir(directory)).filter((entry) => entry.endsWith(".stale"));
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatch(new RegExp(`^${name}\\.lock\\.[0-9a-f-]{36}\\.stale$`));
      const claimedPath = join(directory, claimed[0] as string);
      const kept = await fs.lstat(claimedPath);
      // Neither lock was deleted or overwritten by the failed restore.
      expect([kept.dev, kept.ino, kept.nlink]).toEqual([replacement?.dev, replacement?.ino, 1]);
      expect(kept.ino).not.toBe(judged.ino);
      const current = await fs.lstat(lock);
      expect([current.dev, current.ino]).toEqual([third?.dev, third?.ino]);
      // The third holder releases; the waiter then acquires and releases normally.
      await fs.unlink(lock);
      expect(await second).toBe("second");
      await expect(fs.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await fs.lstat(claimedPath)).ino).toBe(replacement?.ino);
      // A claimed leftover never breaks list/put budgets and ages out like a temp file.
      await store.put(id, "sealed");
      expect(await store.list()).toEqual([id]);
      const aged = new Date(Date.now() - 11 * 60 * 1000);
      await fs.utimes(claimedPath, aged, aged);
      new FileVaultStore(directory);
      expect(await fs.readdir(directory)).toEqual([name]);
    } finally {
      await judgedHandle.close();
    }
  });
  it("keeps the callback outcome when releasing the lock fails", async () => {
    const { directory, store } = await fixture();
    const lock = join(directory, `${name}.lock`);
    const originalUnlink = fs.unlink;
    vi.spyOn(fs, "unlink").mockImplementation(async (path) => {
      if (String(path) === lock) throw Object.assign(new Error(sensitive), { code: "EIO" });
      return originalUnlink(path);
    });
    expect(await store.withLock(id, async () => "value")).toBe("value");
    await originalUnlink(lock);
    const failure = new Error("callback failed");
    await expect(
      store.withLock(id, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    await originalUnlink(lock);
    const vault = new ConnectorTokenVault(await generateBrowserVaultKey(), store);
    expect(await vault.withLock?.(key, async () => "wrapped")).toBe("wrapped");
    await originalUnlink(lock);
  });
  it.each([
    false,
    true,
  ])("removes its own lock when the post-create safety check fails (path replaced: %s)", async (replaced) => {
    const { directory, store } = await fixture();
    const lock = join(directory, `${name}.lock`);
    const originalOpen = fs.open;
    let replacement: fsSync.Stats | undefined;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (String(args[0]) !== lock) return handle;
      const stat = handle.stat.bind(handle);
      vi.spyOn(handle, "stat").mockImplementation(async () => {
        const result = await stat();
        // A hard link appeared between create and check.
        result.nlink = 2;
        if (replaced && !replacement) {
          await fs.unlink(lock);
          await fs.writeFile(lock, "", { mode: 0o600, flag: "wx" });
          replacement = await fs.lstat(lock);
        }
        return result;
      });
      return handle;
    });
    await fails(store.withLock(id, async () => {}));
    if (replaced) {
      const current = await fs.lstat(lock);
      expect([current.dev, current.ino]).toEqual([replacement?.dev, replacement?.ino]);
    } else {
      await expect(fs.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
      vi.restoreAllMocks();
      expect(await store.withLock(id, async () => "next")).toBe("next");
    }
  });
  it("serializes contending child processes using the same file record lock", async () => {
    const { directory, root } = await fixture();
    const script = new URL("./__fixtures__/vault-lock-child.mjs", import.meta.url);
    const one = fork(script, [directory, id, join(root, "exclusive")], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const two = fork(script, [directory, id, join(root, "exclusive")], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const events: string[] = [];
    two.on("message", (message) => events.push(String(message)));
    try {
      const readyOne = once(one, "message");
      const readyTwo = once(two, "message");
      expect((await readyOne)[0]).toBe("ready");
      expect((await readyTwo)[0]).toBe("ready");
      const entered = once(one, "message");
      one.send("start");
      expect((await entered)[0]).toBe("entered");
      const contended = once(two, "message");
      two.send("start");
      expect((await contended)[0]).toBe("contended");
      const secondEntered = once(two, "message");
      // A second in-process contender also waits behind the process holding the lock.
      const store = new FileVaultStore(directory);
      const pending = store.withLock(id, async () => "parent");
      expect(await fs.stat(join(directory, `${name}.lock`))).toMatchObject({ nlink: 1 });
      expect(events).toEqual(["ready", "contended"]);
      const released = once(one, "message");
      one.send("release");
      expect((await released)[0]).toBe("released");
      expect((await secondEntered)[0]).toBe("entered");
      const releasedTwo = once(two, "message");
      two.send("release");
      expect((await releasedTwo)[0]).toBe("released");
      expect(await pending).toBe("parent");
      expect(events).not.toContain("failed");
    } finally {
      one.kill();
      two.kill();
    }
  });
  it("cleans only owned regular stale temp files on construction and before list/put budgets", async () => {
    const { directory } = await fixture();
    const temp = () => join(directory, `${name}.${crypto.randomUUID()}.tmp`);
    const stale = temp();
    const fresh = temp();
    const foreign = temp();
    const foreignOwned = temp();
    const old = new Date(Date.now() - 11 * 60 * 1000);
    for (const path of [stale, foreign, foreignOwned]) {
      await fs.writeFile(path, "", { mode: 0o600 });
      await fs.utimes(path, old, old);
    }
    await fs.writeFile(fresh, "", { mode: 0o600 });
    const other = join(directory, "unrelated.tmp");
    await fs.writeFile(other, "", { mode: 0o600 });
    // A hardlinked temp is never removed by crash recovery.
    await fs.link(foreign, join(directory, "foreign-target"));
    const originalStat = fsSync.lstatSync;
    vi.spyOn(fsSync, "lstatSync").mockImplementation((...args) => {
      const stat = originalStat(...args);
      return String(args[0]) === foreignOwned ? Object.assign(stat, { uid: 12345 }) : stat;
    });
    const store = new FileVaultStore(directory);
    await expect(fs.stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await fs.stat(fresh)).isFile()).toBe(true);
    expect((await fs.stat(foreign)).nlink).toBe(2);
    expect((await fs.stat(foreignOwned)).isFile()).toBe(true);
    expect((await fs.stat(other)).isFile()).toBe(true);
    await fs.unlink(other);
    await fs.unlink(join(directory, "foreign-target"));
    await fs.unlink(foreign);
    // Temp files never consume the record/name budget, even when there are over 2,001.
    for (let index = 0; index < MAX_VAULT_RECORDS * 2 + 2; index++)
      await fs.writeFile(temp(), "", { mode: 0o600 });
    expect(await store.list()).toEqual([]);
    await store.put(id, "sealed");
    await fs.utimes(fresh, old, old);
    await store.put(id, "replacement");
    await expect(fs.stat(fresh)).rejects.toMatchObject({ code: "ENOENT" });
    const later = temp();
    await fs.writeFile(later, "", { mode: 0o600 });
    await fs.utimes(later, old, old);
    expect(await store.list()).toEqual([id]);
    await expect(fs.stat(later)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("never crash-cleans a temp symlink or its target", async () => {
    const { root, directory } = await fixture();
    const target = join(root, "private");
    await fs.writeFile(target, sensitive, { mode: 0o600 });
    const old = new Date(Date.now() - 11 * 60 * 1000);
    await fs.utimes(target, old, old);
    const temporary = join(directory, `${name}.${crypto.randomUUID()}.tmp`);
    await fs.symlink(target, temporary);
    const store = new FileVaultStore(directory);
    expect((await fs.lstat(temporary)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(target, "utf8")).toBe(sensitive);
    await fails(store.list());
  });
});
