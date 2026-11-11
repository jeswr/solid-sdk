// AUTHORED-BY Codex GPT-6.1-Sol
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { mkdir, mkdtemp, open, rm, symlink, truncate, writeFile } from "fs/promises";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { tmpdir } from "os";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatgptZipJson, readExportJson } from "./export-file.js";
import { MAX_BYTES } from "./io.js";
import { createCaptureTestZip as zip } from "./testing.js";

const signal = () => new AbortController().signal;
let home: string;
let cwd: string;
let source: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "capture-export-file-test-"));
  cwd = join(home, "project");
  await mkdir(cwd);
  source = join(cwd, "conversations.json");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

describe("ZIP boundary", () => {
  it.each([
    false,
    true,
  ])("reads stored/deflated JSON, ignores unrelated entries and supports descriptors: %s", (deflate) => {
    const bytes = zip([
      { name: "assets/", text: "" },
      { name: "assets/example.txt", text: "ignored" },
      { name: "conversations.json", text: "[]", deflate, descriptor: deflate },
    ]);
    expect(chatgptZipJson(bytes)).toBe("[]");
    const comment = Buffer.from("a comment");
    bytes.writeUInt16LE(comment.length, bytes.length - 2);
    expect(chatgptZipJson(Buffer.concat([bytes, comment]))).toBe("[]");
  });
  it.each([
    "../conversations.json",
    "/conversations.json",
    "C:/conversations.json",
    "a\\conversations.json",
    "a/./conversations.json",
    "a/../conversations.json",
    "bad\u0000name",
  ])("refuses unsafe paths anywhere in the archive: %j", (name) => {
    expect(() =>
      chatgptZipJson(
        zip([
          { name, text: "[]" },
          { name: "conversations.json", text: "[]" },
        ]),
      ),
    ).toThrow();
  });
  it("rejects missing/duplicate JSON, nested-only JSON, bombs, corrupt payloads and invalid UTF-8", () => {
    expect(() => chatgptZipJson(zip([]))).toThrow();
    expect(() =>
      chatgptZipJson(zip([{ name: "nested/conversations.json", text: "[]" }])),
    ).toThrow();
    expect(() =>
      chatgptZipJson(zip(Array(2).fill({ name: "conversations.json", text: "[]" }))),
    ).toThrow();
    expect(() => chatgptZipJson(Buffer.alloc(MAX_BYTES + 1))).toThrow();
    expect(() => chatgptZipJson(Buffer.alloc(2))).toThrow();
    const bomb = zip([
      {
        name: "conversations.json",
        text: " ".repeat(MAX_BYTES + 1),
        deflate: true,
        descriptor: true,
      },
    ]);
    expect(() => chatgptZipJson(bomb)).toThrow();
    const start = bomb.readUInt32LE(bomb.length - 6);
    bomb.writeUInt32LE(1, start + 24); // A lying directory cannot bypass zlib's independent cap.
    expect(() => chatgptZipJson(bomb)).toThrow();
    const invalid = zip([{ name: "conversations.json", text: "[]" }]);
    invalid[30] = 255;
    expect(() => chatgptZipJson(invalid)).toThrow();
  });
  it.each([
    ["disk", "end", 4, 2, 1],
    ["directory disk", "end", 6, 2, 1],
    ["entry count", "end", 8, 2, 2],
    ["entry limit", "end", 10, 2, 10001],
    ["directory size", "end", 12, 4, 1],
    ["header signature", "central", 0, 4, 0],
    ["encryption", "central", 8, 2, 1],
    ["compression", "central", 10, 2, 99],
    ["entry disk", "central", 34, 2, 1],
    ["symlink", "central", 38, 4, 0o120000 * 65536],
    ["ZIP64 compressed", "central", 20, 4, 0xffffffff],
    ["ZIP64 expanded", "central", 24, 4, 0xffffffff],
    ["entry length", "central", 30, 2, 65535],
    ["local offset", "central", 42, 4, 0xffffffff],
    ["local signature", "local", 0, 4, 0],
    ["local flags", "local", 6, 2, 8],
    ["local method", "local", 8, 2, 8],
    ["local name", "local", 30, 2, 0],
    ["local data bounds", "local", 28, 2, 65535],
    ["local CRC", "local", 14, 4, 0],
    ["local compressed", "local", 18, 4, 0],
    ["local expanded", "local", 22, 4, 0],
    ["content CRC", "local", 48, 1, 0],
  ] as const)("rejects malformed %s", (_label, at, offset, width, value) => {
    const bytes = zip([{ name: "conversations.json", text: "[]" }]);
    const base =
      at === "end"
        ? bytes.length - 22
        : at === "central"
          ? bytes.readUInt32LE(bytes.length - 6)
          : 0;
    bytes.writeUIntLE(value, base + offset, width);
    expect(() => chatgptZipJson(bytes)).toThrow();
  });
});

describe("regular export file reads", () => {
  it("refuses symlinks, directories, oversized files and aborted reads", async () => {
    await writeFile(source, "[]");
    const link = join(cwd, "link.json");
    await symlink(source, link);
    await expect(readExportJson(link, true, signal())).rejects.toThrow();
    await expect(readExportJson(cwd, true, signal())).rejects.toThrow();
    await truncate(source, MAX_BYTES + 1);
    await expect(readExportJson(source, true, signal())).rejects.toThrow();
    const aborted = new AbortController();
    aborted.abort();
    await expect(readExportJson(source, true, aborted.signal)).rejects.toThrow();
  });
  it("bounds growing files independently of stat and closes on cancellation", async () => {
    await writeFile(source, "[]");
    const handle = await open(source, "r");
    const prototype = Object.getPrototypeOf(handle);
    await handle.close();
    const original = prototype.stat;
    vi.spyOn(prototype, "stat").mockImplementation(async function (this: { fd: number }) {
      const stat = await original.call(this);
      await truncate(source, MAX_BYTES + 1);
      return stat;
    });
    await expect(readExportJson(source, true, signal())).rejects.toThrow(/grew/);
  });
});
