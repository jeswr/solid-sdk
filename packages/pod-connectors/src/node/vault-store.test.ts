// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
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
  const root = await fs.mkdtemp(join(tmpdir(), "connector-vault-"));
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
  it("refuses directory, ancestor, dangling and record symlinks plus hardlinks", async () => {
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
    await fails(new FileVaultStore(link).get(id));
    await fails(new FileVaultStore(join(link, "child")).put(id, "sealed"));
    const notDirectory = new FileVaultStore(target);
    await fails(notDirectory.get(id));
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
});
