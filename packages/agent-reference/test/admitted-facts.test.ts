// AUTHORED-BY Codex GPT-6.2 Sol
import { expect, it } from "vitest";
import { digestOf } from "../src/core/canonical.js";
import type { ContextItem } from "../src/gates/common.js";
import { TrustStore } from "../src/mechanisms/trust.js";
import { AgentRuntime } from "../src/runtime/agent.js";
import { MemoryLedger } from "../src/store/ledger.js";
import { MemoryStateStore } from "../src/store/state.js";

it("copies provenance from the same admitted task statements, excluding refused and stale entries", async () => {
  const statement = { value: { label: "Afternoon" } };
  const fact: ContextItem = {
    id: "urn:test:fact",
    label: "Preference",
    claimType: "preference",
    source: "urn:test:issuer",
    subject: "urn:test:owner",
    asOf: "2026-11-01T12:00:00Z",
    method: "reported-by-subject",
    terms: { policy: { id: "urn:test:terms" } },
    admittedPurpose: "urn:test:purpose",
    digest: digestOf(statement),
    statement,
    original: {
      id: "urn:test:original",
      digest: digestOf({ label: "original" }),
      statement: { label: "original" },
      evidence: { role: "credential", format: "jws-compact", value: "fixture" },
    },
    disputedWith: ["urn:test:dispute"],
    kind: "statement",
    accepted: true,
  };
  const store = new MemoryStateStore();
  const state = store.load();
  state.contextItems["urn:test:task"] = [
    { ...fact, id: "urn:test:refused", accepted: false },
    { ...fact, digest: digestOf({ value: "previous" }), statement: { value: "previous" } },
    fact,
  ];
  state.contextItems["urn:test:other-task"] = [{ ...fact, id: "urn:test:other" }];
  store.save(state);
  const runtime = await AgentRuntime.create({
    identity: { actor: "urn:test:agent", party: "urn:test:owner" },
    trust: TrustStore.empty("urn:test:owner"),
    accepted: [],
    handlers: [],
    ledger: new MemoryLedger(),
    gates: { taskId: "urn:test:task" },
    store,
  });
  try {
    expect(runtime.admittedStatements()).toEqual([statement]);
    const facts = runtime.admittedFacts();
    expect(facts).toHaveLength(1);
    const { kind: _kind, accepted: _accepted, ...expected } = fact;
    expect(facts).toEqual([expected]);
    const value = facts[0]?.statement?.value as { label: string };
    value.label = "Changed by caller";
    expect(runtime.admittedFacts()[0]?.statement).toEqual(statement);
  } finally {
    runtime.close();
  }
});
