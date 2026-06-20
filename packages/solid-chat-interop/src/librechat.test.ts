// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The LibreChat adapter: human vs AI attribution, threading, room resolution, NO
 * private-field leak, and no fabricated IRIs. This is the external-schema security
 * surface — exhaustive.
 */
import { describe, expect, it } from "vitest";
import type { CanonicalMessage } from "./canonical.js";
import { LibreChatAdapter, type LibreChatMessage } from "./librechat.js";

const HUMAN = "https://alice.example/profile/card#me";
const AGENT = "https://agents.example/assistant#me";
const BASE = "https://alice.example/chat/librechat/";

describe("LibreChatAdapter — human messages", () => {
  it("maps a user message to author = configured human WebID, no provenance", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN });
    const msg = adapter.toCanonical({
      text: "What is Solid?",
      createdAt: "2026-06-20T09:00:00.000Z",
      isCreatedByUser: true,
      sender: "User",
    });
    expect(msg.content).toBe("What is Solid?");
    expect(msg.author).toBe(HUMAN);
    expect(msg.provenance).toBeUndefined();
    expect(msg.published).toBe("2026-06-20T09:00:00.000Z");
  });

  it("recognises a human via sender='User' when isCreatedByUser is absent", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN });
    const msg = adapter.toCanonical({ text: "hi", sender: "User" });
    expect(msg.author).toBe(HUMAN);
    expect(msg.provenance).toBeUndefined();
  });

  it("does NOT invent an author when no humanWebId is configured", () => {
    const adapter = new LibreChatAdapter();
    const msg = adapter.toCanonical({ text: "hi", isCreatedByUser: true });
    expect(msg.author).toBeUndefined();
    expect(msg.provenance).toBeUndefined();
  });
});

describe("LibreChatAdapter — AI messages", () => {
  it("maps an assistant message to provenance (no author)", () => {
    const adapter = new LibreChatAdapter({
      humanWebId: HUMAN,
      agentWebId: AGENT,
      resolveModelIri: (model) => `https://models.example/${model}`,
    });
    const msg = adapter.toCanonical({
      text: "Solid is a web standard.",
      createdAt: 1718874000000,
      isCreatedByUser: false,
      sender: "GPT-4",
      model: "gpt-4",
      endpoint: "openAI",
    });
    expect(msg.author).toBeUndefined();
    expect(msg.provenance?.attributedTo).toBe(AGENT);
    expect(msg.provenance?.generatedBy).toBe("https://models.example/gpt-4");
    expect(msg.content).toBe("Solid is a web standard.");
  });

  it("defaults an unlabelled message to AI (never silently claims a human author)", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN, agentWebId: AGENT });
    const msg = adapter.toCanonical({ text: "ambiguous" });
    expect(msg.author).toBeUndefined();
    expect(msg.provenance?.attributedTo).toBe(AGENT);
  });

  it("drops the default urn:librechat model IRI (not http(s)) when no resolver supplied", () => {
    const adapter = new LibreChatAdapter({ agentWebId: AGENT });
    const msg = adapter.toCanonical({ text: "x", isCreatedByUser: false, model: "gpt-4" });
    // attributedTo present (http agent), generatedBy dropped (urn: is not http(s)).
    expect(msg.provenance?.attributedTo).toBe(AGENT);
    expect(msg.provenance?.generatedBy).toBeUndefined();
  });

  it("omits provenance entirely when neither agentWebId nor an http model IRI resolves", () => {
    const adapter = new LibreChatAdapter();
    const msg = adapter.toCanonical({ text: "x", isCreatedByUser: false, model: "gpt-4" });
    expect(msg.author).toBeUndefined();
    expect(msg.provenance).toBeUndefined();
  });
});

describe("LibreChatAdapter — threading + rooms", () => {
  it("maps conversationId → room and parentMessageId → inReplyTo under roomBaseIri", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN, roomBaseIri: BASE });
    const msg = adapter.toCanonical({
      text: "reply",
      isCreatedByUser: true,
      conversationId: "conv-123",
      parentMessageId: "msg-99",
    });
    expect(msg.room).toBe(`${BASE}conv-123`);
    expect(msg.inReplyTo).toBe(`${BASE}msg-99`);
  });

  it("uses an already-absolute http(s) conversationId as-is", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN });
    const msg = adapter.toCanonical({
      text: "x",
      isCreatedByUser: true,
      conversationId: "https://alice.example/chat/c/1#this",
    });
    expect(msg.room).toBe("https://alice.example/chat/c/1#this");
  });

  it("drops a non-absolute id when no roomBaseIri is configured", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN });
    const msg = adapter.toCanonical({
      text: "x",
      isCreatedByUser: true,
      conversationId: "conv-123",
      parentMessageId: "msg-99",
    });
    expect(msg.room).toBeUndefined();
    expect(msg.inReplyTo).toBeUndefined();
  });
});

describe("LibreChatAdapter — no private-field leak", () => {
  it("only canonical keys appear in the result (snapshot the key set)", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN, roomBaseIri: BASE });
    // A realistic LibreChat doc carrying many private fields. The internals are
    // attached via bracket assignment (their real names — `_id`, `__v`, … — are
    // not lint-conformant object-literal identifiers, and that is the point: even
    // present on the runtime object they must never reach the canonical model).
    const dirty: Record<string, unknown> = {
      text: "hello",
      createdAt: "2026-06-20T09:00:00.000Z",
      isCreatedByUser: true,
      sender: "User",
      conversationId: "conv-1",
      parentMessageId: "msg-1",
    };
    // --- LibreChat internals that must NEVER leak ---
    dirty._id = "656f1...";
    dirty.__v = 0;
    dirty.messageId = "internal-uuid";
    dirty.user = "mongo-user-id";
    dirty.tokenCount = 42;
    dirty.error = false;
    dirty.unfinished = false;
    dirty.files = [{ file_id: "x" }];
    dirty.finish_reason = "stop";
    dirty.model = "gpt-4";
    dirty.endpoint = "openAI";
    dirty.plugin = { latest: "x" };
    dirty.iconURL = "https://x/y.png";

    const msg = adapter.toCanonical(dirty as unknown as LibreChatMessage);
    const keys = Object.keys(msg).sort();
    // Exactly the canonical keys this message populates — nothing source-private.
    expect(keys).toEqual(["author", "content", "inReplyTo", "mediaType", "published", "room"]);
    // Spot-check the private values are absent anywhere on the object.
    const json = JSON.stringify(msg);
    expect(json).not.toContain("656f1");
    expect(json).not.toContain("mongo-user-id");
    expect(json).not.toContain("tokenCount");
    expect(json).not.toContain("finish_reason");
  });

  it("the canonical result conforms to CanonicalMessage (type-level guard)", () => {
    const adapter = new LibreChatAdapter({ humanWebId: HUMAN });
    const msg: CanonicalMessage = adapter.toCanonical({ text: "x", isCreatedByUser: true });
    expect(msg.content).toBe("x");
  });
});
