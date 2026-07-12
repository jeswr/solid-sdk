// AUTHORED-BY Claude Opus 4.8
//
// Direct unit tests for the inbox's newest-first comparator. Driven with hand-
// built MessageView arrays (no RDF, no store) so EVERY comparator branch runs
// deterministically — including both orderings of dated-vs-undated, which the
// store's arbitrary message-iteration order can't be relied on to produce.

import { describe, expect, it } from "vitest";
import { type MessageView, newestFirst } from "../../src/ui/useInbox.js";

/** A minimal MessageView with just an id + optional date (the sort keys). */
function msg(id: string, date: Date | undefined): MessageView {
  return {
    id,
    subject: id,
    body: undefined,
    sender: undefined,
    to: [],
    cc: [],
    date,
    isRead: false,
  };
}

const D_OLD = new Date("2026-06-10T00:00:00Z");
const D_NEW = new Date("2026-06-12T00:00:00Z");

describe("newestFirst", () => {
  it("orders two dated messages newest-first", () => {
    const sorted = newestFirst([msg("old", D_OLD), msg("new", D_NEW)]);
    expect(sorted.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("sorts an undated message after a dated one (undated as first arg → +1)", () => {
    const sorted = newestFirst([msg("undated", undefined), msg("dated", D_OLD)]);
    expect(sorted.map((m) => m.id)).toEqual(["dated", "undated"]);
  });

  it("sorts a dated message before an undated one (undated as second arg → -1)", () => {
    const sorted = newestFirst([msg("dated", D_OLD), msg("undated", undefined)]);
    expect(sorted.map((m) => m.id)).toEqual(["dated", "undated"]);
  });

  it("treats two undated messages as equal (the 0 branch, stable order)", () => {
    const sorted = newestFirst([msg("a", undefined), msg("b", undefined)]);
    expect(sorted.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const input = [msg("old", D_OLD), msg("new", D_NEW)];
    const before = input.map((m) => m.id);
    newestFirst(input);
    expect(input.map((m) => m.id)).toEqual(before);
  });
});
