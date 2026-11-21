// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "fs";
import { DataFactory } from "n3";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scopedId } from "../src/model/named-values.js";
import { graphContents, inGraph, StoreNode } from "../src/model/store/common.js";
import { SnapshotMemo } from "../src/model/store/state.js";
import { AWP } from "../src/profile/vocabulary.js";
import {
  emptyState,
  FileStateStore,
  normaliseState,
  type RuntimeState,
} from "../src/store/state.js";
import * as storeQuads from "../src/wire/store-quads.js";
import { readLocalStoreRdf, writeNQuads } from "../src/wire/store-quads.js";

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

it("preserves lexical instants throughout the typed state sections", () => {
  const state = completeFixture();
  const at = "2026-11-13T10:00Z";
  const offset = "2026-11-13T11:00+01:00";
  for (const pin of state.trustPins) pin.expiresAt = at;
  for (const hold of Object.values(state.trustHolds)) hold.expiresAt = offset;
  for (const approval of Object.values(state.approvals)) approval.validUntil = at;
  for (const approvals of Object.values(state.organisationApprovals)) {
    for (const approval of approvals) Object.assign(approval, { issuedAt: at, validUntil: offset });
  }
  state.revokedMandates = state.revokedMandates.map((revocation) => ({
    ...revocation,
    at: offset,
  }));
  for (const agreement of Object.values(state.agreements))
    Object.assign(agreement, { formedAt: at });
  for (const items of Object.values(state.contextItems)) {
    for (const item of items) Object.assign(item, { asOf: at });
  }
  for (const hold of Object.values(state.precedenceHolds)) Object.assign(hold, { asOf: offset });
  store.save(state);
  const bytes = readFileSync(path, "utf8");
  expect(bytes).not.toContain(`"${at}"^^`);
  expect(bytes).not.toContain(`"${offset}"^^`);
  expect(store.load()).toEqual(state);
});

it("preserves lone surrogates in an agreement's operation version", () => {
  const state = completeFixture();
  const [key, agreement] = Object.entries(state.agreements)[0]!;
  const version = "v\ud800\ufffd\udc00😀";
  state.agreements[key] = { ...agreement, operation: { ...agreement.operation, version } };
  store.save(state);
  const bytes = readFileSync(path, "utf8");
  expect(bytes).toContain("\\\\ud800");
  expect(store.load().agreements[key]?.operation.version).toBe(version);
  expect(store.load().agreements).toEqual(state.agreements);
});

it("reopens earlier v2 Agreement timestamps with a legacy date-time datatype", () => {
  const state = completeFixture();
  const [key, agreement] = Object.entries(state.agreements)[0]!;
  const formedAt = "2026-11-13T10:00Z";
  state.agreements[key] = { ...agreement, formedAt };
  store.save(state);
  const { namedNode, literal } = DataFactory;
  const dataset = readLocalStoreRdf(readFileSync(path, "utf8"), "application/n-quads");
  const [quad] = dataset.getQuads(namedNode(agreement.id), namedNode(AWP + "formedAt"), null, null);
  expect(quad?.object).toEqual(literal(formedAt));
  dataset.removeQuad(quad!);
  dataset.addQuad(
    quad!.subject,
    quad!.predicate,
    literal(formedAt, namedNode("http://www.w3.org/2001/XMLSchema#dateTime")),
    quad!.graph,
  );
  writeFileSync(path, writeNQuads(dataset));
  expect(store.load()).toEqual(state);
});

it("accepts 32 levels of inherited item terms and refuses a 33rd before replacing the file", () => {
  const state = completeFixture();
  const [key, fact] = Object.entries(state.precedenceHolds)[0]!;
  const terms = Array.from({ length: 31 }).reduce<NonNullable<typeof fact.terms>>(
    (child) => ({
      policy: child.policy,
      inherited: [{ target: "urn:example:asset", terms: child }],
    }),
    { policy: fact.terms!.policy },
  );
  state.precedenceHolds[key] = { ...fact, terms };
  writeFileSync(path, JSON.stringify(state));
  const expected = store.load();
  store.save(expected);
  expect(store.load()).toEqual(expected);
  const before = readFileSync(path);
  state.precedenceHolds[key] = {
    ...fact,
    terms: { policy: terms.policy, inherited: [{ target: "urn:example:asset", terms }] },
  };
  expect(() => store.save(state)).toThrow(/inherited item terms exceed.*32/i);
  expect(readFileSync(path)).toEqual(before);

  // Extend the RDF directly to exercise the reader independently of the writer cap.
  const graph = "urn:awp:state:precedenceHolds";
  const dataset = readLocalStoreRdf(before.toString(), "application/n-quads");
  const local = graphContents(dataset, graph);
  const { namedNode } = DataFactory;
  const leaf = local
    .getSubjects(
      namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      namedNode(AWP + "ItemTerms"),
      null,
    )
    .map((id) => new StoreNode(id, local, "ItemTerms"))
    .find((node) => node.term(AWP + "inheritedTerms") === undefined)!;
  const child = new StoreNode("urn:example:33rd-terms", local, "ItemTerms");
  child.types.add(AWP + "ItemTerms");
  child.put(
    "http://www.w3.org/ns/odrl/2/hasPolicy",
    leaf.term("http://www.w3.org/ns/odrl/2/hasPolicy")!,
  );
  const ref = new StoreNode("urn:example:33rd-reference", local, "InheritedItemTerms");
  ref.types.add(AWP + "InheritedItemTerms");
  ref.setField("target", "urn:example:asset");
  ref.put(AWP + "terms", namedNode(child.id));
  leaf.putValue(AWP + "inheritedTerms", [ref.id]);
  dataset.deleteMatches(undefined, undefined, undefined, namedNode(graph));
  dataset.addQuads([...inGraph(local, graph)]);
  writeFileSync(path, writeNQuads(dataset));
  expect(() => store.load()).toThrow(/inherited item terms exceed.*32/i);
});

it("rejects a local snapshot beyond the byte budget before buffering it", () => {
  writeFileSync(path, JSON.stringify(emptyState()));
  truncateSync(path, 256 * 1024 * 1024 + 1);
  expect(() => store.load()).toThrow(/268435456-byte limit/);
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

it("checks the RDF graph when the decoded entry matches the original JSON", () => {
  const state = emptyState();
  store.save(state);
  const before = readFileSync(path);
  const write = writeNQuads;
  const encoder = vi.spyOn(storeQuads, "writeNQuads").mockImplementation((dataset, maxBytes) => {
    if (maxBytes !== Infinity) return write(dataset, maxBytes);
    const [quad] = dataset;
    dataset.add(
      DataFactory.quad(
        quad!.subject,
        DataFactory.namedNode("urn:example:unexpected"),
        DataFactory.literal("extra quad"),
        quad!.graph,
      ),
    );
    return write(dataset, maxBytes);
  });
  try {
    state.domain.updated = true;
    expect(() => store.save(state)).toThrow(/inconsistent snapshot entry in domain/i);
    expect(readFileSync(path)).toEqual(before);
  } finally {
    encoder.mockRestore();
  }
  store.save(state);
  expect(store.load()).toEqual(state);
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
