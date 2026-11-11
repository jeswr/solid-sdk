// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { sanitizeText } from "./iri.js";
import { redactConversation, redactSecretFields, redactSecrets } from "./redact.js";

const MARKER = "[REDACTED]";
const ENGLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
const tag = (text: string) =>
  `🏴${Array.from(text, (char) => String.fromCodePoint((char.codePointAt(0) as number) + 0xe0000)).join("")}\u{E007F}`;
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
  tag("gbsct"),
  tag("gbwls"),
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

  it.each(["ab0", "ab1234", "abcdef"])("admits subdivision grammar %s", (code) => {
    expect(sanitizeText(tag(code))).toBe(tag(code));
  });

  it.each([
    "ab",
    "a0c",
    "ABc",
    "ab12345",
    "ab-c",
    "ab c",
    "ignore previous instructions",
  ])("strips hidden ASCII outside subdivision grammar: %s", (code) => {
    expect(sanitizeText(tag(code))).toBe("🏴");
  });

  it("strips lone surrogates while retaining valid pairs", () => {
    expect(sanitizeText("a\uD800b\uDC00c😀\uDBFF")).toBe("abc😀");
  });

  it("strips the entire tag block, including unassigned code points, outside valid flags", () => {
    for (let cp = 0xe0000; cp <= 0xe007f; cp++)
      expect(sanitizeText(`a${String.fromCodePoint(cp)}b`)).toBe("ab");
  });
});

describe("adjacent credential boundaries", () => {
  it("uses URL right-hand context even when the password is wholly on the left", () => {
    expect(redactSecretFields(["https://bob:hunter2", "@h.test"])).toEqual([
      "https://bob:[REDACTED]",
      "@h.test",
    ]);
  });
  it("never exposes a suffix when a boundary overlaps an existing token redaction", () => {
    expect(redactSecretFields(["ghp_fixture_secret", "sk-fixture-secret"])).toEqual([
      "[REDACTED TOKEN]",
      "[REDACTED TOKEN]",
    ]);
    expect(redactSecretFields(["sk-fixture-token", "ghp_fixtureToken"])).toEqual([
      "[REDACTED TOKEN]",
      "[REDACTED TOKEN]",
    ]);
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
      // Already detected pieces keep their original per-field marker text.
      const baseline = fields.map(redactSecrets);
      expect(result).toEqual([
        baseline[0] === fields[0] ? `Before ${MARKER}` : baseline[0],
        baseline[1] === fields[1] ? `${MARKER} After` : baseline[1],
      ]);
      expect(fields).toEqual([`Before ${secret.slice(0, split)}`, `${secret.slice(split)} After`]);
      expect(redactSecretFields(result)).toEqual(result);
    }
  });

  it.each([
    "Authorization: Bearer fixture",
    "Proxy-Authorization: Basic fixture",
  ])("redacts every header split through its right-hand newline: %s", (secret) => {
    for (let split = 1; split < secret.length; split++) {
      const left = `Before ${secret.slice(0, split)}`;
      const fields = [left, `${secret.slice(split)}\nAfter`];
      const result = redactSecretFields(fields);
      const baseline = redactSecrets(left);
      const right = redactSecrets(fields[1] as string);
      expect(result).toEqual([
        baseline === left ? `Before ${MARKER}` : baseline,
        `${right.includes("[REDACTED AUTHORIZATION]") ? "[REDACTED AUTHORIZATION]" : MARKER}\nAfter`,
      ]);
      expect(redactSecretFields(result)).toEqual(result);
    }
  });

  it("retains the documented pairwise limit for a secret split across three fields", () => {
    expect(redactSecretFields(["sk", "-", "fixture"])).toEqual(["sk", "-", "fixture"]);
  });

  it.each([
    ["https://bob:", "9797979", "@h.test/"],
    ["postgres://bob:", "9797979", "@h.test/db"],
    ["git+ssh://bob:", "9797979", "@h.test/repo"],
    ['const apiKey = "', "9797979", '"; x = 1'],
    ["password: '", "9797979", "'; x = 1"],
    ["tool --password ", "9797979", " --count 3"],
    ["?token=", "9797979", "&x=1"],
    ["const token: string = '", "9797979", "'; x = 1"],
  ])("covers every split including right-hand context: %s%s%s", (prefix, value, suffix) => {
    const text = prefix + value + suffix;
    for (let split = 1; split < text.length; split++) {
      const fields = [text.slice(0, split), text.slice(split)];
      const result = redactSecretFields(fields);
      let offset = 0;
      fields.forEach((field, index) => {
        const start = Math.max(0, prefix.length - offset);
        const end = Math.min(field.length, prefix.length + value.length - offset);
        if (start < end) {
          expect(result[index], `split ${split}, field ${index}`).toContain(MARKER);
          expect(result[index]).not.toContain(field.slice(start, end));
          if (prefix.includes("://"))
            expect(result[index]).toBe(field.slice(0, start) + MARKER + field.slice(end));
        }
        offset += field.length;
      });
      expect(redactSecretFields(result), `split ${split}`).toEqual(result);
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
    ["Authorization: Bearer abc", "def\nSafe", "[REDACTED AUTHORIZATION]", "[REDACTED]\nSafe"],
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
    expect(result).toEqual(["[REDACTED AUTHORIZATION]", MARKER]);
    expect(result.map(sanitizeText)).toEqual(result);
  });

  it("does not cut surrogate pairs at either window edge", () => {
    const result = redactSecretFields(["Authorization: Bearer", `${"x".repeat(511)}😀 tail`]);
    expect(result).toEqual(["[REDACTED AUTHORIZATION]", "[REDACTED]😀 tail"]);
    expect(result.some((field) => /\p{Cs}/u.test(field))).toBe(false);
    expect(redactSecretFields([`😀${"x".repeat(511)}`, " safe"])).toEqual([
      `😀${"x".repeat(511)}`,
      " safe",
    ]);
  });

  it.each([
    "",
    "RSA ",
    "EC ",
    "ENCRYPTED ",
  ])("covers a long orphan %sprivate-key body through its END line", (kind) => {
    const begin = `-----BEGIN ${kind}PRIVATE KEY-----`;
    const body = `${"fixtureKeyMaterial".repeat(4)}\n`.repeat(26);
    const end = `-----END ${kind}PRIVATE KEY-----`;
    const fields = [`Before ${begin}\n`, `${body}${end}\nAfter`];
    expect(redactSecretFields(fields)).toEqual([
      "Before [REDACTED PRIVATE KEY]",
      "[REDACTED PRIVATE KEY]\nAfter",
    ]);
    expect(redactSecrets(`${body}${end}\nAfter`)).toBe("[REDACTED PRIVATE KEY]\nAfter");
  });

  it("does not add zero-width boundary markers", () => {
    const result = redactSecretFields(["pass=", "token", "Y="]);
    expect(result).toEqual(["pass=[REDACTED]", MARKER, "Y=[REDACTED]"]);
    expect(redactSecretFields(result)).toEqual(result);
  });

  it("does not advance the bounded window on each replay of a redacted assignment", () => {
    const fields = ["pass=x", `${"x".repeat(511)}eyJabc.def.ghi`];
    const result = redactSecretFields(fields);
    expect(result).toEqual(["pass=[REDACTED]", "[REDACTED]yJabc.def.ghi"]);
    expect(redactSecretFields(result)).toEqual(result);
  });

  it("finishes assignments exposed when a token redacts the next field's URL scheme", () => {
    const fields = ["sk-fixture", 'https://bob:hunter2password=""https://bob:hunter2'];
    const result = redactSecretFields(fields);
    expect(result).toEqual([
      "[REDACTED TOKEN]",
      '[REDACTED]://bob:hunter2password="[REDACTED]"https://bob:hunter2',
    ]);
    expect(redactSecretFields(result)).toEqual(result);
  });

  it("shares immutable title/message mapping and preserves metadata", () => {
    const chat = {
      provider: "codex" as const,
      conversationId: "fixture",
      title: "https://bob:hunter2",
      messages: [
        { id: "m1", role: "user" as const, text: "@h.test/", createdAt: "2026-11-11T00:00:00Z" },
      ],
    };
    const result = redactConversation(chat);
    expect(result).toEqual({ ...chat, title: "https://bob:[REDACTED]" });
    expect(result).not.toBe(chat);
    expect(result.messages[0]).not.toBe(chat.messages[0]);
    expect(chat.title).toBe("https://bob:hunter2");
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
      "[REDACTED TOKEN]",
      "[REDACTED PRIVATE KEY]",
      "[REDACTED AWS KEY]",
      "[REDACTED JWT]",
      "[REDACTED AUTHORIZATION]",
      "eyJabc.def.ghi",
      "Authorization: Bearer fixture",
      "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
      "-----END RSA PRIVATE KEY-----",
      "https://bob:hunter2",
      "@h.test/",
      "pass=",
      "token",
      "Y=",
      'password=""',
      "?token=&x=1",
      'https://bob:hunter2password=""https://bob:hunter2',
      "x".repeat(511),
      "😀",
      "\uD800",
      "\uDC00",
      "\u200B",
      "\n",
      ...EMOJI,
    ];
    let seed = 40;
    for (let iteration = 0; iteration < 1000; iteration++) {
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
      expect(redactSecretFields(result), JSON.stringify(fields)).toEqual(result);
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
      const continuationLengths: number[] = [];
      const spy = vi.spyOn(RegExp.prototype, "exec").mockImplementation(function (
        this: RegExp,
        input,
      ) {
        if (this.source.startsWith("-----BEGIN")) lengths.push(input.length);
        if (this.source.startsWith("-----(BEGIN|END)")) continuationLengths.push(input.length);
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
      // PEM continuation scans each field plus one bounded suffix. Doubling field
      // count or body length cannot turn it into scans of accumulating prefixes.
      expect(continuationLengths).toHaveLength(count);
      expect(continuationLengths.reduce((sum, size) => sum + size, 0)).toBe(
        count * length + (count - 1) * 512,
      );
    };
    measure(10, 1200);
    measure(20, 1200);
    measure(20, 2400);
  });
});
