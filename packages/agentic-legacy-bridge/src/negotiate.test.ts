// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
// AUTHORED-BY Codex GPT-6.1-Sol
import { AGENT_FOOTER, encodeEnvelope, encodeEnvelopeObject } from "@jeswr/agent-channels";
import { describe, expect, it } from "vitest";
import {
  asChannel,
  decideUpgrade,
  detectBridgeCapability,
  highestMutualChannel,
} from "./negotiate.js";

describe("asChannel", () => {
  it("narrows known channels only", () => {
    expect(asChannel("rdf")).toBe("rdf");
    expect(asChannel("smoke-signal")).toBeUndefined();
    expect(asChannel(42)).toBeUndefined();
  });
});

describe("detectBridgeCapability", () => {
  it.each([
    { name: "header only", input: { headers: { "X-Agentic-Reply": "1" } }, carriage: "email-mime" },
    {
      name: "part only",
      input: { jsonLdBlocks: [encodeEnvelope("a.b.c")] },
      carriage: "email-mime",
    },
    {
      name: "parsed part only",
      input: { jsonLd: encodeEnvelopeObject("a.b.c") },
      carriage: "email-mime",
    },
    { name: "footer only", input: { textBody: AGENT_FOOTER }, carriage: "footer-url-only" },
    { name: "none", input: {}, carriage: undefined },
  ])("detects $name as an unverified carriage hint", ({ input, carriage }) => {
    const cap = detectBridgeCapability(input);
    expect(cap.capable).toBe(carriage !== undefined);
    expect(cap.carriage).toBe(carriage);
    expect(cap.podCopyUrl).toBeUndefined();
    expect(cap.channels).toEqual(["email"]);
  });

  it.each([
    ["footer-url-only,email-mime,a2a,rdf", "rdf"],
    ["footer-url-only,email-mime,a2a", "a2a"],
    ["footer-url-only,email-mime", "email-mime"],
    ["footer-url-only", "footer-url-only"],
  ])("ranks the advertised carriages %s", (channels, expected) => {
    expect(detectBridgeCapability({ headers: { "X-Agentic-Channels": channels } }).carriage).toBe(
      expected,
    );
  });

  it("ranks discovered email support above the footer and below rdf/a2a", () => {
    const input = { headers: { "x-agentic-reply": "1" }, textBody: AGENT_FOOTER };
    expect(detectBridgeCapability(input).carriage).toBe("email-mime");
    for (const channel of ["rdf", "a2a"])
      expect(
        detectBridgeCapability({
          ...input,
          headers: { ...input.headers, "x-agentic-channels": channel },
        }).carriage,
      ).toBe(channel);
  });

  it("matches the configured card URL with punctuation but refuses lookalikes and the spec URL", () => {
    const [card, spec] = AGENT_FOOTER.match(/https:\/\/\S+/g) as string[];
    for (const textBody of [`See ${card}.`, `See (${card}/).`])
      expect(detectBridgeCapability({ textBody }).carriage).toBe("footer-url-only");
    for (const textBody of [
      spec,
      `${card}ic-web`,
      `${card}/other`,
      `${card}.evil.example`,
      `${card}?redirect=evil`,
      `${card}#fake`,
    ])
      expect(detectBridgeCapability({ textBody }).capable).toBe(false);
    const footer = "Custom agent: https://configured.example/agent · spec";
    expect(detectBridgeCapability({ footer, textBody: footer }).carriage).toBe("footer-url-only");
    expect(detectBridgeCapability({ footer: "No URLs", textBody: AGENT_FOOTER }).capable).toBe(
      false,
    );
    expect(
      detectBridgeCapability({ textBody: " ".repeat(512 * 1024) + AGENT_FOOTER }).capable,
    ).toBe(false);
  });

  it("ignores invalid carriers and gives the first case-insensitive header precedence", () => {
    for (const jsonLdBlocks of [
      ["{"],
      ["{}"],
      [encodeEnvelope("a.b.c").replace("jws-compact", "unsigned")],
    ])
      expect(detectBridgeCapability({ jsonLdBlocks }).capable).toBe(false);
    expect(
      detectBridgeCapability({ headers: { "X-Agentic-Reply": "0", "x-agentic-reply": "1" } })
        .capable,
    ).toBe(false);
    expect(detectBridgeCapability({ headers: { "X-Agentic-Reply": " 1 " } }).carriage).toBe(
      "email-mime",
    );
  });
  it("detects capability from the X-Agentic-Reply header + reads channels", () => {
    const cap = detectBridgeCapability({
      headers: {
        "X-Agentic-Reply": "https://pod.example/replies/1.ttl",
        "X-Agentic-Channels": "rdf, a2a, bogus",
      },
    });
    expect(cap.capable).toBe(true);
    expect(cap.podCopyUrl).toBe("https://pod.example/replies/1.ttl");
    expect(cap.channels).toEqual(["rdf", "a2a", "email"]); // ordered, filtered, email floor
  });

  it("detects capability from an AgenticReply JSON-LD block", () => {
    const cap = detectBridgeCapability({
      jsonLd: { type: ["VerifiableCredential", "AgenticReply"] },
    });
    expect(cap.capable).toBe(true);
    expect(cap.channels).toEqual(["email"]);
  });

  it("reports not-capable + email floor for a plain message", () => {
    const cap = detectBridgeCapability({ headers: { subject: "hi" } });
    expect(cap.capable).toBe(false);
    expect(cap.channels).toEqual(["email"]);
    expect(cap.podCopyUrl).toBeUndefined();
  });

  it("drops an unsafe X-Agentic-Reply URL", () => {
    const cap = detectBridgeCapability({ headers: { "X-Agentic-Reply": "javascript:x" } });
    expect(cap.podCopyUrl).toBeUndefined();
  });
});

describe("highestMutualChannel", () => {
  it("picks the highest mutually-supported channel", () => {
    expect(highestMutualChannel(["rdf", "a2a"], ["dpop-sk", "a2a"])).toBe("a2a");
    expect(highestMutualChannel(["rdf"], ["rdf", "a2a"])).toBe("rdf");
  });
  it("falls back to email (always supported)", () => {
    expect(highestMutualChannel([], [])).toBe("email");
    expect(highestMutualChannel(["rdf"], ["dpop-sk"])).toBe("email");
  });
});

describe("decideUpgrade (fail-closed)", () => {
  it("upgrades on accept with matching (or no) hash", () => {
    expect(
      decideUpgrade({ targetChannel: "rdf", required: false }, { accept: true }, "email"),
    ).toEqual({
      kind: "upgrade",
      channel: "rdf",
    });
    expect(
      decideUpgrade(
        { targetChannel: "rdf", protocolHash: "h1", required: false },
        { accept: true, protocolHash: "h1" },
        "email",
      ),
    ).toEqual({ kind: "upgrade", channel: "rdf" });
  });

  it("aborts on a hash mismatch even when accepted", () => {
    expect(
      decideUpgrade(
        { targetChannel: "rdf", protocolHash: "h1", required: true },
        { accept: true, protocolHash: "h2" },
        "email",
      ).kind,
    ).toBe("abort");
  });

  it("aborts when a REQUIRED upgrade is declined (no silent prose downgrade)", () => {
    expect(
      decideUpgrade({ targetChannel: "rdf", required: true }, { accept: false }, "email").kind,
    ).toBe("abort");
  });

  it("stays at the current channel when a non-required upgrade is declined", () => {
    expect(
      decideUpgrade({ targetChannel: "rdf", required: false }, { accept: false }, "a2a"),
    ).toEqual({ kind: "stay", channel: "a2a" });
  });
});
