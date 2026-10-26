// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { openConversation } from "../core/conversation.js";
import { domainValue, emptyState, MemoryStateStore } from "../store/state.js";
import { compactState, DEFAULT_RETENTION } from "./retention.js";

const at = "2026-09-01T00:00:00Z";
const now = Date.parse("2026-10-25T00:00:00Z");
const options = { trackHandOff: false, maxClockSkewMs: 0 };

describe("compaction uses exact explicit domain ownership", () => {
  it("compacting urn:case:1 preserves urn:case:10 and all unowned records", () => {
    const state = emptyState();
    for (const id of ["urn:case:1", "urn:case:10"]) {
      state.conversations[id] = {
        ...openConversation({ id, role: "initiator", peer: {}, at }),
        phase: id === "urn:case:1" ? "completed" : "negotiating",
      };
    }
    state.domain = {
      "unrelated-key": { owner: "urn:case:1", value: { remove: true } },
      "terms:urn:case:10": { owner: "urn:case:10", value: { active: true } },
      "legacy:urn:case:1": { retained: true },
      "shared:urn:case:1": ["shared"],
      "primitive:urn:case:1": "legacy",
      "null:urn:case:1": null,
      "foreign:urn:case:1": { owner: "urn:other", value: "keep" },
    };
    const store = new MemoryStateStore();
    store.save(state);
    const reopened = store.load();
    const result = compactState(reopened, now, DEFAULT_RETENTION, options);
    expect(result.removedConversations).toBe(1);
    expect(result.removedDomainKeys).toBe(1);
    expect(reopened.conversations["urn:case:1"]).toBeUndefined();
    expect(reopened.conversations["urn:case:10"]).toBeDefined();
    expect(reopened.domain["unrelated-key"]).toBeUndefined();
    expect(domainValue(reopened.domain["terms:urn:case:10"])).toEqual({ active: true });
    for (const key of [
      "legacy:urn:case:1",
      "shared:urn:case:1",
      "primitive:urn:case:1",
      "null:urn:case:1",
      "foreign:urn:case:1",
    ]) {
      expect(reopened.domain[key]).toEqual(state.domain[key]);
    }
  });

  it("removes only the concluded task's exact ownership", () => {
    const state = emptyState();
    for (const id of ["urn:task:1", "urn:task:10"]) {
      state.tasks[id] = {
        id,
        kind: "local",
        effectKey: `effect:${id}`,
        status: id === "urn:task:1" ? "concluded" : "running",
        createdAt: at,
        updatedAt: at,
      };
    }
    state.domain = {
      removed: { owner: "urn:task:1", value: "done" },
      active: { owner: "urn:task:10", value: "running" },
      "legacy:urn:task:1": { value: "legacy" },
    };
    const report = compactState(state, now, DEFAULT_RETENTION, options);
    expect(report.removedTasks).toBe(1);
    expect(report.removedDomainKeys).toBe(1);
    expect(state.domain.removed).toBeUndefined();
    expect(domainValue(state.domain.active)).toBe("running");
    expect(state.domain["legacy:urn:task:1"]).toEqual({ value: "legacy" });
  });
});
