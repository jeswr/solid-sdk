// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare module specifiers
// AUTHORED-BY Codex GPT-6
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadProviderConfig } from "../src/providers/credentials.js";
import { fixtureValue } from "./fixture.js";

vi.mock("fs", async (original) => {
  const actual = await original<typeof import("fs")>();
  return {
    ...actual,
    openSync: vi.fn(actual.openSync),
    fstatSync: vi.fn(actual.fstatSync),
    readFileSync: vi.fn(actual.readFileSync),
    closeSync: vi.fn(actual.closeSync),
  };
});

let dir: string;
let path: string;
const config = { version: 1, accounts: [] };
beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), "credentials-config-faults-"));
  path = join(dir, "providers.json");
  fs.writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("validates and reads one descriptor even if the configuration path is replaced", () => {
  const original = fixtureValue(vi.mocked(fs.fstatSync).getMockImplementation());
  vi.mocked(fs.fstatSync).mockImplementationOnce((fd) => {
    const st = original(fd);
    fs.renameSync(path, join(dir, "original.json"));
    fs.writeFileSync(path, '{"access_token":"test-token-0123456789"}', { mode: 0o666 });
    return st;
  });
  expect(loadProviderConfig(path)).toEqual(config);
  expect(fs.openSync).toHaveBeenCalledExactlyOnceWith(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  const fd = fixtureValue(vi.mocked(fs.openSync).mock.results[0]).value as number;
  expect(fs.fstatSync).toHaveBeenCalledExactlyOnceWith(fd);
  expect(fs.readFileSync).toHaveBeenCalledExactlyOnceWith(fd, "utf8");
  expect(fs.closeSync).toHaveBeenCalledExactlyOnceWith(fd);
  expect(() => fs.fstatSync(fd)).toThrow(/EBADF/);
});

it("refuses symlinked configuration without following it", () => {
  const link = join(dir, "link.json");
  fs.symlinkSync(path, link);
  expect(() => loadProviderConfig(link)).toThrow();
  expect(fs.readFileSync).not.toHaveBeenCalled();
  expect(fs.closeSync).not.toHaveBeenCalled();
});

it("refuses non-file configuration and closes its descriptor without reading", () => {
  expect(() => loadProviderConfig(dir)).toThrow(/regular file/);
  expect(fs.readFileSync).not.toHaveBeenCalled();
  expect(fs.closeSync).toHaveBeenCalledOnce();
});

it("refuses foreign ownership from fstat and closes the descriptor without reading", () => {
  const original = fixtureValue(vi.mocked(fs.fstatSync).getMockImplementation());
  vi.mocked(fs.fstatSync).mockImplementationOnce((fd) => {
    const st = original(fd);
    st.uid = Number(st.uid) + 1;
    return st;
  });
  expect(() => loadProviderConfig(path)).toThrow(/another user/);
  expect(fs.readFileSync).not.toHaveBeenCalled();
  expect(fs.closeSync).toHaveBeenCalledOnce();
});

it("fails closed when ownership cannot be verified", () => {
  const descriptor = fixtureValue(Object.getOwnPropertyDescriptor(process, "getuid"));
  Object.defineProperty(process, "getuid", { value: undefined, configurable: true });
  try {
    expect(() => loadProviderConfig(path)).toThrow(/ownership cannot be verified/);
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.closeSync).toHaveBeenCalledOnce();
  } finally {
    Object.defineProperty(process, "getuid", descriptor);
  }
});

it.each([0o620, 0o602])("refuses writable configuration mode %i before reading", (mode) => {
  fs.chmodSync(path, mode);
  expect(() => loadProviderConfig(path)).toThrow(/group\/world-writable/);
  expect(fs.readFileSync).not.toHaveBeenCalled();
  expect(fs.closeSync).toHaveBeenCalledOnce();
});

it("closes the descriptor when configuration parsing fails", () => {
  fs.writeFileSync(path, "{corrupt");
  expect(() => loadProviderConfig(path)).toThrow(SyntaxError);
  expect(fs.closeSync).toHaveBeenCalledOnce();
});
