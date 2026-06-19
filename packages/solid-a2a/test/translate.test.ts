// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// NL → RDF deterministic intent mapping: each core verb maps to the right action
// type + target + params; synonyms; case-insensitivity; unclassifiable input
// returns unresolved (not a throw).
import { describe, expect, it, vi } from "vitest";
import { classifyDeterministic, parseIntent } from "../src/translate.js";
import type { StructuredIntentDraft, TranslateFn } from "../src/types.js";

describe("deterministic intent mapping", () => {
  const cases: Array<{ nl: string; action: string; target?: string }> = [
    {
      nl: "read https://alice.pod/notes.ttl",
      action: "read",
      target: "https://alice.pod/notes.ttl",
    },
    {
      nl: "get https://alice.pod/notes.ttl",
      action: "read",
      target: "https://alice.pod/notes.ttl",
    },
    { nl: "fetch https://alice.pod/x", action: "read", target: "https://alice.pod/x" },
    {
      nl: "create a resource at https://alice.pod/y",
      action: "create",
      target: "https://alice.pod/y",
    },
    { nl: "write https://alice.pod/y", action: "create", target: "https://alice.pod/y" },
    { nl: "put https://alice.pod/y", action: "create", target: "https://alice.pod/y" },
    { nl: "update https://alice.pod/y", action: "update", target: "https://alice.pod/y" },
    { nl: "modify https://alice.pod/y", action: "update", target: "https://alice.pod/y" },
    { nl: "append to https://alice.pod/log", action: "append", target: "https://alice.pod/log" },
    { nl: "delete https://alice.pod/y", action: "delete", target: "https://alice.pod/y" },
    { nl: "remove https://alice.pod/y", action: "delete", target: "https://alice.pod/y" },
    { nl: "list https://alice.pod/photos/", action: "list", target: "https://alice.pod/photos/" },
    {
      nl: "enumerate https://alice.pod/photos/",
      action: "list",
      target: "https://alice.pod/photos/",
    },
    {
      nl: "subscribe to https://alice.pod/inbox/",
      action: "subscribe",
      target: "https://alice.pod/inbox/",
    },
    {
      nl: "watch https://alice.pod/inbox/",
      action: "subscribe",
      target: "https://alice.pod/inbox/",
    },
    { nl: "query https://alice.pod/sparql", action: "query", target: "https://alice.pod/sparql" },
    { nl: "search https://alice.pod/sparql", action: "query", target: "https://alice.pod/sparql" },
    { nl: "find https://alice.pod/sparql", action: "query", target: "https://alice.pod/sparql" },
  ];

  for (const c of cases) {
    it(`maps "${c.nl}" → ${c.action}`, async () => {
      const r = await parseIntent(c.nl);
      expect(r.resolved).toBe(true);
      expect(r.source).toBe("deterministic");
      expect(r.intent?.action).toBe(c.action);
      expect(r.intent?.target).toBe(c.target);
      expect(r.quads.length).toBeGreaterThan(0);
    });
  }

  it("is case-insensitive (READ / Read / read)", async () => {
    for (const verb of ["READ", "Read", "rEaD"]) {
      const r = await parseIntent(`${verb} https://a/x`);
      expect(r.intent?.action).toBe("read");
    }
  });

  it("does not match a verb embedded in a longer word (read in 'ready')", async () => {
    const r = await parseIntent("the system is ready at https://a/x");
    // "ready" must NOT classify as read; no other verb present → unresolved.
    expect(r.resolved).toBe(false);
  });

  it("classifies a grant with recipient + modes from a canonical phrase", async () => {
    const r = await parseIntent(
      "share read and write access to https://alice.pod/notes.ttl with https://bob.pod/me",
    );
    expect(r.resolved).toBe(true);
    expect(r.intent?.action).toBe("grant");
    expect(r.intent?.target).toBe("https://alice.pod/notes.ttl");
    expect(r.intent?.recipient).toBe("https://bob.pod/me");
    expect(r.intent?.modes).toEqual(["Read", "Write"]);
  });

  it("prefers a specific verb over a generic one it contains (append vs add)", async () => {
    const r = await parseIntent("append to https://a/log");
    expect(r.intent?.action).toBe("append");
  });

  it("extracts key=value and key: value parameters", async () => {
    const r = await parseIntent("list https://a/c/ limit=10 order: desc");
    expect(r.intent?.action).toBe("list");
    const params = Object.fromEntries((r.intent?.parameters ?? []).map((p) => [p.key, p.value]));
    expect(params.limit).toBe("10");
    expect(params.order).toBe("desc");
  });

  it("does not capture a URL scheme as a key:value parameter", async () => {
    const r = await parseIntent("read https://a/x");
    // `https` must NOT become a parameter from the `https://` scheme.
    expect((r.intent?.parameters ?? []).some((p) => p.key === "https")).toBe(false);
  });

  it("matches a verb adjacent to punctuation (boundary, not just spaces)", async () => {
    // "read:" — the verb is bounded by ":" not a space; boundaryHit must catch it.
    const colon = await parseIntent("read: https://a/x");
    expect(colon.intent?.action).toBe("read");
    // A verb at the very end of the string.
    const end = await parseIntent("https://a/x please delete");
    expect(end.intent?.action).toBe("delete");
  });

  it("resolves a grant recipient via a 'to <iri>' marker distinct from the target", async () => {
    const r = await parseIntent("grant access to https://bob.pod/me");
    expect(r.intent?.action).toBe("grant");
    // With a single IRI and the grant verb, that IRI is the (first/only) target;
    // the 'to' marker points at it, so there is no separate recipient.
    expect(r.intent?.target).toBe("https://bob.pod/me");
  });

  it("falls back to the second distinct IRI as the grant recipient", async () => {
    const r = await parseIntent("grant https://alice.pod/x https://bob.pod/me read");
    expect(r.intent?.action).toBe("grant");
    expect(r.intent?.target).toBe("https://alice.pod/x");
    expect(r.intent?.recipient).toBe("https://bob.pod/me");
    expect(r.intent?.modes).toEqual(["Read"]);
  });

  it("classifyDeterministic returns undefined for unmatched input", () => {
    expect(classifyDeterministic("the meaning of life")).toBeUndefined();
    expect(classifyDeterministic("   ")).toBeUndefined();
    expect(classifyDeterministic("")).toBeUndefined();
  });

  it("returns an UNRESOLVED result (not a throw) when nothing matches and no translate fn", async () => {
    const r = await parseIntent("ponder the universe");
    expect(r.resolved).toBe(false);
    expect(r.intent).toBeUndefined();
    expect(r.quads).toEqual([]);
    expect(r.reason).toContain("no deterministic verb matched");
  });

  it("throws only for a non-string nl (a programming error)", async () => {
    // @ts-expect-error testing the runtime guard
    await expect(parseIntent(42)).rejects.toBeInstanceOf(TypeError);
  });

  it("mints a deterministic intent id for the same NL", async () => {
    const a = await parseIntent("read https://a/x");
    const b = await parseIntent("read https://a/x");
    expect(a.intent?.id).toBe(b.intent?.id);
  });

  it("mints an http fragment id when given an http baseIRI", async () => {
    const r = await parseIntent("read https://a/x", { baseIRI: "https://alice.pod/agent" });
    expect(r.intent?.id.startsWith("https://alice.pod/agent#intent-")).toBe(true);
  });
});

describe("injected-translate seam", () => {
  it("is NOT called when the deterministic path succeeds", async () => {
    const translate = vi.fn<TranslateFn>(async () => ({ action: "read" }));
    const r = await parseIntent("read https://a/x", { translate });
    expect(r.source).toBe("deterministic");
    expect(translate).not.toHaveBeenCalled();
  });

  it("IS called only when the deterministic path fails, and flags the result 'translated'", async () => {
    const translate = vi.fn<TranslateFn>(async () => ({
      action: "delete",
      target: "https://a/x",
    }));
    const r = await parseIntent("please obliterate https://a/x", { translate });
    expect(translate).toHaveBeenCalledTimes(1);
    expect(r.resolved).toBe(true);
    expect(r.source).toBe("translated");
    expect(r.intent?.action).toBe("delete");
    expect(r.intent?.target).toBe("https://a/x");
    // The translated draft was lowered to RDF.
    expect(r.quads.length).toBeGreaterThan(0);
  });

  it("passes the nl + vocabularyHint + shape through to the translate fn", async () => {
    const translate = vi.fn<TranslateFn>(async () => ({ action: "read", target: "https://a/x" }));
    await parseIntent("zorp https://a/x", {
      translate,
      vocabularyHint: "schema.org",
      shape: "<shape ttl>",
    });
    expect(translate).toHaveBeenCalledWith({
      nl: "zorp https://a/x",
      vocabularyHint: "schema.org",
      shape: "<shape ttl>",
    });
  });

  it("returns unresolved (not a throw) when the translate fn returns null", async () => {
    const translate = vi.fn<TranslateFn>(async () => null);
    const r = await parseIntent("zorp the thing", { translate });
    expect(r.resolved).toBe(false);
    expect(r.reason).toContain("could not resolve");
  });

  it("returns unresolved when the translate fn returns an invalid draft (unknown action)", async () => {
    const translate = vi.fn<TranslateFn>(
      async () => ({ action: "frobnicate" }) as unknown as StructuredIntentDraft,
    );
    const r = await parseIntent("zorp the thing", { translate });
    expect(r.resolved).toBe(false);
    expect(r.reason).toContain("invalid draft");
  });

  it("rejects a translated draft with malformed parameters / modes", async () => {
    const badParams = vi.fn<TranslateFn>(
      async () =>
        ({ action: "read", parameters: [{ key: 1 }] }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: badParams })).resolved).toBe(false);
    const badModes = vi.fn<TranslateFn>(
      async () => ({ action: "grant", modes: ["Superuser"] }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: badModes })).resolved).toBe(false);
  });

  it("rejects a translated draft whose recipient is a non-string (not pass, not throw)", async () => {
    const translate = vi.fn<TranslateFn>(
      async () =>
        ({ action: "grant", recipient: { webid: "x" } }) as unknown as StructuredIntentDraft,
    );
    const r = await parseIntent("zorp", { translate });
    expect(r.resolved).toBe(false);
    expect(r.intent).toBeUndefined();
    expect(r.reason).toContain("invalid draft");
  });

  it("rejects a translated draft whose agent is a non-string (not pass, not throw)", async () => {
    const translate = vi.fn<TranslateFn>(
      async () => ({ action: "read", agent: 42 }) as unknown as StructuredIntentDraft,
    );
    const r = await parseIntent("zorp", { translate });
    expect(r.resolved).toBe(false);
    expect(r.intent).toBeUndefined();
    expect(r.reason).toContain("invalid draft");
  });

  it("rejects a translated draft with an empty-string target/recipient/agent", async () => {
    const emptyTarget = vi.fn<TranslateFn>(
      async () => ({ action: "read", target: "" }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: emptyTarget })).resolved).toBe(false);
    const emptyRecipient = vi.fn<TranslateFn>(
      async () => ({ action: "grant", recipient: "" }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: emptyRecipient })).resolved).toBe(false);
    const emptyAgent = vi.fn<TranslateFn>(
      async () => ({ action: "read", agent: "" }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: emptyAgent })).resolved).toBe(false);
  });

  it("rejects a whitespace-only target/recipient/agent (blank IRI is invalid)", async () => {
    const blankTarget = vi.fn<TranslateFn>(
      async () => ({ action: "read", target: "   " }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: blankTarget })).resolved).toBe(false);
    const blankRecipient = vi.fn<TranslateFn>(
      async () => ({ action: "grant", recipient: "\t\n " }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: blankRecipient })).resolved).toBe(false);
    const blankAgent = vi.fn<TranslateFn>(
      async () => ({ action: "read", agent: " " }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: blankAgent })).resolved).toBe(false);
  });

  it("rejects a prototype-chain key as a mode (toString / constructor) — own-key allowlist", async () => {
    for (const proto of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      const translate = vi.fn<TranslateFn>(
        async () => ({ action: "grant", modes: [proto] }) as unknown as StructuredIntentDraft,
      );
      const r = await parseIntent("zorp", { translate });
      expect(r.resolved, `mode "${proto}" must be rejected`).toBe(false);
      expect(r.intent).toBeUndefined();
      expect(r.reason).toContain("invalid draft");
    }
  });

  it("rejects a non-string mode (numeric) without throwing", async () => {
    const translate = vi.fn<TranslateFn>(
      async () => ({ action: "grant", modes: [1] }) as unknown as StructuredIntentDraft,
    );
    const r = await parseIntent("zorp", { translate });
    expect(r.resolved).toBe(false);
  });

  it("rejects a SPARSE modes/parameters array (a hole is an undefined entry)", async () => {
    // Regression guard: the field validators must visit holes as `undefined` and
    // reject them. Array.prototype.every SKIPS holes (so `new Array(1)` would pass)
    // — the validators use for...of, which does NOT. A sparse array is malformed
    // model output and must yield an unresolved result, never invalid RDF.
    const sparseModes = vi.fn<TranslateFn>(
      // biome-ignore lint/suspicious/noSparseArray: deliberately constructing a hole to test rejection
      async () => ({ action: "grant", modes: [, "Read"] }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: sparseModes })).resolved).toBe(false);

    const sparseParams = vi.fn<TranslateFn>(
      async () =>
        ({ action: "read", parameters: new Array(1) }) as unknown as StructuredIntentDraft,
    );
    expect((await parseIntent("zorp", { translate: sparseParams })).resolved).toBe(false);
  });

  it("still resolves a fully-valid translated draft (recipient + agent + modes)", async () => {
    const translate = vi.fn<TranslateFn>(async () => ({
      action: "grant",
      target: "https://alice.pod/notes.ttl",
      recipient: "https://bob.pod/me",
      agent: "https://carol.pod/me",
      modes: ["Read", "Write"],
    }));
    const r = await parseIntent("zorp the thing", { translate });
    expect(r.resolved).toBe(true);
    expect(r.source).toBe("translated");
    expect(r.intent?.action).toBe("grant");
    expect(r.intent?.recipient).toBe("https://bob.pod/me");
    expect(r.intent?.agent).toBe("https://carol.pod/me");
    expect(r.intent?.modes).toEqual(["Read", "Write"]);
    expect(r.quads.length).toBeGreaterThan(0);
  });

  it("makes NO network call — the injected fn is the only translator", async () => {
    // If the package tried to reach a model it would call fetch; assert it never does.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const translate = vi.fn<TranslateFn>(async () => ({ action: "read", target: "https://a/x" }));
    await parseIntent("read https://a/x"); // deterministic, no translate
    await parseIntent("zorp https://a/x", { translate }); // translated
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
