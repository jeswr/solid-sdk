// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scopedId } from "../src/model/named-values.js";
import { SnapshotMemo } from "../src/model/store/state.js";
import { AWP } from "../src/profile/vocabulary.js";
import {
  emptyState,
  FileStateStore,
  normaliseState,
  type RuntimeState,
} from "../src/store/state.js";

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

function completeFixture(): RuntimeState {
  return normaliseState(
    JSON.parse(readFileSync(new URL("fixtures/state-complete.json", import.meta.url), "utf8"))
      .state,
  );
}

it("reopens the reviewer's precedence hold when its assigner names a later permission", () => {
  const state = completeFixture();
  const [key, fact] = Object.entries(state.precedenceHolds)[0]!;
  const terms = fact.terms!;
  const [rule] = terms.policy.permissions!;
  state.precedenceHolds[key] = {
    ...fact,
    terms: {
      ...terms,
      policy: {
        ...terms.policy,
        assigner: "urn:rule:records:second",
        permissions: [
          { ...rule!, id: "urn:rule:records:first" },
          { type: "permission", action: "read", id: "urn:rule:records:second" },
        ],
      },
    },
  };
  store.save(state);
  expect(store.load()).toEqual(state);
});

it.each([
  ["one-character URN NID", { target: "urn:x:1" }],
  ["non-IRI policy identifier", { id: "terms-1" }],
] as const)("migrates item terms with a %s from v1 JSON", (_name, change) => {
  const state = completeFixture();
  const [key, fact] = Object.entries(state.precedenceHolds)[0]!;
  const terms = fact.terms!;
  const [rule] = terms.policy.permissions!;
  state.precedenceHolds[key] = {
    ...fact,
    terms: {
      ...terms,
      policy: {
        ...terms.policy,
        id: "id" in change ? change.id : terms.policy.id,
        permissions: [{ ...rule!, ...("target" in change && { target: change.target }) }],
      },
    },
  };
  writeFileSync(path, JSON.stringify(state));
  const expected = store.load();
  store.save(expected);
  expect(store.load()).toEqual(expected);
});

it.each([
  ["a lone surrogate", { nested: ["\ud800"] }],
  ["a lone surrogate in an object key", { ["\ud800"]: true }],
  ["over 8,192 array entries", Array.from({ length: 8_193 }, () => true)],
  ["over 32 levels", Array.from({ length: 33 }).reduce<unknown>((child) => [child], "leaf")],
  ["over 50,000 JSON values", Array.from({ length: 7 }, () => Array(8_000).fill(true))],
  ["over 1 MiB of string data", "x".repeat(1_048_577)],
] as const)("migrates generic entries with %s from v1 JSON", (_name, value) => {
  const state = emptyState();
  state.domain.entry = value as RuntimeState["domain"][string];
  writeFileSync(path, JSON.stringify(state));
  const expected = store.load();
  store.save(expected);
  expect(store.load()).toEqual(expected);
});

it("keeps an unpaired surrogate distinct from the replacement character in entry keys", () => {
  const state = emptyState();
  state.domain = { ["\ud800"]: 1, ["\ufffd"]: 2 };
  store.save(state);
  expect(store.load().domain).toEqual(state.domain);
});

it("migrates inherited item terms deeper than the named-value limit", () => {
  const state = completeFixture();
  const [key, fact] = Object.entries(state.precedenceHolds)[0]!;
  const terms = Array.from({ length: 33 }).reduce<NonNullable<typeof fact.terms>>(
    (child) => ({
      policy: child.policy,
      inherited: [{ target: "urn:example:asset", terms: child }],
    }),
    fact.terms!,
  );
  state.precedenceHolds[key] = { ...fact, terms };
  writeFileSync(path, JSON.stringify(state));
  const expected = store.load();
  store.save(expected);
  expect(store.load()).toEqual(expected);
});

it.each([
  "malformed RDF",
  "different state",
] as const)("preserves the snapshot when the encoder returns %s", (kind) => {
  const state = emptyState();
  store.save(state);
  const before = readFileSync(path);
  const memo = vi.spyOn(SnapshotMemo.prototype, "write");
  // Only replace the outgoing bytes. The normal reader still verifies the graph.
  memo.mockReturnValueOnce(kind === "malformed RDF" ? "invalid N-Quads" : before.toString());
  state.domain.updated = true;
  try {
    expect(() => store.save(state)).toThrow(/cannot save state snapshot/i);
    expect(readFileSync(path)).toEqual(before);
    expect(store.load()).toEqual(emptyState());
    store.save(state);
    expect(store.load()).toEqual(state);
  } finally {
    memo.mockRestore();
  }
});

it("reports an encoding error while retaining the previous snapshot", () => {
  const state = emptyState();
  store.save(state);
  const before = readFileSync(path);
  const memo = vi.spyOn(SnapshotMemo.prototype, "write").mockImplementationOnce(() => {
    throw new TypeError("encoder failed");
  });
  try {
    expect(() => store.save(state)).toThrow(/cannot save state snapshot.*encoder failed/i);
    expect(readFileSync(path)).toEqual(before);
    expect(store.load()).toEqual(state);
  } finally {
    memo.mockRestore();
  }
});

it("checks the full section graph when a new entry can change the meaning of a saved link", () => {
  const state = emptyState();
  const collection = scopedId(scopedId("urn:awp:state:domain", "second"), AWP + "entryValue");
  state.domain.first = collection;
  store.save(state);
  const before = readFileSync(path);
  state.domain.second = ["contents"];
  expect(() => store.save(state)).toThrow(/cannot save state snapshot/i);
  expect(readFileSync(path)).toEqual(before);
  expect(store.load().domain).toEqual({ first: collection });
});

it("refuses a sparse array section before replacing its snapshot", () => {
  const state = emptyState();
  store.save(state);
  const before = readFileSync(path);
  state.descriptionAddresses = new Array<string>(2);
  state.descriptionAddresses[1] = "urn:example:address";
  expect(() => new SnapshotMemo().write(state)).toThrow(/sparse.*descriptionAddresses/i);
  expect(() => store.save(state)).toThrow(/sparse.*descriptionAddresses/i);
  expect(readFileSync(path)).toEqual(before);
  expect(store.load()).toEqual(emptyState());
});

it("does not encode an unchanged entry again", () => {
  const state = emptyState();
  state.domain = { z: true, a: ["repeated", "repeated"] };
  const counts: number[] = [];
  let writer: SnapshotMemo | undefined;
  const write = SnapshotMemo.prototype.write;
  const memo = vi.spyOn(SnapshotMemo.prototype, "write").mockImplementation(function (
    this: SnapshotMemo,
    input,
  ) {
    writer ??= this;
    const bytes = write.call(this, input);
    if (this === writer) counts.push(this.encodedEntries);
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
