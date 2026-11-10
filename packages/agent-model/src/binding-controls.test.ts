// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { foldBindingControls } from "./index.js";
import type { ControlStatement } from "./records.js";
import { exampleRecords } from "./testing.js";

const account = {
  ...exampleRecords.account,
  restrictions: { read: false, triage: false, draft: false, send: true },
};
const base = { ...exampleRecords["control-statement"], bindingState: undefined };
const change = (
  id: string,
  restrictions: ControlStatement["restrictions"],
  at = "2026-11-01T12:00:00Z",
): ControlStatement => ({
  ...base,
  id: `urn:statement:${id}`,
  target: account.id,
  createdAt: at,
  restrictions,
});

describe("verified per-field binding log", () => {
  it("reproduces two tabs reading the same snapshot before either writes without widening Send", () => {
    const left = change("read", { read: true }, "2026-11-01T12:00:00.001Z");
    const right = change("send", { send: false });
    const original = structuredClone(account);
    const statements = Object.freeze([left, right]);
    expect(foldBindingControls(account, statements)).toMatchObject({
      restrictions: { read: true, triage: false, draft: false, send: false },
    });
    expect(foldBindingControls(account, [right, left])).toEqual(
      foldBindingControls(account, statements),
    );
    expect(account).toEqual(original);
    expect(statements).toEqual([left, right]);
  });
  it("retains a disconnect alongside later independent toggles, resolving same-field owner intent newest first", () => {
    const earlier = change("read", { read: true });
    const disconnect: ControlStatement = {
      ...change("disconnect", undefined),
      bindingState: "disabled",
    };
    const newer = change("later", { read: false, draft: true }, "2026-11-01T12:00:01Z");
    expect(foldBindingControls(account, [newer, disconnect, earlier])).toMatchObject({
      bindingState: "disabled",
      restrictions: { read: false, triage: false, draft: true, send: true },
    });
  });
  it("orders fractional instants before IRIs and treats timezone-equivalent instants equally", () => {
    const earlier = change("z", { send: true }, "2026-11-01T12:00:00.000000001Z");
    const later = change("a", { send: false }, "2026-11-01T13:00:00.000000002+01:00");
    expect(foldBindingControls(account, [later, earlier]).restrictions.send).toBe(false);
    const equivalent = {
      ...later,
      id: "urn:statement:zz",
      restrictions: { send: true },
      createdAt: "2026-11-01T12:00:00.000000002Z",
    };
    expect(foldBindingControls(account, [equivalent, earlier, later]).restrictions.send).toBe(true);
  });
  it("uses statement IRI as the deterministic tiebreak and ignores other targets and kinds", () => {
    const first = change("a", { send: true });
    const last = change("z", { send: false });
    const unrelated = { ...change("zz", { read: true }), target: "urn:another:account" };
    const halt = { ...change("zzz", { draft: true }), kind: "Halt" as const };
    expect(foldBindingControls(account, [last, first, unrelated, halt]).restrictions.send).toBe(
      false,
    );
    expect(foldBindingControls(account, [first, last, unrelated, halt]).restrictions).toEqual({
      ...account.restrictions,
      send: false,
    });
    expect(foldBindingControls(account, [])).toEqual(account);
    expect(foldBindingControls(account, [first, first])).toEqual(account);
  });
});
