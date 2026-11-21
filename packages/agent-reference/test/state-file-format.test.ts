// AUTHORED-BY Codex GPT-6.2 Sol
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SnapshotMemo } from "../src/model/store/state.js";
import { emptyState, FileStateStore, normaliseState } from "../src/store/state.js";

let dir: string;
let path: string;
let store: FileStateStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "awp-state-file-"));
  path = join(dir, "state.json");
  store = new FileStateStore(path);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

it("reads a legacy snapshot and writes deterministic version 2 RDF on the next save", () => {
  const state = emptyState();
  state.domain = { z: true, a: ["repeated", "repeated"] };
  writeFileSync(path, JSON.stringify(state));
  expect(store.load()).toEqual(state);
  store.save(state);
  const bytes = readFileSync(path, "utf8");
  expect(bytes).toContain("#stateVersion>");
  expect(store.load()).toEqual(state);
  expect(Object.keys(store.load().domain)).toEqual(["z", "a"]);
  store.save(state);
  expect(readFileSync(path, "utf8")).toBe(bytes);
});

it("migrates the compiled legacy mortgage fixture without changing its data", () => {
  const original = readFileSync(new URL("fixtures/legacy/state-v1.json", import.meta.url), "utf8");
  writeFileSync(path, original);
  const expected = normaliseState(JSON.parse(original));
  expect(store.load()).toEqual(expected);
  store.save(expected);
  expect(readFileSync(path, "utf8")).toContain("#stateVersion>");
  expect(store.load()).toEqual(expected);
});

it("does not encode an unchanged entry again", () => {
  const state = emptyState();
  state.domain = { z: true, a: ["repeated", "repeated"] };
  const counts: number[] = [];
  const write = SnapshotMemo.prototype.write;
  const memo = vi.spyOn(SnapshotMemo.prototype, "write").mockImplementation(function (
    this: SnapshotMemo,
    input,
  ) {
    const bytes = write.call(this, input);
    counts.push(this.encodedEntries);
    return bytes;
  });
  try {
    store.save(state);
    store.save(state);
    state.domain.z = false;
    store.save(state);
    expect(counts).toEqual([5, 0, 1]);
  } finally {
    memo.mockRestore();
  }
});

it.each([
  [
    "version",
    (text: string) => text.replace(/(#stateVersion> )"2"/, '$1"3"'),
    /unsupported state version/,
  ],
  [
    "missing section",
    (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.includes("urn:awp:state:domain>"))
        .join("\n"),
    /snapshot is malformed/,
  ],
  [
    "malformed section",
    (text: string) => text.replace("#entryKey>", "#unknownEntryKey>"),
    /snapshot is malformed/,
  ],
  ["empty", () => "", /snapshot is malformed/],
] as const)("rejects %s", (_name, corrupt, message) => {
  const state = emptyState();
  state.domain.z = true;
  store.save(state);
  const bytes = readFileSync(path, "utf8");
  const changed = corrupt(bytes);
  expect(changed).not.toBe(bytes);
  writeFileSync(path, changed);
  expect(() => store.load()).toThrow(message);
});

it.each([
  ["usedApprovals", "approvalUsed"],
  ["trustRefusals", "trustRefused"],
] as const)("refuses a false marker in %s", (section, predicate) => {
  const state = emptyState();
  state[section]["urn:example:marker"] = true;
  store.save(state);
  const bytes = readFileSync(path, "utf8");
  const changed = bytes.replace(new RegExp(`(#${predicate}> )"true"`), '$1"false"');
  expect(changed).not.toBe(bytes);
  writeFileSync(path, changed);
  expect(() => store.load()).toThrow("state snapshot is malformed");
});
