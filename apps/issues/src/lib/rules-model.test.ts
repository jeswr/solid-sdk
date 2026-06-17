// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect } from "vitest";
import { Store, DataFactory } from "n3";
import { Tracker } from "./issue";
import { odrl, tm, rdf } from "./vocab";

const DOC = "https://pod.example/issues/tracker.ttl";
const TRACKER = `${DOC}#this`;

const mkTracker = () => {
  const store = new Store();
  const tracker = new Tracker(TRACKER, store, DataFactory);
  tracker.configure("Demo");
  return { store, tracker };
};

describe("automation rule model — persist + parse round-trip (#112)", () => {
  it("defineRule persists a tm:Rule (trigger/action/value/condition) and rules reads it back", () => {
    const { store, tracker } = mkTracker();
    const def = tracker.defineRule({
      enabled: true,
      trigger: "OnStatusChange",
      action: "SetPriority",
      actionValue: "high",
      condition: { leftOperand: odrl("purpose"), operator: odrl("eq"), rightOperand: "medium" },
    });
    expect(def.iri.startsWith(`${DOC}#rule-`)).toBe(true);

    const [read] = tracker.rules;
    expect(read).toEqual({
      iri: def.iri,
      enabled: true,
      trigger: "OnStatusChange",
      action: "SetPriority",
      actionValue: "high",
      condition: { leftOperand: odrl("purpose"), operator: odrl("eq"), rightOperand: "medium" },
    });

    // Trigger/action are stored as tm: coded-value IRIs; the tracker links via tm:rule.
    const triggerIri = [...store.match(DataFactory.namedNode(def.iri), DataFactory.namedNode(tm("trigger")))][0]?.object.value;
    expect(triggerIri).toBe(tm("OnStatusChange"));
    const linked = [...store.match(DataFactory.namedNode(TRACKER), DataFactory.namedNode(tm("rule")))].map((q) => q.object.value);
    expect(linked).toContain(def.iri);

    // The condition is a real odrl:Constraint node (a fragment of the rule).
    const condNode = `${def.iri}-cond`;
    const condTypes = [...store.match(DataFactory.namedNode(condNode), DataFactory.namedNode(rdf("type")))].map((q) => q.object.value);
    expect(condTypes).toContain(odrl("Constraint"));
  });

  it("a rule with no condition round-trips (always-applies on its trigger)", () => {
    const { tracker } = mkTracker();
    const def = tracker.defineRule({ enabled: true, trigger: "OnCreated", action: "AddComment", actionValue: "Welcome" });
    const [read] = tracker.rules;
    expect(read.condition).toBeUndefined();
    expect(read).toMatchObject({ trigger: "OnCreated", action: "AddComment", actionValue: "Welcome" });
    expect(def.iri).toBe(read.iri);
  });

  it("defineRule by existing IRI overwrites in place and clears the stale condition fragment", () => {
    const { store, tracker } = mkTracker();
    const first = tracker.defineRule({
      enabled: true,
      trigger: "OnStatusChange",
      action: "SetPriority",
      actionValue: "high",
      condition: { leftOperand: odrl("purpose"), operator: odrl("eq"), rightOperand: "low" },
    });
    tracker.defineRule({ iri: first.iri, enabled: false, trigger: "OnCreated", action: "AddComment", actionValue: "hi" });
    const rules = tracker.rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ iri: first.iri, enabled: false, trigger: "OnCreated", action: "AddComment" });
    expect(rules[0].condition).toBeUndefined();
    // The old condition node's triples are gone.
    const condQuads = [...store.match(DataFactory.namedNode(`${first.iri}-cond`))];
    expect(condQuads).toHaveLength(0);
  });

  it("removeRule drops the node, its condition fragment, and the tracker link", () => {
    const { store, tracker } = mkTracker();
    const def = tracker.defineRule({
      enabled: true,
      trigger: "OnDueDatePassed",
      action: "SetPriority",
      actionValue: "high",
      condition: { leftOperand: odrl("recipient"), operator: odrl("eq"), rightOperand: "https://a.example/#me" },
    });
    tracker.removeRule(def.iri);
    expect(tracker.rules).toHaveLength(0);
    expect([...store.match(DataFactory.namedNode(def.iri))]).toHaveLength(0);
    expect([...store.match(DataFactory.namedNode(`${def.iri}-cond`))]).toHaveLength(0);
    expect([...store.match(DataFactory.namedNode(TRACKER), DataFactory.namedNode(tm("rule")))]).toHaveLength(0);
  });

  it("a malformed rule (missing trigger) is skipped on read; a disabled flag round-trips", () => {
    const { store, tracker } = mkTracker();
    // Hand-link a rule node with NO trigger via the public define then strip it —
    // simulate a partial/corrupt rule by writing only an action onto a #rule- node.
    const bad = `${DOC}#rule-bad`;
    store.addQuad(DataFactory.namedNode(TRACKER), DataFactory.namedNode(tm("rule")), DataFactory.namedNode(bad));
    store.addQuad(DataFactory.namedNode(bad), DataFactory.namedNode(rdf("type")), DataFactory.namedNode(tm("Rule")));
    store.addQuad(DataFactory.namedNode(bad), DataFactory.namedNode(tm("action")), DataFactory.namedNode(tm("CloseIssue")));
    expect(tracker.rules).toHaveLength(0); // no trigger → skipped

    const def = tracker.defineRule({ enabled: false, trigger: "OnCreated", action: "CloseIssue" });
    expect(tracker.rules.find((r) => r.iri === def.iri)?.enabled).toBe(false);
  });

  it("an untrusted tm:rule link (not a #rule- fragment of this doc) is ignored on read", () => {
    const { store, tracker } = mkTracker();
    const foreign = "https://evil.example/policy.ttl#this";
    store.addQuad(DataFactory.namedNode(TRACKER), DataFactory.namedNode(tm("rule")), DataFactory.namedNode(foreign));
    store.addQuad(DataFactory.namedNode(foreign), DataFactory.namedNode(tm("trigger")), DataFactory.namedNode(tm("OnCreated")));
    store.addQuad(DataFactory.namedNode(foreign), DataFactory.namedNode(tm("action")), DataFactory.namedNode(tm("CloseIssue")));
    expect(tracker.rules).toHaveLength(0);
  });
});
