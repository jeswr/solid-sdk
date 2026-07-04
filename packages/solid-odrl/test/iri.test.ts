// AUTHORED-BY Claude Fable 5
//
// Regression tests for the n3.Writer IRI-injection class. `n3.Writer` emits a
// NamedNode's value VERBATIM between angle brackets and does NOT escape the Turtle
// IRIREF-forbidden chars, so an untrusted IRI containing `>` (or a space) could
// break out of `<...>` and inject arbitrary triples. These tests drive the PUBLIC
// serialise API (`policyToTurtle`) with a hostile assignee + rule.target, re-parse
// with an independent n3 Parser, and assert the injected triples never materialise
// — while a legitimate `urn:` policy id still round-trips.

import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/evaluate.js";
import { escapeIri, safeHttpIri, safeIri } from "../src/iri.js";
import {
  OdrlSerializationError,
  parsePolicy,
  policyToJsonLd,
  policyToRdf,
  policyToTurtle,
} from "../src/policy.js";
import type { OdrlPolicy } from "../src/types.js";
import { ODRL_RIGHT_OPERAND } from "../src/vocab.js";

// A classic breakout payload: closes the target `<...>`, ends the current triple,
// then opens an entirely new `<s2> <p2> <o2>` triple. If any write site forwards
// the raw string to n3.Writer, `<https://evil/s2>` appears as a NEW subject.
const INJECTION = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";

const AGENT = "https://bob.example/profile/card#me";
// Non-http (yet syntactically valid) IRIs in http-contract fields: `safeHttpIri`
// rejects them, so they must never be silently dropped-to-wildcard.
const BAD_TARGET = "urn:evil:any-resource";
const BAD_ASSIGNEE = "urn:evil:any-agent";

describe("IRI-injection hardening (n3.Writer breakout)", () => {
  it("REFUSES a hostile assignee or rule.target (exact-match field, reject-if-would-mutate)", () => {
    // target/assignee are evaluation-critical exact-match fields: a breakout payload
    // needs escaping, so it is rejected outright (fail-closed) \u2014 never serialised.
    const withTarget: OdrlPolicy = {
      id: "https://alice.example/policies/p1",
      type: "Set",
      permissions: [{ type: "permission", action: "read", target: INJECTION }],
    };
    const withAssignee: OdrlPolicy = {
      id: "https://alice.example/policies/p1",
      type: "Set",
      permissions: [{ type: "permission", action: "read", assignee: INJECTION }],
    };
    expect(() => policyToTurtle(withTarget)).toThrow(OdrlSerializationError);
    expect(() => policyToTurtle(withAssignee)).toThrow(OdrlSerializationError);
  });

  it("REFUSES an IRI-valued constraint operand whose escaping would MUTATE it (was: silently escaped)", () => {
    // A constraint right-operand for an IRI-valued left-operand (recipient/purpose/
    // spatial/systemDevice) is EVALUATION-CRITICAL: evaluate() compares it by EXACT
    // STRING. So \u2014 like target/assignee \u2014 a value escaping would mutate (INJECTION
    // carries `>` + spaces) is REJECTED, not silently escaped. Silently escaping it
    // would let the SAME policy decide differently in-memory vs after a
    // serialise\u2192parse round-trip (a neq/isNoneOf widening). Fail-closed on all three
    // serialisers so a refused policy can't be smuggled out in any form.
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p1",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [{ leftOperand: "recipient", operator: "eq", rightOperand: INJECTION }],
        },
      ],
    };
    expect(() => policyToTurtle(policy)).toThrow(OdrlSerializationError);
    expect(() => policyToRdf(policy)).toThrow(OdrlSerializationError);
    expect(() => policyToJsonLd(policy)).toThrow(OdrlSerializationError);
  });

  it("a SCHEMELESS constraint operand carrying breakout octets is a quoted literal \u2014 no injected triple", async () => {
    // A schemeless value on an IRI-valued left-operand is NOT an IRI: it becomes a
    // (typed/plain) LITERAL, which n3.Writer quotes + escapes, so a breakout payload
    // cannot inject a triple. This is the surviving escape-path (literals), distinct
    // from the rejected IRI-operand path above.
    const literalPayload = 'evil> . <https://evil/s2> <https://evil/p2> "x';
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p1",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [{ leftOperand: "purpose", operator: "eq", rightOperand: literalPayload }],
        },
      ],
    };

    const turtle = await policyToTurtle(policy);
    const quads = new Parser().parse(turtle);

    // The attacker's injected subject must NOT exist.
    expect(quads.filter((q) => q.subject.value === "https://evil/s2")).toHaveLength(0);
    // No NamedNode carries a raw IRIREF-forbidden octet.
    for (const q of quads) {
      for (const t of [q.subject, q.predicate, q.object]) {
        if (t.termType === "NamedNode") {
          // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting NO IRIREF-forbidden octet survived.
          expect(t.value).not.toMatch(/[\u0000-\u0020<>"{}|^`\\]/);
        }
      }
    }
    // The payload survives verbatim as a Literal object (quoted, not injected).
    const litValues = quads
      .filter((q) => q.object.termType === "Literal")
      .map((q) => q.object.value);
    expect(litValues).toContain(literalPayload);
    // Structural integrity: re-parsing yields exactly the quads we lowered.
    expect(quads).toHaveLength(policyToRdf(policy).length);
  });

  it("rejects an exact-match field escaping would mutate; a clean field decides identically in-memory vs round-tripped", async () => {
    const agent = "https://bob.example/profile/card#me";
    // A SPACE in target/assignee would serialise as %20 -> in-memory ("...a b") and
    // round-tripped ("...a%20b") would differ -> the SAME policy could decide
    // differently. Reject it (fail-closed).
    const spacedTarget: OdrlPolicy = {
      id: "https://a.example/p",
      type: "Set",
      permissions: [
        { type: "permission", action: "read", assignee: agent, target: "https://a.example/a b" },
      ],
    };
    const spacedAssignee: OdrlPolicy = {
      id: "https://a.example/p",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          assignee: "https://a.example/x y",
          target: "https://a.example/r",
        },
      ],
    };
    expect(() => policyToTurtle(spacedTarget)).toThrow(OdrlSerializationError);
    expect(() => policyToTurtle(spacedAssignee)).toThrow(OdrlSerializationError);

    // A CLEAN target decides identically in-memory and after serialise->parse.
    const target = "https://a.example/resource";
    const clean: OdrlPolicy = {
      id: "https://a.example/p",
      type: "Set",
      permissions: [{ type: "permission", action: "read", assignee: agent, target }],
    };
    const parsed = (await parsePolicy(await policyToTurtle(clean))) as OdrlPolicy;
    const hit = { agent, action: "read" as const, target };
    expect(evaluate(clean, hit).decision).toBe("permit");
    expect(evaluate(parsed, hit).decision).toBe(evaluate(clean, hit).decision);
    const miss = { agent, action: "read" as const, target: "https://a.example/other" };
    expect(evaluate(parsed, miss).decision).toBe(evaluate(clean, miss).decision);
  });

  it("round-trips a legitimate urn: policy id (scheme-agnostic id survives)", async () => {
    const policy: OdrlPolicy = {
      id: "urn:uuid:2f3a9c1e-0b6d-4d2a-9f11-7c5e8a0b1d23",
      type: "Set",
      permissions: [{ type: "permission", action: "read" }],
    };

    const turtle = await policyToTurtle(policy);
    const parsed = await parsePolicy(turtle);
    expect(parsed?.id).toBe("urn:uuid:2f3a9c1e-0b6d-4d2a-9f11-7c5e8a0b1d23");
  });

  it("escapeIri percent-encodes only the IRIREF-forbidden octets, scheme-agnostic", () => {
    expect(escapeIri("urn:uuid:abc")).toBe("urn:uuid:abc");
    expect(escapeIri("https://ok.example/path#frag")).toBe("https://ok.example/path#frag");
    expect(escapeIri("https://evil/x> <y")).toBe("https://evil/x%3E%20%3Cy");
    expect(escapeIri("a b")).toBe("a%20b");
    expect(escapeIri(`x${String.fromCharCode(0)}y`)).toBe("x%00y");
  });

  it("safeHttpIri normalises http(s) and drops non-http / unparseable input", () => {
    expect(safeHttpIri("https://ok.example/a")).toBe("https://ok.example/a");
    expect(safeHttpIri("urn:uuid:abc")).toBeUndefined();
    expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpIri("not a url")).toBeUndefined();
    expect(safeHttpIri(undefined)).toBeUndefined();
    // Breakout octets that survive the URL parser (| ^ `) are explicitly encoded.
    expect(safeHttpIri("https://ok.example/a|b^c`d")).toBe("https://ok.example/a%7Cb%5Ec%60d");
  });

  it("safeHttpIri encodes the FULL IRIREF-forbidden set (incl. { } left raw in a fragment)", () => {
    // The URL parser leaves `{` `}` raw in the fragment; the escapeIri final pass
    // must still encode them so no IRIREF-forbidden octet survives.
    expect(safeHttpIri("https://ok.example/p#a{b}c")).toBe("https://ok.example/p#a%7Bb%7Dc");
    expect(safeHttpIri("https://ok.example/p#x{y}|^`z")).not.toMatch(/[ - <>"{}|^`\\]/);
  });

  it("safeIri is scheme-agnostic: keeps urn:/did: as IRIs, escapes breakouts, rejects schemeless", () => {
    expect(safeIri("urn:example:42")).toBe("urn:example:42");
    expect(safeIri("did:web:example.com")).toBe("did:web:example.com");
    expect(safeIri("https://ok.example/a")).toBe("https://ok.example/a");
    expect(safeIri("urn:evil> <x")).toBe("urn:evil%3E%20%3Cx");
    expect(safeIri("just-a-string")).toBeUndefined(); // no scheme → literal
    expect(safeIri("2027-01-01T00:00:00Z")).toBeUndefined(); // leading digit → not a scheme
  });

  it("safeHttpIri escapes FIRST + emits the validated string — no WHATWG normalisation leak", () => {
    // A backslash must NEVER be reinterpreted as `/`. In the PATH it is emitted as
    // %5C (host preserved, not split into a new segment)…
    expect(safeHttpIri("https://example.com/a\\b")).toBe("https://example.com/a%5Cb");
    // …and in the AUTHORITY the `\`→`/` host-confusion is refused outright (the
    // %5C is not a valid host code point), so it can never resolve to host "ex".
    expect(safeHttpIri("https://ex\\ample.com")).toBeUndefined();
    // A tab in the authority is refused; a newline in the path is %0A-encoded (never
    // silently stripped, which is what the WHATWG parser would do).
    expect(safeHttpIri("https://ex\tample.com")).toBeUndefined();
    expect(safeHttpIri("https://example.com/a\nb")).toBe("https://example.com/a%0Ab");
    // A leading C0/space is rejected (the parser would trim it and validate a
    // different string).
    expect(safeHttpIri(" https://example.com")).toBeUndefined();
  });

  it("safeHttpIri preserves lexical identity — :443, host case, dot-segments survive", () => {
    expect(safeHttpIri("https://example.com:443/a")).toBe("https://example.com:443/a");
    expect(safeHttpIri("https://Example.COM/A")).toBe("https://Example.COM/A");
    expect(safeHttpIri("https://example.com/a/../b")).toBe("https://example.com/a/../b");
  });

  it("a lexically-preserved target still matches in evaluate() after a serialise→parse round-trip", async () => {
    // The regression a `.href` canonicalisation would cause: `:443` stripped ⇒ the
    // stored target no longer exact-string-matches the request ⇒ a silent auth gap.
    const target = "https://example.com:443/reports/q3.ttl";
    const agent = "https://bob.example/profile/card#me";
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p",
      type: "Set",
      permissions: [{ type: "permission", action: "read", assignee: agent, target }],
    };
    expect(evaluate(policy, { agent, action: "read", target }).decision).toBe("permit");
    const parsed = await parsePolicy(await policyToTurtle(policy));
    expect(evaluate(parsed as OdrlPolicy, { agent, action: "read", target }).decision).toBe(
      "permit",
    );
  });

  it("a urn:/did: constraint right-operand stays a NamedNode; a plain string is a literal", async () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          constraints: [
            { leftOperand: "recipient", operator: "eq", rightOperand: "urn:example:party:42" },
            { leftOperand: "recipient", operator: "eq", rightOperand: "did:web:example.com" },
            { leftOperand: "purpose", operator: "eq", rightOperand: "just-a-string" },
          ],
        },
      ],
    };

    const termTypeByValue = new Map(
      policyToRdf(policy)
        .filter((q) => q.predicate.value === ODRL_RIGHT_OPERAND)
        .map((q) => [q.object.value, q.object.termType]),
    );
    // The regression this guards: non-http absolute IRIs must NOT be demoted to
    // string literals.
    expect(termTypeByValue.get("urn:example:party:42")).toBe("NamedNode");
    expect(termTypeByValue.get("did:web:example.com")).toBe("NamedNode");
    expect(termTypeByValue.get("just-a-string")).toBe("Literal");

    // JSON-LD mirrors the RDF path.
    const doc = policyToJsonLd(policy);
    const jsonConstraints = (doc.permission as Array<Record<string, unknown>>)[0]
      .constraint as Array<Record<string, unknown>>;
    const ros = jsonConstraints.map((c) => c.rightOperand);
    expect(ros).toContainEqual({ "@id": "urn:example:party:42" });
    expect(ros).toContainEqual({ "@id": "did:web:example.com" });
    expect(ros).toContain("just-a-string");

    // And the IRI survives a Turtle round-trip.
    const parsed = await parsePolicy(await policyToTurtle(policy));
    const parsedValues = (parsed?.permissions?.[0]?.constraints ?? []).map((c) => c.rightOperand);
    expect(parsedValues).toContain("urn:example:party:42");
  });

  it("a clean IRI operand under neq decides IDENTICALLY in-memory vs round-tripped (no widening)", async () => {
    // The reviewer's exact concern: a NEGATIVE operator (neq) over an IRI operand.
    // Had a mutating operand been silently escaped, an excluded recipient would slip
    // past neq after a round-trip (widening). A CLEAN operand is byte-identical
    // across the round-trip, so the deny/permit decision is the SAME before + after.
    const excluded = "https://carol.example/profile/card#me";
    const other = "https://dave.example/profile/card#me";
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/neq",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: "https://alice.example/notes/n.ttl",
          constraints: [{ leftOperand: "recipient", operator: "neq", rightOperand: excluded }],
        },
      ],
    };
    const parsed = (await parsePolicy(await policyToTurtle(policy))) as OdrlPolicy;

    const base = { action: "read" as const, target: "https://alice.example/notes/n.ttl" };
    // recipient == excluded → neq unsatisfied → notApplicable, BOTH ways (the guard).
    const asExcluded = { ...base, agent: excluded, attributes: { recipient: excluded } };
    expect(evaluate(policy, asExcluded).decision).toBe("notApplicable");
    expect(evaluate(parsed, asExcluded).decision).toBe(evaluate(policy, asExcluded).decision);
    // recipient == other → neq satisfied → permit, BOTH ways.
    const asOther = { ...base, agent: other, attributes: { recipient: other } };
    expect(evaluate(policy, asOther).decision).toBe("permit");
    expect(evaluate(parsed, asOther).decision).toBe(evaluate(policy, asOther).decision);
  });

  it("a clean IRI operand under isNoneOf decides IDENTICALLY in-memory vs round-tripped (no widening)", async () => {
    const excludedA = "https://carol.example/profile/card#me";
    const excludedB = "https://erin.example/profile/card#me";
    const other = "https://dave.example/profile/card#me";
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/none",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: "https://alice.example/notes/n.ttl",
          constraints: [
            {
              leftOperand: "recipient",
              operator: "isNoneOf",
              rightOperand: [excludedA, excludedB],
            },
          ],
        },
      ],
    };
    const parsed = (await parsePolicy(await policyToTurtle(policy))) as OdrlPolicy;

    const base = { action: "read" as const, target: "https://alice.example/notes/n.ttl" };
    // recipient in the excluded set → isNoneOf unsatisfied → notApplicable, BOTH ways.
    const asExcluded = { ...base, agent: excludedA, attributes: { recipient: excludedA } };
    expect(evaluate(policy, asExcluded).decision).toBe("notApplicable");
    expect(evaluate(parsed, asExcluded).decision).toBe(evaluate(policy, asExcluded).decision);
    // recipient outside the set → isNoneOf satisfied → permit, BOTH ways.
    const asOther = { ...base, agent: other, attributes: { recipient: other } };
    expect(evaluate(policy, asOther).decision).toBe("permit");
    expect(evaluate(parsed, asOther).decision).toBe(evaluate(policy, asOther).decision);
  });

  it("REFUSES an IRI operand with a space under a negative operator (neq / isNoneOf)", () => {
    // The precise widening surface: a space-carrying IRI operand under a NEGATIVE
    // operator must be refused at serialise time (fail-closed), never escaped.
    const spaced = "https://carol.example/a b";
    const neqPolicy: OdrlPolicy = {
      id: "https://alice.example/policies/neq-space",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: "https://alice.example/notes/n.ttl",
          constraints: [{ leftOperand: "recipient", operator: "neq", rightOperand: spaced }],
        },
      ],
    };
    const noneOfPolicy: OdrlPolicy = {
      ...neqPolicy,
      id: "https://alice.example/policies/none-space",
      permissions: [
        {
          type: "permission",
          action: "read",
          target: "https://alice.example/notes/n.ttl",
          constraints: [{ leftOperand: "recipient", operator: "isNoneOf", rightOperand: [spaced] }],
        },
      ],
    };
    expect(() => policyToTurtle(neqPolicy)).toThrow(OdrlSerializationError);
    expect(() => policyToJsonLd(neqPolicy)).toThrow(OdrlSerializationError);
    expect(() => policyToTurtle(noneOfPolicy)).toThrow(OdrlSerializationError);
    expect(() => policyToJsonLd(noneOfPolicy)).toThrow(OdrlSerializationError);
  });
});

describe("fail-closed on an unsafe explicit target/assignee (wildcard-broadening)", () => {
  // A MISSING target/assignee is a WILDCARD in the evaluator (a rule with no target
  // matches ANY resource; with no assignee, ANY agent). Silently DROPPING a
  // malformed explicit one would therefore WIDEN the rule — a privilege escalation.
  // The write path must REFUSE instead, for BOTH serialisations.
  it("throws rather than emit a target-less (any-resource) permission [Turtle]", () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p",
      type: "Set",
      permissions: [{ type: "permission", action: "read", assignee: AGENT, target: BAD_TARGET }],
    };
    expect(() => policyToTurtle(policy)).toThrow(OdrlSerializationError);
    expect(() => policyToRdf(policy)).toThrow(OdrlSerializationError);
    expect(() => policyToJsonLd(policy)).toThrow(OdrlSerializationError);
  });

  it("throws rather than emit an assignee-less (any-agent) permission [Turtle + JSON-LD]", () => {
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p",
      type: "Set",
      permissions: [
        {
          type: "permission",
          action: "read",
          assignee: BAD_ASSIGNEE,
          target: "https://alice.example/notes/private.ttl",
        },
      ],
    };
    expect(() => policyToTurtle(policy)).toThrow(OdrlSerializationError);
    expect(() => policyToJsonLd(policy)).toThrow(OdrlSerializationError);
  });

  it("does NOT round-trip an invalid target into a rule that permits ANY resource", async () => {
    // The escalation we are guarding: were the invalid target silently dropped, the
    // round-tripped permission would grant `read` on an UNRELATED resource. Prove the
    // serialisation refuses, so no such wildcard policy can exist.
    const policy: OdrlPolicy = {
      id: "https://alice.example/policies/p",
      type: "Set",
      permissions: [{ type: "permission", action: "read", assignee: AGENT, target: BAD_TARGET }],
    };
    expect(() => policyToTurtle(policy)).toThrow(OdrlSerializationError);

    // A VALID counterpart round-trips and stays scoped to its target (no wildcard).
    const good: OdrlPolicy = {
      ...policy,
      permissions: [
        {
          type: "permission",
          action: "read",
          assignee: AGENT,
          target: "https://alice.example/notes/private.ttl",
        },
      ],
    };
    const parsed = await parsePolicy(await policyToTurtle(good));
    const onOther = evaluate(parsed as OdrlPolicy, {
      agent: AGENT,
      action: "read",
      target: "https://alice.example/OTHER/resource.ttl",
    });
    expect(onOther.decision).toBe("notApplicable"); // scoped, not a wildcard.
  });

  it("JSON-LD emits an escaped @id and never a raw breakout octet, in lock-step with RDF", () => {
    const policy: OdrlPolicy = {
      id: "urn:uuid:policy> <injected",
      type: "Set",
      permissions: [{ type: "permission", action: "read", id: "urn:rule> <x" }],
    };
    const doc = policyToJsonLd(policy);
    // id is escaped (scheme-agnostic) — no raw `>`/space/`<` survives.
    expect(doc["@id"]).toBe("urn:uuid:policy%3E%20%3Cinjected");
    const permission = (doc.permission as Array<Record<string, unknown>>)[0];
    expect(permission["@id"]).toBe("urn:rule%3E%20%3Cx");
    // The whole JSON serialisation carries no raw IRIREF-forbidden octet in an @id.
    const json = JSON.stringify(doc);
    expect(json).not.toContain("policy> <injected");
    expect(json).not.toContain("rule> <x");
  });
});
