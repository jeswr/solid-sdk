// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { sanitizeText } from "./iri.js";
import { redactConversation, redactSecretFields, redactSecrets } from "./redact.js";

const BODY = `${"fixtureKeyMaterial".repeat(4)}\n`.repeat(26);

describe("redaction review regressions", () => {
  it.each([
    "",
    "RSA ",
    "EC ",
    "ENCRYPTED ",
    "PGP ",
  ])("keeps previous fields unchanged when appending an orphan %sEND", (kind) => {
    const end = `-----END ${kind}PRIVATE KEY${kind === "PGP " ? " BLOCK" : ""}-----`;
    for (const prefix of [["My title"], ["t", "prose ".repeat(156)]]) {
      expect(
        redactSecretFields([...prefix, `${end} is the footer`]).slice(0, prefix.length),
      ).toEqual(redactSecretFields(prefix));
    }
  });

  it("preserves generated closed prefixes when arbitrary neighbours are appended", () => {
    const closed = [
      "My title",
      "prose ".repeat(156),
      "ordinary 👩🏽‍💻 text.",
      "",
      "connect to https://bob:pw@db.example.com",
      "see https://example.com:8080",
      'const password = "fixture";',
      "A complete token: ghp_fixture.",
      "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\nSafe.",
    ];
    const neighbours = [
      "-----END PRIVATE KEY-----\nAfter",
      "-----END RSA PRIVATE KEY----- is the footer",
      "@alice can you check?",
      "@alice thanks",
      "ordinary text",
      "sk-fixture",
    ];
    let seed = 71;
    const pick = (size: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % size;
    };
    for (let trial = 0; trial < 1000; trial++) {
      const prefix = Array.from(
        { length: 1 + pick(8) },
        () => closed[pick(closed.length)] as string,
      );
      const next = neighbours[pick(neighbours.length)] as string;
      expect(
        redactSecretFields([...prefix, next]).slice(0, prefix.length),
        JSON.stringify({ prefix, next }),
      ).toEqual(redactSecretFields(prefix));
    }
  });

  it.each([
    "",
    "RSA ",
    "EC ",
    "ENCRYPTED ",
    "PGP ",
  ])("covers every header/body/footer split of a long %sPEM, with and without END", (kind) => {
    const label = `${kind}PRIVATE KEY${kind === "PGP " ? " BLOCK" : ""}`;
    const begin = `-----BEGIN ${label}-----\n`;
    const end = `-----END ${label}-----`;
    for (const complete of [false, true]) {
      const secret = begin + BODY + (complete ? end : "");
      expect(redactSecrets(`Before ${secret}${complete ? "\nAfter" : ""}`)).toBe(
        `Before [REDACTED PRIVATE KEY]${complete ? "\nAfter" : ""}`,
      );
      for (let split = 1; split < secret.length; split++) {
        const fields = [
          "t",
          `Before ${secret.slice(0, split)}`,
          secret.slice(split) + (complete ? "\nAfter" : ""),
        ];
        const result = redactSecretFields(fields);
        const baseline = fields.map(redactSecrets);
        expect(result, `split ${split}, complete ${complete}`).toEqual([
          "t",
          baseline[1] === fields[1] ? "Before [REDACTED]" : baseline[1],
          baseline[2] === fields[2] ? `[REDACTED]${complete ? "\nAfter" : ""}` : baseline[2],
        ]);
        expect(redactSecretFields(result)).toEqual(result);
      }
    }
  });

  it("carries unfinished keys through subsequent fields and stops at the first END", () => {
    const result = redactSecretFields([
      "t",
      "intro\n-----BEGIN PRIVATE KEY-----\n",
      BODY,
      "",
      BODY,
      "last body\n-----END PRIVATE KEY-----\nAfter",
      "Safe message",
    ]);
    expect(result).toEqual([
      "t",
      "intro\n[REDACTED PRIVATE KEY]",
      "[REDACTED]",
      "",
      "[REDACTED]",
      "[REDACTED PRIVATE KEY]\nAfter",
      "Safe message",
    ]);
    expect(redactSecretFields(result)).toEqual(result);
  });

  it.each([
    "connect to https://bob:pw@db.example.com",
    "connect to https://bob@db.example.com:8080",
    "see https://example.com:8080",
    "https://localhost:3000",
    "https://127.0.0.1:8080",
    "https://[::1]:8080",
  ])("keeps completed URL authorities stable before a mention: %s", (left) => {
    const prefix = ["t", left];
    const result = redactSecretFields([...prefix, "@alice thanks"]);
    expect(result.slice(0, 2)).toEqual(redactSecretFields(prefix));
    expect(result[2]).toBe("@alice thanks");
    expect(redactSecretFields(result)).toEqual(result);
  });

  it.each([
    "bob:pw",
    "bob:9797979",
    "bob.example:pw",
    "bob:pw@db.example.com",
  ])("still redacts split URL userinfo: %s", (authority) => {
    const text = `https://${authority}@host.test/`;
    // Do not cross an already-complete @host in the left field.
    const last = text.indexOf("@") + 1;
    for (let split = "https://".length; split <= last; split++) {
      const result = redactSecretFields([text.slice(0, split), text.slice(split)]);
      expect(result.join("")).not.toContain(
        authority.slice(authority.indexOf(":") + 1).split("@")[0],
      );
      expect(redactSecretFields(result)).toEqual(result);
    }
  });

  it.each([
    "65536",
    "123456",
    "1234567890123456789",
  ])("does not treat an out-of-range numeric credential as a port: %s", (password) => {
    expect(redactSecretFields([`https://bob.example:${password}`, "@host.test/"])).toEqual([
      "https://bob.example:[REDACTED]",
      "@host.test/",
    ]);
  });

  it("strips all variation selectors in credential names and values", () => {
    const selectors = [
      ...Array.from({ length: 16 }, (_, i) => String.fromCodePoint(0xfe00 + i)),
      ...Array.from({ length: 240 }, (_, i) => String.fromCodePoint(0xe0100 + i)),
    ];
    for (const selector of selectors) {
      expect(redactSecrets(`password${selector}=abc`)).toBe("password=[REDACTED]");
      expect(redactSecrets(`sk-ab${selector}cd`)).toBe("[REDACTED TOKEN]");
      expect(redactSecrets(`sk-ab1${selector}cd`)).toBe("[REDACTED TOKEN]");
      expect(sanitizeText(`a${selector}b`)).toBe("ab");
      expect(sanitizeText(`😀${selector}`)).toBe(
        selector === "\uFE0E" || selector === "\uFE0F" ? `😀${selector}` : "😀",
      );
    }
  });

  it.each([
    "☀︎",
    "☀️",
    "❤️",
    "1️⃣",
    "👩🏽️‍💻",
    "👩️🏽‍💻",
  ])("preserves admitted emoji selectors: %s", (emoji) => {
    expect(sanitizeText(emoji)).toBe(emoji);
    expect(sanitizeText(sanitizeText(emoji))).toBe(emoji);
  });

  it("owns source-chunk mapping, joining and final redaction in the shared helper", () => {
    const conversation = {
      provider: "codex" as const,
      conversationId: "fixture",
      title: "AKIA0000",
      messages: [
        { id: "one", role: "user" as const, text: "ignored", createdAt: "2026-11-11T00:00:00Z" },
        { role: "assistant" as const, text: "ignored too", createdAt: "2026-11-11T00:00:01Z" },
      ],
    };
    const chunks = [["000000000000 Safe ghp", "_fixtureToken123 Safe ghp_fixture"], ["Token123"]];
    const snapshot = structuredClone({ conversation, chunks });
    const result = redactConversation(conversation, { chunks });
    expect(result).toEqual({
      ...conversation,
      title: "[REDACTED]",
      messages: [
        {
          ...conversation.messages[0],
          text: "[REDACTED] Safe [REDACTED]\n[REDACTED] Safe [REDACTED TOKEN]",
        },
        { ...conversation.messages[1], text: "[REDACTED]" },
      ],
    });
    expect({ conversation, chunks }).toEqual(snapshot);
    expect(redactConversation(result)).toEqual(result);
    expect(
      redactConversation(conversation, { chunks: [[], ["\n  password=fixture  "]] }).messages.map(
        (m) => m.text,
      ),
    ).toEqual(["", "password=[REDACTED]"]);
    expect(() => redactConversation(conversation, { chunks: [[]] })).toThrow(
      "Invalid conversation chunks",
    );
  });
});
