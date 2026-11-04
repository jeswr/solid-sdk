// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "crypto";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMatrixTokenProvider, importMatrixDevice } from "../src/matrix.js";
import { matrixDeviceSchema, matrixIdentitySchema } from "../src/matrix-record.js";
import { CredentialStore } from "../src/store.js";

vi.mock("fs", async (original) => {
  const actual = await original<typeof import("fs")>();
  return {
    ...actual,
    fstatSync: vi.fn(actual.fstatSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

let dir: string;
let store: CredentialStore;
let file: string;
let expected: { homeserver: string; userId: string; deviceId: string; cryptoStorePath: string };
const source = {
  homeserver: "https://matrix.example",
  user_id: "@owner:example.org",
  device_id: "FIXTURE",
  access_token: "synthetic-matrix-read-token",
};
function write(value: unknown = source) {
  fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
}
function provision(purpose: "read" | "send" = "read") {
  importMatrixDevice({ store, file, account: "owner", purpose, expected });
}
function record(purpose: "read" | "send" = "read") {
  return {
    ...expected,
    version: 1 as const,
    account: "owner",
    purpose,
    accessToken: source.access_token,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(join(tmpdir(), "matrix-device-test-"));
  store = new CredentialStore(join(dir, "store"));
  file = join(dir, "device.json");
  const cryptoStorePath = join(dir, "crypto");
  fs.mkdirSync(cryptoStorePath, { mode: 0o700 });
  expected = {
    homeserver: source.homeserver,
    userId: source.user_id,
    deviceId: source.device_id,
    cryptoStorePath,
  };
  write();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("imports an explicit provisioned device privately, with separate read and send records", async () => {
  provision();
  const tokens = createMatrixTokenProvider({
    store,
    account: "owner",
    read: expected,
    send: expected,
  });
  expect(await tokens.read({ id: "owner" })).toEqual({
    access: "read",
    accessToken: source.access_token,
  });
  await expect(tokens.send({ id: "owner" })).rejects.toThrow("explicit provisioning");
  write({ ...source, access_token: "synthetic-matrix-send-token" });
  provision("send");
  expect(await tokens.send({ id: "owner" })).toEqual({
    access: "send",
    accessToken: "synthetic-matrix-send-token",
  });
  expect(store.tokenFiles()).toEqual([]);
  expect(fs.statSync(join(store.dir, "matrix")).mode & 0o777).toBe(0o700);
  for (const name of fs.readdirSync(join(store.dir, "matrix")))
    expect(fs.statSync(join(store.dir, "matrix", name)).mode & 0o777).toBe(0o600);
  await expect(tokens.read({ id: "other" })).rejects.toThrow("not configured");
  await expect(
    createMatrixTokenProvider({ store, account: "owner", read: expected }).send({ id: "owner" }),
  ).rejects.toThrow("not configured");
});

it.each([
  "homeserver",
  "userId",
  "deviceId",
  "cryptoStorePath",
] as const)("pins %s across file import and runtime replacement", async (key) => {
  provision();
  const tokens = createMatrixTokenProvider({ store, account: "owner", read: expected });
  const changes = {
    homeserver: "https://other.example",
    userId: "@other:example.org",
    deviceId: "OTHER",
    cryptoStorePath: join(dir, "other"),
  };
  store.putMatrixDevice({ ...record(), [key]: changes[key] });
  await expect(tokens.read({ id: "owner" })).rejects.toThrow("differs from pinned");
  if (key !== "cryptoStorePath") {
    const field = { homeserver: "homeserver", userId: "user_id", deviceId: "device_id" }[key];
    write({ ...source, [field]: changes[key] });
    expect(() => provision()).toThrow("does not match");
  }
});

it.each([
  null,
  {},
  { ...source, access_token: "short" },
  { ...source, extra: "refused" },
])("refuses malformed provisioned records without replacing credentials: %j", (value) => {
  provision();
  write(value);
  expect(() => provision()).toThrow();
  expect(store.matrixDevice("owner", "read")).toEqual(record());
});

it("validates source configuration and identities without leaking invalid values", () => {
  expect(() =>
    importMatrixDevice({ store, file: "relative", account: "owner", purpose: "read", expected }),
  ).toThrow("configuration");
  expect(() =>
    importMatrixDevice({
      store,
      file,
      account: "owner",
      purpose: "read",
      expected: { ...expected, homeserver: "http://matrix.example" },
    }),
  ).toThrow("configuration");
  expect(() =>
    importMatrixDevice({ store, file, account: "bad/account", purpose: "read", expected }),
  ).toThrow("invalid Matrix device record");
  for (const homeserver of [
    "http://matrix.example",
    "https://u:p@matrix.example",
    "https://matrix.example/path",
    "garbage",
  ])
    expect(matrixIdentitySchema.safeParse({ ...expected, homeserver }).success).toBe(false);
  expect(matrixDeviceSchema.safeParse({ ...record(), cryptoStorePath: "relative" }).success).toBe(
    false,
  );
  expect(() => store.putMatrixDevice({ ...record(), accessToken: "bad" })).toThrow(
    "invalid record",
  );
});

it("refuses symlinks, directories, oversized, non-JSON and public source files", () => {
  fs.chmodSync(file, 0o644);
  expect(() => provision()).toThrow("unsafe");
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, "{");
  expect(() => provision()).toThrow("invalid");
  fs.writeFileSync(file, "x".repeat(65537));
  expect(() => provision()).toThrow("unsafe");
  fs.unlinkSync(file);
  fs.symlinkSync(join(dir, "missing"), file);
  expect(() => provision()).toThrow("unsafe");
  fs.unlinkSync(file);
  fs.mkdirSync(file, { mode: 0o700 });
  expect(() => provision()).toThrow("unsafe");
});

it("refuses unsafe directories and unavailable ownership checks", () => {
  fs.chmodSync(dir, 0o755);
  expect(() => provision()).toThrow("private");
  fs.chmodSync(dir, 0o700);
  fs.chmodSync(expected.cryptoStorePath, 0o755);
  expect(() => provision()).toThrow("private");
  fs.chmodSync(expected.cryptoStorePath, 0o700);
  fs.rmdirSync(expected.cryptoStorePath);
  fs.symlinkSync(dir, expected.cryptoStorePath);
  expect(() => provision()).toThrow("private");
  fs.unlinkSync(expected.cryptoStorePath);
  fs.mkdirSync(expected.cryptoStorePath, { mode: 0o700 });
  vi.spyOn(process, "getuid").mockReturnValue(-1);
  expect(() => provision()).toThrow("private");
});

it("refuses a foreign source descriptor and content that grows after stat", async () => {
  const original = (await vi.importActual<typeof import("fs")>("fs")).fstatSync;
  vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number) => ({
    ...original(fd),
    uid: -1,
  })) as typeof fs.fstatSync);
  expect(() => provision()).toThrow("unsafe");
  vi.restoreAllMocks();
  vi.mocked(fs.fstatSync).mockReset();
  vi.spyOn(fs, "readFileSync").mockReturnValue(" ".repeat(65537));
  expect(() => provision()).toThrow("unsafe");
});

it("refuses a valid record copied over a different account or purpose", () => {
  provision();
  const path = (account: string, purpose: string) =>
    join(
      store.dir,
      "matrix",
      `${createHash("sha256")
        .update(JSON.stringify([account, purpose]))
        .digest("hex")
        .slice(0, 32)}.json`,
    );
  fs.copyFileSync(path("owner", "read"), path("other", "read"));
  expect(() => store.matrixDevice("other", "read")).toThrow("another account");
  fs.copyFileSync(path("owner", "read"), path("owner", "send"));
  expect(() => store.matrixDevice("owner", "send")).toThrow("another account");
});
