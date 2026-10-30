// AUTHORED-BY Codex GPT-6.1-Sol
/* biome-ignore-all lint/style/noNonNullAssertion: Tests assert complete expected thread shapes and fixture IDs. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildThreads, type ThreadMessage, type ThreadNode } from "../src/apps/mail/lib/threading";

function message(id: string, options: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    messageId: `<${id}@example.org>`,
    subject: `Topic ${id}`,
    timestamp: 0,
    from: "Mira <mira@example.org>",
    to: ["Rowan <rowan@example.org>"],
    text: `Message ${id}`,
    isRead: true,
    ...options,
  };
}

function shape(node: ThreadNode): unknown {
  return [node.message?.id ?? null, ...node.children.map(shape)];
}

describe("JWZ reference containers", () => {
  it("returns no threads for an empty mailbox", () => {
    expect(buildThreads([])).toEqual([]);
  });

  it("uses References before In-Reply-To, reconstructs ancestry, and keeps changed subjects", () => {
    const a = message("a");
    const b = message("b", { timestamp: 1, references: [a.messageId!] });
    const c = message("c", {
      timestamp: 2,
      references: [a.messageId!, b.messageId!],
      inReplyTo: "<unrelated@example.org>",
    });
    const [thread] = buildThreads([c, a, b]);
    expect(shape(thread!.root)).toEqual(["a", ["b", ["c"]]]);
    expect(thread!.messages).toEqual([a, b, c]);
    expect(thread!.subject).toBe("topic a");
  });

  it("uses In-Reply-To with absent/empty References and keeps missing-ID messages", () => {
    const root = message("root");
    const a = message("a", { inReplyTo: root.messageId!, references: [] });
    const b = message("b", { inReplyTo: root.messageId! });
    const { messageId: _messageId, ...anonymous } = message("anonymous");
    const threads = buildThreads([root, a, b, anonymous]);
    expect(threads).toHaveLength(2);
    expect(shape(threads[0]!.root)).toEqual(["root", ["a"], ["b"]]);
    expect(shape(threads[1]!.root)).toEqual(["anonymous"]);
  });

  it("fills placeholders even when children sort before their real parents", () => {
    const a = message("a", { timestamp: 10 });
    const b = message("b", { references: [a.messageId!] });
    expect(shape(buildThreads([a, b])[0]!.root)).toEqual(["a", ["b"]]);
  });

  it("promotes a single orphan and retains a missing common ancestor for siblings", () => {
    const orphan = message("orphan", { references: ["<gone@example.org>"] });
    expect(shape(buildThreads([orphan])[0]!.root)).toEqual(["orphan"]);
    const a = message("a", { references: ["<gone@example.org>"] });
    const b = message("b", { references: ["<gone@example.org>"] });
    expect(shape(buildThreads([b, a])[0]!.root)).toEqual([null, ["a"], ["b"]]);
  });

  it("prunes interior dummy chains and empty dummy leaves", () => {
    const a = message("a");
    const b = message("b", {
      references: [a.messageId!, "<missing@example.org>", "<middle@example.org>"],
      timestamp: 1,
    });
    expect(shape(buildThreads([a, b])[0]!.root)).toEqual(["a", ["b"]]);
    // A reference creates the dummy, but its eventual message overrides that parent.
    const c = message("c", { references: ["<leaf@example.org>", "<a@example.org>"] });
    expect(shape(buildThreads([c, message("a", { timestamp: 2 })])[0]!.root)).toEqual(["a", ["c"]]);
  });

  it("keeps an established inferred parent when another chain omits an ancestor", () => {
    const a = message("a", { references: ["<x@example.org>", "<y@example.org>"] });
    const b = message("b", { references: ["<z@example.org>", "<y@example.org>"] });
    const threads = buildThreads([a, b]);
    expect(threads).toHaveLength(1);
    expect(shape(threads[0]!.root)).toEqual([null, ["a"], ["b"]]);
  });

  it("replaces inferred parents using a message's own ancestry", () => {
    const a = message("a", { references: ["<x@example.org>", "<b@example.org>"] });
    const b = message("b", { timestamp: 1, references: ["<c@example.org>"] });
    const c = message("c", { timestamp: 2 });
    const threads = buildThreads([a, b, c]);
    expect(threads).toHaveLength(1);
    expect(shape(threads[0]!.root)).toEqual(["c", ["b", ["a"]]]);
  });

  it("skips self-links, repeated references, and loops without losing messages", () => {
    const a = message("a", { references: ["<a@example.org>"] });
    expect(shape(buildThreads([a])[0]!.root)).toEqual(["a"]);
    const b = message("b", {
      references: ["<x@example.org>", "<x@example.org>", "<y@example.org>", "<x@example.org>"],
    });
    expect(buildThreads([b])[0]!.messages).toEqual([b]);
    const cycle = [
      message("a", { inReplyTo: "<c@example.org>" }),
      message("b", { inReplyTo: "<a@example.org>", timestamp: 1 }),
      message("c", { inReplyTo: "<b@example.org>", timestamp: 2 }),
    ];
    expect(shape(buildThreads(cycle)[0]!.root)).toEqual(["c", ["a", ["b"]]]);
  });

  it("retains duplicate Message-IDs and targets the first canonical message", () => {
    const a = message("a", { messageId: "<shared@example.org>" });
    const b = message("b", { messageId: a.messageId!, timestamp: 1 });
    const c = message("c", { inReplyTo: a.messageId!, timestamp: 2 });
    const threads = buildThreads([c, b, a]);
    expect(threads.map((thread) => shape(thread.root))).toEqual([["a", ["c"]], ["b"]]);
    expect(buildThreads([b, c, a])).toEqual(threads);
  });

  it("gives duplicates their own ancestry and preserves Message-ID case", () => {
    const a = message("a", { messageId: "<Shared@example.org>" });
    const b = message("b", {
      messageId: a.messageId!,
      references: ["<c@example.org>"],
      timestamp: 1,
    });
    const c = message("c", { timestamp: 2, inReplyTo: "<shared@example.org>" });
    expect(buildThreads([a, b, c]).map((thread) => shape(thread.root))).toEqual([
      ["c", ["b"]],
      ["a"],
    ]);
  });

  it("handles deep threads without recursive traversal", () => {
    const messages = Array.from({ length: 4000 }, (_, i) =>
      message(String(i), {
        timestamp: i,
        ...(i > 0 ? { inReplyTo: `<${i - 1}@example.org>` } : {}),
      }),
    );
    const threads = buildThreads(messages);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.messages).toEqual(messages);
    expect(threads[0]!.root.children[0]!.message).toBe(messages[1]);
  });

  it("retains every message once and is permutation invariant under adversarial headers", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            header: fc.option(fc.integer({ min: 0, max: 8 }), { nil: undefined }),
            references: fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 6 }),
            subject: fc.constantFrom("Plans", "Re: Plans", "AW: [club] Plans", "", "Other"),
            timestamp: fc.integer({ min: -5, max: 5 }),
          }),
          { maxLength: 30 },
        ),
        (values) => {
          const messages = values.map(({ header, references, subject, timestamp }, i) => {
            const { messageId: _messageId, ...base } = message(`resource-${i}`);
            return Object.freeze({
              ...base,
              ...(header === undefined ? {} : { messageId: `<${header}@example.org>` }),
              references: Object.freeze(references.map((id) => `<${id}@example.org>`)),
              subject,
              timestamp,
            });
          });
          const threads = buildThreads(Object.freeze(messages));
          const expected = messages.map((m) => m.id).sort();
          expect(threads.flatMap((thread) => thread.messages.map((m) => m.id)).sort()).toEqual(
            expected,
          );
          const nodes = threads.map((thread) => thread.root);
          const visited = new Set<ThreadNode>();
          const treeIds: string[] = [];
          for (const node of nodes) {
            expect(visited.has(node)).toBe(false);
            visited.add(node);
            if (node.message) treeIds.push(node.message.id);
            for (const child of node.children) nodes.push(child);
          }
          expect(treeIds.sort()).toEqual(expected);
          expect(buildThreads([...messages].reverse())).toEqual(threads);
        },
      ),
      { seed: 2633, numRuns: 200 },
    );
  });
});

describe("subject fallback", () => {
  it("joins a reply root to the original while preserving explicit reply ancestry", () => {
    const a = message("a", { subject: "Re: [club] Plans" });
    const b = message("b", { subject: "Plans", timestamp: 1 });
    const c = message("c", { subject: "New title", inReplyTo: a.messageId!, timestamp: 2 });
    expect(shape(buildThreads([a, b, c])[0]!.root)).toEqual(["b", ["a", ["c"]]]);
  });

  it("does not infer parentage between original subjects or between two replies", () => {
    for (const subject of ["Plans", "Re: Plans"]) {
      const messages = ["a", "b", "c"].map((id) => message(id, { subject }));
      expect(shape(buildThreads(messages)[0]!.root)).toEqual([null, ["a"], ["b"], ["c"]]);
    }
  });

  it("prefers dummy roots, merges two dummy roots, and appends a real root", () => {
    const a = message("a", { subject: "Plans", references: ["<x@example.org>"] });
    const b = message("b", { subject: "Different", references: ["<x@example.org>"] });
    const c = message("c", { subject: "Plans", references: ["<y@example.org>"] });
    const d = message("d", { subject: "Other", references: ["<y@example.org>"] });
    const real = message("0", { subject: "Plans" });
    expect(shape(buildThreads([a, b, c, d, real])[0]!.root)).toEqual([
      null,
      ["0"],
      ["a"],
      ["b"],
      ["c"],
      ["d"],
    ]);
  });

  it("does not merge blank normalized subjects", () => {
    const messages = [message("a", { subject: "" }), message("b", { subject: "Re: [club]" })];
    expect(buildThreads(messages)).toHaveLength(2);
  });

  it("selects the earliest direct child of a dummy root for subject matching", () => {
    const a = message("a", { timestamp: 10, references: ["<x@example.org>"] });
    const b = message("b", { timestamp: 1, references: ["<x@example.org>"] });
    const c = message("c", { timestamp: 0, subject: "topic b" });
    expect(buildThreads([a, b, c])[0]!.messages.map((m) => m.id)).toEqual(["c", "b", "a"]);
  });
});

describe("thread summaries", () => {
  it("sorts by latest message and summarizes participants, unread messages, and plain text", () => {
    const a = message("z", { timestamp: 1, cc: ["Sage <sage@example.org>"] });
    const b = message("a", {
      timestamp: 3,
      inReplyTo: a.messageId!,
      from: "Rowan <rowan@example.org>",
      to: ["Mira <mira@example.org>"],
      cc: [],
      isRead: false,
      text: "  Thanks\n\tMira! 😀  ",
    });
    const c = message("c", { timestamp: 2 });
    const [thread, other] = buildThreads([b, c, a]);
    expect(thread).toMatchObject({
      id: "a",
      latestTimestamp: 3,
      participants: [
        "Mira <mira@example.org>",
        "Rowan <rowan@example.org>",
        "Sage <sage@example.org>",
      ],
      unreadCount: 1,
      snippet: "Thanks Mira! 😀",
    });
    expect(other!.id).toBe("c");
  });

  it("breaks time ties by resource ID for messages, children, threads and snippets", () => {
    const z = message("z", { subject: "Plans", isRead: false });
    const a = message("a", { subject: "Plans", isRead: false });
    const m = message("m");
    expect(buildThreads([z, m, a]).map((thread) => thread.id)).toEqual(["a", "m"]);
    const thread = buildThreads([z, a])[0]!;
    expect(shape(thread.root)).toEqual([null, ["a"], ["z"]]);
    expect(thread.messages).toEqual([a, z]);
    expect(thread.snippet).toBe("Message z");
    expect(thread.unreadCount).toBe(2);
  });

  it("truncates at 160 code points without splitting astral characters", () => {
    const thread = buildThreads([message("a", { text: `${"😀".repeat(161)} end` })])[0]!;
    expect(thread.snippet).toBe("😀".repeat(160));
    expect(buildThreads([message("a", { text: " \n " })])[0]!.snippet).toBe("");
  });

  it("preserves exact identities, generic payloads and frozen inputs", () => {
    const a = Object.freeze({
      ...message("a", { from: "Mira@example.org", to: Object.freeze(["mira@example.org"]) }),
      cc: Object.freeze(["Mira@example.org"]),
      references: Object.freeze([]),
      extra: "original payload",
    });
    const input = Object.freeze([a]);
    const result = buildThreads(input);
    expect(result[0]!.messages[0]).toBe(a);
    expect(result[0]!.messages[0]!.extra).toBe("original payload");
    expect(result[0]!.participants).toEqual(["Mira@example.org", "mira@example.org"]);
    result[0]!.messages.pop();
    result[0]!.participants.pop();
    expect(input).toEqual([a]);
    expect(buildThreads(input)[0]!.messages).toEqual([a]);
  });
});
