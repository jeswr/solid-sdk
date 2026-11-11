// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { sanitizeText } from "./iri.js";
import { redactSecretFields, redactSecrets } from "./redact.js";

const MARKER = "[REDACTED]";
const ENGLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
const EMOJI = [
  "👨‍👩‍👧‍👦",
  "👩‍💻",
  "👩🏽‍💻",
  "👩🏿‍⚕️",
  "🏳️‍🌈",
  "🧑🏻‍🤝‍🧑🏾",
  "👩\uFE0F🏽‍💻",
  "👩🏽\uFE0F‍💻",
  ENGLAND,
];

describe("Unicode format normalization", () => {
  it.each([
    "\u200B",
    "\u2060",
    "\uFEFF",
    "\u00AD",
    "\u200C",
    "\u200D",
    "\u202A",
    "\u202B",
    "\u202C",
    "\u202D",
    "\u202E",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
    "\u{E0067}",
  ])("removes format character %j before every detector", (format) => {
    for (const secret of [
      "sk-fixture-token",
      "ghp_fixtureToken",
      "AKIA0000000000000000",
      "eyJabc.def.ghi",
      "Authorization: Bearer fixture",
      "password=fixture",
      "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
    ]) {
      const concealed = [...secret].join(format);
      expect(redactSecrets(concealed)).toBe(redactSecrets(secret));
      expect(sanitizeText(concealed)).toBe(secret);
    }
  });

  it("strips every Cf code point outside an admitted emoji sequence", () => {
    const formats: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const char = String.fromCodePoint(cp);
      if (/\p{Cf}/u.test(char)) formats.push(char);
    }
    expect(formats.length).toBeGreaterThan(100);
    expect(sanitizeText(`a${formats.join("")}b`)).toBe("ab");
    expect(sanitizeText(undefined)).toBeUndefined();
    expect(sanitizeText("\u0000\t\r\n\u009F")).toBe("\t\r\n");
  });

  it.each(EMOJI)("preserves emoji bytes: %s", (emoji) => {
    const input = `Hello ${emoji}!`;
    expect(new TextEncoder().encode(sanitizeText(input))).toEqual(new TextEncoder().encode(input));
    expect(redactSecrets(input)).toBe(input);
    expect(redactSecretFields([input, "Good day."])).toEqual([input, "Good day."]);
    expect(sanitizeText(sanitizeText(input))).toBe(input);
  });

  it("drops orphan/malformed ZWJs and tags, including tags after the terminator", () => {
    expect(sanitizeText("a‍b 👩‍x x‍💻 👩🏽‍")).toBe("ab 👩x x💻 👩🏽");
    expect(sanitizeText(`\u{E0067}${ENGLAND}\u{E0067}`)).toBe(ENGLAND);
    expect(sanitizeText("🏴\u{E0067}\u{E0062}x\u{E007F}")).toBe("🏴x");
  });
});

describe("adjacent credential boundaries", () => {
  it("never exposes a suffix when a boundary overlaps an existing token redaction", () => {
    expect(redactSecretFields(["ghp_fixture_secret", "sk-fixture-secret"])).toEqual([
      MARKER,
      MARKER,
    ]);
    expect(redactSecretFields(["sk-fixture-token", "ghp_fixtureToken"])).toEqual([MARKER, MARKER]);
    expect(redactSecretFields(['password="sk-fixture', 'token"; x = 1'])).toEqual([
      'password="[REDACTED]',
      '[REDACTED]"; x = 1',
    ]);
    expect(
      redactSecretFields(['ghp_fixtureToken Safe password="first', 'second"; token=other']),
    ).toEqual(['[REDACTED TOKEN] Safe password="[REDACTED]', '[REDACTED]"; token=[REDACTED]']);
  });
  const secrets = [
    "sk-fixture-token",
    "ghp_fixtureToken123",
    "github_pat_fixtureToken123",
    "AKIA0000000000000000",
    "ASIA0000000000000000",
    "eyJabc.def.ghi",
    "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
  ];

  it.each(secrets)("redacts both pieces at every split of %s", (secret) => {
    for (let split = 1; split < secret.length; split++) {
      const fields = [`Before ${secret.slice(0, split)}`, `${secret.slice(split)} After`];
      const result = redactSecretFields(fields);
      expect(result).toEqual([`Before ${MARKER}`, `${MARKER} After`]);
      expect(fields).toEqual([`Before ${secret.slice(0, split)}`, `${secret.slice(split)} After`]);
      expect(redactSecretFields(result)).toEqual(result);
    }
  });

  it.each([
    [
      'const apiKey = "abc',
      'def"; const total = a + b;',
      'const apiKey = "[REDACTED]',
      '[REDACTED]"; const total = a + b;',
    ],
    ["password=", "abcdef next", "password=[REDACTED]", "[REDACTED] next"],
    ["api", 'Key = "abc"; x = 1', "api", 'Key = "[REDACTED]"; x = 1'],
    ["tool --pass", "word abc --count 3", "tool --pass", "word [REDACTED] --count 3"],
    ["?token=abc", "def&x=1", "?token=[REDACTED]", "[REDACTED]&x=1"],
    ["https://user:abc", "def@host.test/", "https://user:[REDACTED]", "[REDACTED]@host.test/"],
    ["Authorization: Bearer abc", "def\nSafe", "[REDACTED]", "[REDACTED]\nSafe"],
  ])("retains code around boundary values: %j | %j", (left, right, a, b) => {
    expect(redactSecretFields([left, right])).toEqual([a, b]);
  });

  it("examines every boundary before replacements can hide a shared middle field", () => {
    expect(redactSecretFields(["AKIA0000", "000000000000 ghp", "_fixtureToken123"])).toEqual([
      MARKER,
      `${MARKER} ${MARKER}`,
      MARKER,
    ]);
  });

  it.each([
    ["Ordinary prose", " continues here."],
    ["x = 1;\n", "const total = a + b;"],
    ["function f(token: string,", " count: number) {}"],
    ["mon", "key = 1"],
    ["a task", "-list and askew"],
    ["password ==", " previous"],
    ["safe ", "ghp_fixtureToken", " safe"],
    ["", "", "ordinary"],
    [],
  ])("keeps benign joins and ignores detections confined to one side: %j", (...fields) => {
    expect(redactSecretFields(fields)).toEqual(fields.map(redactSecrets));
  });

  it("normalizes format characters before testing the join", () => {
    expect(redactSecretFields(["A\u200BKIA0000", "0000\u206000000000"])).toEqual([MARKER, MARKER]);
  });

  it("removes emoji format characters orphaned by a window-edge redaction", () => {
    const fields = ["Authorization: fixture", `${"a".repeat(510)}${ENGLAND}`];
    const result = redactSecretFields(fields);
    expect(result).toEqual([MARKER, MARKER]);
    expect(result.map(sanitizeText)).toEqual(result);
  });

  it("bounds growth and detector work with reproducible generated fields", () => {
    const fragments = [
      "safe prose ",
      "x = 1;",
      "ghp",
      "_fixture",
      "sk-",
      "suffix",
      "password=abc",
      'def";',
      "AKIA0000",
      "000000000000",
      MARKER,
      "\u200B",
      "\n",
      ...EMOJI,
    ];
    let seed = 40;
    for (let iteration = 0; iteration < 300; iteration++) {
      const fields = Array.from({ length: 1 + (iteration % 13) }, () => {
        let text = "";
        for (let i = 0; i < 4; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          text += fragments[seed % fragments.length];
        }
        return text;
      });
      const redacted = fields.map(redactSecrets);
      const result = redactSecretFields(fields);
      expect(result).toHaveLength(fields.length);
      result.forEach((field, i) => {
        expect(field.length).toBeLessThanOrEqual((redacted[i]?.length ?? 0) + 2 * MARKER.length);
      });
    }

    // Count actual detector input bytes, including source recovery and redacted windows.
    // This guards against joining ever-growing prefixes without a timing threshold.
    const original = RegExp.prototype.exec;
    const measure = (count: number, length: number) => {
      const lengths: number[] = [];
      const spy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (
        this: RegExp,
        input,
      ) {
        if (this.source.startsWith("-----BEGIN")) lengths.push(input.length);
        return original.call(this, input);
      });
      try {
        redactSecretFields(Array.from({ length: count }, () => "a".repeat(length)));
      } finally {
        spy.mockRestore();
      }
      expect(lengths).toHaveLength(count + 2 * (count - 1));
      expect(lengths.filter((size) => size !== length).every((size) => size <= 1024)).toBe(true);
      expect(lengths.reduce((sum, size) => sum + size, 0)).toBe(
        count * length + 2 * (count - 1) * 1024,
      );
    };
    measure(10, 1200);
    measure(20, 1200);
    measure(20, 2400);
  });
});
