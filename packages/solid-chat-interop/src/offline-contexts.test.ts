// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAs2, serializeAs2 } from "./reconcile.js";

const BASE = "https://alice.example/chat/message";
const AS = "https://www.w3.org/ns/activitystreams";
const UNKNOWN = "https://untrusted.example/context";

describe("offline ActivityStreams context", () => {
  const fetch = vi.fn(() => {
    throw new Error("Network access forbidden");
  });
  beforeEach(() => {
    fetch.mockClear();
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("round-trips JSON-LD through the canonical model and Turtle offline", async () => {
    const message = await parseAs2(
      BASE,
      JSON.stringify({
        "@context": AS,
        id: `${BASE}#it`,
        type: "Note",
        content: "Offline message",
        attributedTo: "https://alice.example/profile#me",
        published: "2026-10-25T00:00:00.000Z",
      }),
      "application/ld+json",
    );
    expect(message?.content).toBe("Offline message");
    expect(message?.author).toBe("https://alice.example/profile#me");
    if (!message) throw new Error("Missing message");
    expect(await parseAs2(BASE, await serializeAs2(message, `${BASE}#it`))).toEqual(message);
  });

  it.each([
    [UNKNOWN],
    [AS, UNKNOWN],
    [AS, { extension: { "@id": "https://example.org/extension", "@context": UNKNOWN } }],
    [`${AS}?untrusted`],
  ])("refuses unbundled and nested contexts: %j", async (...context) => {
    await expect(
      parseAs2(
        BASE,
        JSON.stringify({
          "@context": context,
          id: `${BASE}#it`,
          type: "Note",
          content: "Refused message",
          extension: { id: "urn:uuid:nested" },
        }),
        "application/ld+json",
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining("Remote JSON-LD context refused:") },
    });
  });
});
