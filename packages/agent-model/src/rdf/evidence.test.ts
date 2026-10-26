// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { expect, it } from "vitest";
import { derivedUrn, digestOf, isIri, scopedUrn } from "../core/canonical.js";
import type { LedgerEntry } from "../records.js";
import { exampleRecords } from "../testing.js";
import { AGENT, agent, PROV, RDF, TERM_DEFINITIONS } from "../vocab.js";
import { descriptionToRdf, ledgerToRdf } from "./evidence.js";
import { parseTurtle, runQuery, toJsonLd, toSparql, toTurtle } from "./serialise.js";

it("retains canonical identity, bounded identifiers and strict namespace lookup", () => {
  expect(digestOf({ b: 2, a: 1 })).toBe(digestOf({ a: 1, b: 2 }));
  expect(derivedUrn("record", { a: 1 })).toMatch(/^urn:agent:record:[a-f0-9]{32}$/);
  expect(isIri(scopedUrn("record", "https://actor.example/#me", "test"))).toBe(true);
  expect(() => scopedUrn("record", "urn:scope", "bad label")).toThrow();
  expect(() => agent("unregistered-typo")).toThrow(/unregistered/);
});

it("exports evidence without upgrading claims or exposing a legacy recipient", async () => {
  const at = "2026-10-26T00:00:00Z";
  const records = [
    {
      type: "verification",
      protectedObject: "test-digest",
      property: "integrity-and-key-attribution",
      mechanism: "test",
      verifier: "urn:example:verifier",
      outcome: "valid",
      limitations: ["not authority"],
      at,
    },
    {
      type: "authorisation-decision",
      decider: "urn:example:decider",
      actionDigest: "test-digest",
      action: {
        ...exampleRecords["action-proposal"].intent,
        recipient: "test@example.org",
        parameters: { termsDigest: "untrusted-legacy-value" },
      },
      policy: { id: "urn:example:mandate", digest: "test-policy", evaluator: "test" },
      outcome: "deny",
      reason: "test-denial",
      at,
    },
    {
      type: "outcome",
      activity: "urn:example:activity",
      conclusion: "uncertain",
      method: "timeout",
      at,
    },
    {
      type: "message-in",
      id: "urn:example:message",
      conversation: "urn:example:conversation",
      kind: "invoke",
      from: "urn:example:sender",
      onBehalfOfClaim: "urn:example:owner",
      digest: "test-message",
      at,
    },
    {
      type: "source-authority",
      evaluator: "urn:example:evaluator",
      source: "invalid iri",
      outcome: "unresolved",
      claimType: "test",
      at,
    },
    { type: "test-unmapped-record", reason: "test-reason", at },
  ];
  const entries: LedgerEntry[] = records.map((record, index) => ({
    seq: index + 1,
    at,
    prev: "test-prev",
    record,
    hash: digestOf(record),
  }));
  const { quads, report } = ledgerToRdf(entries, "urn:example:ledger");
  expect(report.entries).toBe(records.length);
  expect(report.mapped.verification).toBe(1);
  expect(report.skeletonOnly["test-unmapped-record"]).toBe(1);
  expect(report.invalidIdentifiers).toContain("invalid iri");
  expect(report.unmappedFields["authorisation-decision.action.parameters.termsDigest"]).toBe(1);
  expect(quads.some((q) => q.object.value === "test@example.org")).toBe(false);
  expect(quads.some((q) => q.object.value === "untrusted-legacy-value")).toBe(false);
  expect(quads.some((q) => q.predicate.value === `${PROV}actedOnBehalfOf`)).toBe(false);
  expect(
    quads.some(
      (q) =>
        q.predicate.value === agent("recipientHash") &&
        q.object.value === exampleRecords["action-proposal"].intent.recipientHash,
    ),
  ).toBe(true);
  for (const quad of quads)
    for (const term of [quad.predicate, quad.object]) {
      if (term.termType === "NamedNode" && term.value.startsWith(AGENT)) {
        expect(Object.hasOwn(TERM_DEFINITIONS, term.value.slice(AGENT.length))).toBe(true);
      }
    }
  const turtle = await toTurtle(quads);
  const parsed = await parseTurtle(turtle);
  const store = new Store(quads);
  expect(new Store(parsed).size).toBe(store.size);
  const query = {
    id: "verification",
    question: "What was checked?",
    select: ["?record"],
    where: [["?record", "a", "agent:VerificationResult"]] as const,
  };
  expect(runQuery(store, query)).toHaveLength(1);
  expect(toSparql(query)).toContain(`PREFIX agent: <${AGENT}>`);
  expect(toJsonLd(quads)["@graph"]).toBeInstanceOf(Array);
  expect(toJsonLd(quads)["@context"]).toHaveProperty("agent", AGENT);
  expect(quads.filter((q) => q.predicate.value === `${RDF}type`).length).toBeGreaterThan(
    records.length,
  );
});

it("keeps implementation descriptions queryable through typed writes", () => {
  const quads = descriptionToRdf(
    {
      describes: "urn:example:actor",
      onBehalfOf: "urn:example:party",
      configurations: { implemented: ["urn:example:configuration"], accepted: [] },
      operations: [{ id: "urn:example:operation", version: "1", label: "Test operation" }],
      bindings: [{ id: "direct" }],
      notice: "synthetic",
    },
    "urn:example:description",
  );
  expect(
    runQuery(new Store(quads), {
      id: "description",
      question: "Supported operation?",
      select: ["?operation"],
      where: [["urn:example:description", "agent:supportsOperation", "?operation"]],
    }),
  ).toEqual([{ operation: DataFactory.namedNode("urn:example:operation") }]);
});
