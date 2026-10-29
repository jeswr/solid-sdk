// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { evaluateDelegated } from "../src/delegation.js";
import { parsePolicy, policyToJsonLd, policyToTurtle } from "../src/policy.js";
import type { OdrlPolicy } from "../src/types.js";
import { ODRLD, ODRLD_PROFILE_IRI } from "../src/vocab.js";
import { wrapPolicy } from "../src/wrappers.js";

const LEGACY = "https://w3id.org/jeswr/odrl-delegation#";
const ROOT = "https://example.org/policy/root";
const LEAF = "https://example.org/policy/leaf";
const AGENT = "https://example.org/agent";
const DELEGATE = "https://example.org/delegate";
const OWNER = "https://example.org/owner";
const TARGET = "https://example.org/data";
function policy(legacyParent: boolean, legacyDepth: boolean, extra = ""): string {
  return `
    @prefix odrl: <http://www.w3.org/ns/odrl/2/> .
    <${LEAF}> a odrl:Agreement ; odrl:profile <${ODRLD_PROFILE_IRI}> ;
      odrl:assigner <${AGENT}> ; odrl:assignee <${DELEGATE}> ;
      <${legacyParent ? LEGACY : ODRLD}delegatedUnder> <${ROOT}> ;
      odrl:permission [ odrl:action odrl:read ; odrl:target <${TARGET}> ;
        odrl:constraint [ odrl:leftOperand <${legacyDepth ? LEGACY : ODRLD}delegationDepth> ;
          odrl:operator odrl:lteq ; odrl:rightOperand 0 ] ] .
    ${extra}
  `;
}
function defined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error("missing policy");
  return value;
}

describe("delegation namespace migration", () => {
  it("updates and deletes live alias sets without leaving stale legacy edges", async () => {
    const data = await parseRdf(policy(true, false));
    const node = defined(wrapPolicy(data).policies()[0]);
    const edges = node.delegatedUnders;
    const old = defined([...edges][0]);
    const next = new TermWrapper("https://example.org/next", data, DataFactory);
    expect(edges.has(old)).toBe(true);
    expect(edges.size).toBe(1);
    expect(edges.add(next)).toBe(edges);
    expect(edges.has(old)).toBe(false);
    expect(edges.has(next)).toBe(true);
    expect([...edges.keys()].map((term) => term.value)).toEqual([next.value]);
    expect([...edges.entries()].map(([term, key]) => [term.value, key.value])).toEqual([
      [next.value, next.value],
    ]);
    const visited: string[] = [];
    edges.forEach((term, key, set) => {
      expect(term).toBe(key);
      expect(set).toBe(edges);
      visited.push(term.value);
    });
    expect(visited).toEqual([next.value]);
    expect([...data].some((q) => q.predicate.value === `${ODRLD}delegatedUnder`)).toBe(false);
    expect(
      [...data].some(
        (q) => q.predicate.value === `${LEGACY}delegatedUnder` && q.object.value === next.value,
      ),
    ).toBe(true);
    expect(edges.delete(next)).toBe(true);
    expect(edges.delete(next)).toBe(false);
    expect(edges.size).toBe(0);
    edges.add(next);
    edges.clear();
    expect(node.delegatedUnders.size).toBe(0);
    const legacy = await parseRdf(policy(true, true));
    const legacyEdges = defined(wrapPolicy(legacy).policies()[0]).delegatedUnders;
    expect(legacyEdges.delete(defined([...legacyEdges][0]))).toBe(true);
    expect(legacyEdges.size).toBe(0);
    const mixed = await parseRdf(
      policy(true, true, `<${LEAF}> <${ODRLD}delegatedUnder> <${next.value}> .`),
    );
    const mixedEdges = defined(wrapPolicy(mixed).policies()[0]).delegatedUnders;
    expect(mixedEdges.delete(next)).toBe(true);
    expect(mixedEdges.size).toBe(0);
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])("reads parent legacy=%s and depth legacy=%s, then emits legacy wire terms", async (legacyParent, legacyDepth) => {
    const parsed = defined(await parsePolicy(policy(legacyParent, legacyDepth)));
    expect(parsed.delegatedUnder).toBe(ROOT);
    expect(parsed.permissions?.[0]?.constraints?.[0]?.leftOperand).toBe("delegationDepth");
    for (const output of [await policyToTurtle(parsed), JSON.stringify(policyToJsonLd(parsed))]) {
      expect(output).toContain(LEGACY);
      expect(output).not.toContain(ODRLD);
      expect(output).toContain(ODRLD_PROFILE_IRI);
    }
    const root: OdrlPolicy = {
      id: ROOT,
      type: "Agreement",
      assigner: OWNER,
      permissions: [
        { type: "permission", action: "read", target: TARGET, assignee: AGENT },
        {
          type: "permission",
          action: "grantUse",
          target: TARGET,
          assignee: AGENT,
          constraints: [{ leftOperand: "delegationDepth", operator: "lteq", rightOperand: 1 }],
          duties: [{ action: "nextPolicy", target: LEAF }],
        },
      ],
    };
    const result = evaluateDelegated([root, parsed], {
      action: "read",
      target: TARGET,
      agent: DELEGATE,
    });
    // The reserved depth operand on the read rule has no request value. Both
    // aliases must retain that restriction rather than dropping the constraint.
    expect(result).toMatchObject({ decision: "deny" });
    expect(result.reason).toContain("Leaf policy");
  });

  it("deduplicates equal mixed parent edges and rejects conflicting or malformed edges", async () => {
    expect(
      defined(
        await parsePolicy(policy(true, true, `<${LEAF}> <${ODRLD}delegatedUnder> <${ROOT}> .`)),
      ).delegatedUnder,
    ).toBe(ROOT);
    expect(
      await parsePolicy(
        policy(true, false, `<${LEAF}> <${ODRLD}delegatedUnder> <https://example.org/other> .`),
      ),
    ).toBeUndefined();
    expect(
      await parsePolicy(policy(false, false, `<${LEAF}> <${LEGACY}delegatedUnder> "bad" .`)),
    ).toBeUndefined();
  });
});
