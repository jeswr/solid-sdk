// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { provisionValue } from "../src/provision.js";
import { CredentialStore, writeFully } from "../src/store.js";

vi.mock("fs", async (original) => {
  const actual = await original<typeof import("fs")>();
  return {
    ...actual,
    ...Object.fromEntries(
      [
        "openSync",
        "closeSync",
        "readFileSync",
        "writeSync",
        "fsyncSync",
        "renameSync",
        "lstatSync",
        "fstatSync",
        "mkdirSync",
        "unlinkSync",
      ].map((name) => [
        name,
        vi.fn(actual[name as keyof typeof actual] as (...args: never[]) => unknown),
      ]),
    ),
  };
});
let base: string;
let dir: string;
let store: CredentialStore;
const client = {
  version: 1 as const,
  provider: "google" as const,
  clientId: "fixture.apps.googleusercontent.com",
  importedFrom: "fixture",
  importedAt: "2026-10-26T00:00:00Z",
};
const errno = (code: string) => Object.assign(new Error("test-io-failure"), { code });
beforeEach(() => {
  base = fs.mkdtempSync(join(tmpdir(), "credentials-faults-"));
  dir = join(base, "store");
  store = new CredentialStore(dir);
  store.putClient(client);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});
it("refuses foreign ownership on both directory and opened file, and unavailable uid", () => {
  const currentUid = (process.getuid as () => number)();
  const spy = vi.spyOn(process, "getuid").mockReturnValue(currentUid + 1);
  expect(() => new CredentialStore(dir)).toThrow(/another user/);
  spy.mockRestore();
  const fd = fs.openSync(join(dir, "clients/google.json"), "r");
  const stat = fs.fstatSync(fd);
  fs.closeSync(fd);
  stat.uid = currentUid + 1;
  vi.mocked(fs.fstatSync).mockReturnValueOnce(stat as ReturnType<typeof fs.fstatSync>);
  expect(() => store.googleClient()).toThrow(/another user/);
  const descriptor = fixtureValue(Object.getOwnPropertyDescriptor(process, "getuid"));
  Object.defineProperty(process, "getuid", { value: undefined, configurable: true });
  try {
    expect(() => new CredentialStore(dir)).toThrow(/ownership cannot/);
  } finally {
    Object.defineProperty(process, "getuid", descriptor);
  }
});
it("refuses symlinked store roots, subdirectories, targets, and locks", async () => {
  const link = join(base, "link");
  fs.symlinkSync(dir, link);
  expect(() => new CredentialStore(link)).toThrow(/symbolic link/);
  const target = join(dir, "clients/google.json");
  fs.unlinkSync(target);
  fs.symlinkSync(join(base, "missing"), target);
  expect(() => store.putClient(client)).toThrow(/symbolic link/);
  fs.symlinkSync(target, join(dir, "locks/fixture.lock"));
  await expect(store.withLock("fixture", async () => 1)).rejects.toThrow(/symbolic link/);
  fs.renameSync(join(dir, "clients"), join(base, "clients"));
  fs.symlinkSync(join(base, "clients"), join(dir, "clients"));
  expect(() => store.googleClient()).toThrow(/symbolic link/);
  const file = join(base, "file");
  fs.writeFileSync(file, "fixture", { mode: 0o600 });
  expect(() => new CredentialStore(file)).toThrow(/not a directory/);
});
it("refuses bad names, missing parents, unexpected filesystem errors and non-file records", async () => {
  expect(() => new CredentialStore("relative")).toThrow(/absolute/);
  expect(() => new CredentialStore(join(base, "missing/child"))).toThrow(/parent directory/);
  vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
    throw errno("EACCES");
  });
  expect(() => new CredentialStore(join(base, "denied"))).toThrow(/test-io/);
  expect(() => store.profile("../escape")).toThrow(/invalid name/);
  await expect(store.withLock("../escape", async () => 1)).rejects.toThrow(/invalid name/);
  const record = join(dir, "clients/google.json");
  fs.unlinkSync(record);
  fs.mkdirSync(record, { mode: 0o700 });
  expect(() => store.googleClient()).toThrow(/not a file/);
  expect(() => store.putClient(client)).toThrow(/not a file/);
  vi.mocked(fs.openSync).mockImplementationOnce(() => {
    throw errno("EACCES");
  });
  expect(() => store.microsoftClient()).toThrow(/cannot be read/);
  vi.mocked(fs.openSync).mockImplementationOnce(() => {
    throw errno("EMLINK");
  });
  expect(() => store.microsoftClient()).toThrow(/symbolic link/);
  vi.mocked(fs.openSync).mockImplementationOnce(() => {
    throw errno("EACCES");
  });
  await expect(store.withLock("denied", async () => 1)).rejects.toThrow(/test-io/);
});
it("keeps the previous record on short/failed writes and failed rename, and removes temporary files", () => {
  const path = join(dir, "clients/google.json");
  const before = fs.readFileSync(path, "utf8");
  vi.mocked(fs.writeSync).mockImplementationOnce(() => 0);
  expect(() => store.putClient({ ...client, importedFrom: "new" })).toThrow(/no progress/);
  expect(fs.readFileSync(path, "utf8")).toBe(before);
  expect(fs.readdirSync(join(dir, "clients"))).toEqual(["google.json"]);
  vi.mocked(fs.renameSync).mockImplementationOnce(() => {
    throw errno("EIO");
  });
  expect(() => store.putClient(client)).toThrow(/test-io/);
  expect(fs.readFileSync(path, "utf8")).toBe(before);
  expect(fs.readdirSync(join(dir, "clients"))).toEqual(["google.json"]);
  const data: number[] = [];
  writeFully(0, new Uint8Array([1, 2, 3]), (_fd, b, o, _len) => {
    data.push(fixtureValue(b[o]));
    return 1;
  });
  expect(data).toEqual([1, 2, 3]);
  // A directory fsync may be unsupported; a successfully renamed record still remains usable.
  const original = fixtureValue(vi.mocked(fs.fsyncSync).getMockImplementation());
  vi.mocked(fs.fsyncSync)
    .mockImplementationOnce(original)
    .mockImplementationOnce(() => {
      throw errno("EINVAL");
    });
  store.putClient({ ...client, importedFrom: "new" });
  expect(store.googleClient()?.importedFrom).toBe("new");
});
it("preserves legacy tokens on migration write failures and retries cleanup safely", async () => {
  const record = {
    version: 1 as const,
    name: "slack-legacy",
    provider: "slack" as const,
    account: "owner",
    purpose: "read" as const,
    token: "test-old-token-0123456789",
    credentialRef: "op://fixture/item/token",
  };
  store.putTokenFile(record);
  const path = join(dir, "providers", `${record.name}.json`);
  const before = fs.readFileSync(path, "utf8");
  const options = {
    store,
    provider: record.provider,
    account: record.account,
    purpose: record.purpose,
    reference: record.credentialRef,
    value: "test-new-token-0123456789",
    now: new Date("2026-10-26T00:00:00Z"),
  };
  for (const operation of [fs.writeSync, fs.fsyncSync, fs.renameSync]) {
    vi.mocked(operation).mockImplementationOnce(() => {
      throw errno("EIO");
    });
    expect(() => provisionValue(options)).toThrow(/test-io/);
    expect(fs.readFileSync(path, "utf8")).toBe(before);
    expect(fs.readdirSync(join(dir, "providers"))).toEqual([`${record.name}.json`]);
  }
  // A cleanup failure cannot report success, and a retry repairs both filenames.
  vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
    throw errno("EACCES");
  });
  expect(() => provisionValue(options)).toThrow(/test-io/);
  expect(fs.readFileSync(path, "utf8")).toBe(before);
  expect(store.tokenFiles()).toHaveLength(2);
  provisionValue(options);
  expect(fs.existsSync(path)).toBe(false);
  expect(store.tokenFiles()).toHaveLength(1);
  const replacement = fixtureValue(store.tokenFile(fixtureValue(store.tokenFiles()[0])));
  expect(replacement.token).toBe(options.value);
  // A record disappearing after enumeration is not a matching legacy credential.
  vi.spyOn(store, "tokenFiles").mockReturnValueOnce(["already-removed"]);
  store.replaceTokenFile(replacement);
  expect(store.tokenFile(replacement.name)).toEqual(replacement);
});
it("refuses insecure legacy tokens before writing a migration replacement", () => {
  const record = {
    version: 1 as const,
    name: "slack-legacy",
    provider: "slack" as const,
    account: "owner",
    purpose: "read" as const,
    token: "test-old-token-0123456789",
    credentialRef: "op://fixture/item/token",
  };
  store.putTokenFile(record);
  const path = join(dir, "providers", `${record.name}.json`);
  fs.chmodSync(path, 0o640);
  expect(() => store.replaceTokenFile({ ...record, name: "slack-canonical" })).toThrow(/chmod 600/);
  expect(fs.existsSync(join(dir, "providers/slack-canonical.json"))).toBe(false);
  expect(fs.readFileSync(path, "utf8")).toContain(record.token);
});
it("bounds records, rejects all group/world permissions, and validates before replacing", () => {
  const path = join(dir, "clients/google.json");
  fs.writeFileSync(path, "x".repeat(65537));
  expect(() => store.googleClient()).toThrow(/too large/);
  fs.writeFileSync(path, "{}");
  expect(() => store.googleClient()).toThrow(/unexpected shape/);
  for (const mode of [0o604, 0o620, 0o640, 0o601]) {
    fs.chmodSync(path, mode);
    expect(() => store.googleClient()).toThrow(/chmod 600/);
  }
  fs.chmodSync(path, 0o600);
  for (const mode of [0o704, 0o720, 0o740, 0o701]) {
    fs.chmodSync(dir, mode);
    expect(() => new CredentialStore(dir)).toThrow(/chmod 700/);
  }
  fs.chmodSync(dir, 0o700);
  expect(() => store.putClient({ ...client, clientId: "bad" })).toThrow(/invalid record/);
  expect(store.removeGrant("absent")).toBe(false);
  fs.mkdirSync(join(dir, "grants/fixture.json"), { mode: 0o700 });
  expect(() => store.removeGrant("fixture")).toThrow(/not a file/);
  fs.writeFileSync(join(dir, "providers/ignored.txt"), "");
  fs.writeFileSync(join(dir, "providers/invalid_name.json"), "");
  expect(store.tokenFiles()).toEqual([]);
});
it("serializes profile locks, recovers stale locks, refuses insecure locks, and cleans failed locks", async () => {
  const path = join(dir, "locks/fixture.lock");
  fs.writeFileSync(path, "fixture", { mode: 0o600 });
  fs.utimesSync(path, new Date(0), new Date(0));
  expect(await store.withLock("fixture", async () => "ok")).toBe("ok");
  expect(fs.existsSync(path)).toBe(false);
  fs.writeFileSync(path, "fixture", { mode: 0o600 });
  await expect(store.withLock("fixture", async () => 1, { waitMs: -1 })).rejects.toThrow(
    /another helper/,
  );
  fs.unlinkSync(path);
  fs.writeFileSync(path, "fixture", { mode: 0o644 });
  await expect(store.withLock("fixture", async () => 1)).rejects.toThrow(/chmod 600/);
  fs.unlinkSync(path);
  vi.mocked(fs.writeSync).mockImplementationOnce(() => {
    throw errno("EIO");
  });
  await expect(store.withLock("fixture", async () => 1)).rejects.toThrow(/test-io/);
  expect(fs.existsSync(path)).toBe(false);
  await expect(
    store.withLock("fixture", async () => {
      throw new Error("work failed");
    }),
  ).rejects.toThrow(/work failed/);
  expect(fs.existsSync(path)).toBe(false);
  expect(
    await store.withLock("fixture", async () => {
      fs.unlinkSync(path);
      return 2;
    }),
  ).toBe(2);
});
it("resolves a default dir without accessing it when filesystem creation is refused", () => {
  // No real default path is touched: the first filesystem operation is intercepted.
  vi.mocked(fs.mkdirSync).mockImplementationOnce(() => {
    throw errno("EACCES");
  });
  expect(() => new CredentialStore()).toThrow(/test-io/);
});
it("tolerates a lock released between its exclusive-open failure and owner check", async () => {
  const path = join(dir, "locks/fixture.lock");
  fs.writeFileSync(path, "fixture", { mode: 0o600 });
  const original = fixtureValue(vi.mocked(fs.lstatSync).getMockImplementation());
  vi.mocked(fs.lstatSync).mockImplementation((target, ...args) => {
    if (target === path) {
      fs.unlinkSync(path);
      vi.mocked(fs.lstatSync).mockImplementation(original);
      throw errno("ENOENT");
    }
    return original(target, ...args);
  });
  expect(await store.withLock("fixture", async () => "released")).toBe("released");
});

import { fixtureValue } from "./fixture.js";
