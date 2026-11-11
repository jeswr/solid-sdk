// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redaction before persistence", () => {
  const corpus = [
    ["-----BEGIN PRIVATE KEY-----\nFAKE_KEY_BODY\n-----END PRIVATE KEY-----", "FAKE_KEY_BODY"],
    [
      "-----BEGIN RSA PRIVATE KEY-----\r\nFAKE_RSA_BODY\r\n-----END RSA PRIVATE KEY-----",
      "FAKE_RSA_BODY",
    ],
    ["-----BEGIN EC PRIVATE KEY-----\nFAKE_UNFINISHED", "FAKE_UNFINISHED"],
    ["sk-fixture-openai-token", "sk-fixture-openai-token"],
    ["sk-ant-api03-fixture_token", "sk-ant-api03-fixture_token"],
    ...["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"].map((prefix) => [
      `${prefix}fixtureToken123`,
      `${prefix}fixtureToken123`,
    ]),
    ...["AKIA", "ASIA", "AIDA", "AROA"].map((prefix) => [
      `${prefix}0000000000000000`,
      `${prefix}0000000000000000`,
    ]),
    ["eyJmaXh0dXJlIjp0cnVlfQ.eyJzdWIiOiJmaXh0dXJlIn0.ZmFrZXNpZw", "eyJmaXh0dXJlIjp0cnVlfQ"],
    ["Authorization: Bearer FAKE_BEARER\nNext line", "FAKE_BEARER"],
    ["proxy-authorization: Basic FAKE_BASIC\r\nNext line", "FAKE_BASIC"],
    ["export API_TOKEN=FAKE_ENV\nNext line", "FAKE_ENV"],
    // Neutral names now require compact env-line syntax; spaced code assignments survive.
    ["PLAIN_VALUE=FAKE_PLAIN\r\nNext line", "FAKE_PLAIN"],
    ['PASSWORD="FAKE_MULTI\nFAKE_END"\nNext line', "FAKE_MULTI"],
    ["PASSWORD='FAKE_SINGLE\nFAKE_END'\nNext line", "FAKE_SINGLE"],
    ['PASSWORD="FAKE_ESCAPED\\"VALUE"\nNext line', "FAKE_ESCAPED"],
    ['PASSWORD="FAKE_UNFINISHED', "FAKE_UNFINISHED"],
    ["PASSWORD='FAKE_UNFINISHED", "FAKE_UNFINISHED"],
    ["aws_secret_access_key=FAKE_AWS_SECRET", "FAKE_AWS_SECRET"],
  ];
  it.each(corpus)("removes credential corpus item %#", (input, removed) => {
    const result = redactSecrets(`Before\n${input}\nAfter`);
    expect(result).not.toContain(removed);
    expect(result).toContain("[REDACTED");
    expect(redactSecrets(result)).toBe(result);
  });
  it.each(["\n", "\r\n"])("redacts quoted continuations with line ending %j", (newline) => {
    // sst-5ax.36 retains names, punctuation and quotes instead of replacing whole assignments.
    for (const quote of ['"', "'"]) {
      const value = `FAKE_FIRST\\${newline}FAKE_SECOND\\${newline}FAKE_LAST`;
      const complete = `Before${newline}export VALUE=${quote}${value}${quote} Safe${newline}After`;
      expect(redactSecrets(complete)).toBe(
        `Before${newline}export VALUE=${quote}[REDACTED]${quote} Safe${newline}After`,
      );
      for (const ending of ["", "\\", `\\${newline}`]) {
        const unfinished = `Before${newline}VALUE=${quote}${value}${ending}`;
        const redacted = redactSecrets(unfinished);
        expect(redacted).toBe(`Before${newline}VALUE=${quote}[REDACTED]`);
        expect(redactSecrets(redacted)).toBe(redacted);
      }
    }
    expect(redactSecrets(`VALUE="FAKE\\${newline}ESCAPED\\"QUOTE" Safe`)).toBe(
      'VALUE="[REDACTED]" Safe',
    );
  });
  it.each(["\n", "\r\n"])("redacts unquoted continuations with line ending %j", (newline) => {
    // sst-5ax.36 removes only the continued value, retaining the assignment prefix.
    const value = `FAKE_FIRST\\${newline}FAKE_SECOND\\${newline}FAKE_LAST`;
    for (const prefix of ["", "export "]) {
      const redacted = redactSecrets(`Before${newline}${prefix}API_TOKEN=${value}${newline}After`);
      expect(redacted).toBe(`Before${newline}${prefix}API_TOKEN=[REDACTED]${newline}After`);
      expect(redactSecrets(redacted)).toBe(redacted);
      for (const ending of ["\\", `\\${newline}`]) {
        const unfinished = redactSecrets(`Before${newline}${prefix}API_TOKEN=${value}${ending}`);
        expect(unfinished).toBe(`Before${newline}${prefix}API_TOKEN=[REDACTED]`);
      }
    }
    expect(redactSecrets(`TOKEN=a\\ b${newline}Safe`)).toBe(`TOKEN=[REDACTED]${newline}Safe`);
  });
  // AUTHORED-BY Claude Opus 5.5
  it.each([
    ["gh\u0000p_fixtureControlToken1", "fixtureControlToken1"],
    ["sk\u007F-fixture-control", "fixture-control"],
    ["Authoriz\u0001ation: Bearer FAKE_CONTROL", "FAKE_CONTROL"],
    [
      "-----BEGIN PRIVATE\u0000 KEY-----\nFAKE_CONTROL_KEY\n-----END PRIVATE KEY-----",
      "FAKE_CONTROL_KEY",
    ],
    ["\u009Fsk-fixture-c1", "fixture-c1"],
  ])("a control character cannot split credential %#", (input, secret) => {
    const result = redactSecrets(`Before\t${input}\r\nAfter`);
    expect(result).not.toContain(secret);
    expect(result).toMatch(/^Before\t.*\[REDACTED/);
    expect(result).toContain("\r\nAfter");
    expect(redactSecrets(result)).toBe(result);
  });
  // AUTHORED-BY Claude Opus 5.5
  it.each([
    ["__sk-fixture-emphasis__", "fixture-emphasis"],
    ["_ghp_fixtureEmphasis1_", "fixtureEmphasis1"],
    ["__AKIA0000000000000000__", "AKIA0000000000000000"],
    ["_eyJmaXh0dXJlIjp0cnVlfQ.eyJzdWIiOiJmaXh0dXJlIn0.ZmFrZXNpZw_", "ZmFrZXNpZw"],
    ["_Authorization: Bearer FAKE_EMPHASIS_", "FAKE_EMPHASIS"],
  ])("Markdown emphasis cannot hide credential %#", (input, secret) => {
    const result = redactSecrets(`Before ${input} after`);
    expect(result).not.toContain(secret);
    expect(redactSecrets(result)).toBe(result);
  });
  it("keeps letter-adjacent lookalikes", () => {
    expect(redactSecrets("a task-list and askew")).toBe("a task-list and askew");
  });
  it("keeps ordinary text and all safe context outside a redaction", () => {
    expect(redactSecrets("Hello, world. Read src/main.ts")).toBe("Hello, world. Read src/main.ts");
    expect(redactSecrets("Before\nAuthorization: FAKE\nAfter")).toBe(
      "Before\n[REDACTED AUTHORIZATION]\nAfter",
    );
    // sst-5ax.36 preserves KEY and its quotes, unlike the old whole-assignment rule. Only a
    // line-start env assignment may continue past its line; mid-line values stop at the break.
    expect(redactSecrets('Before KEY="FAKE\nBODY" After')).toBe(
      'Before KEY="[REDACTED]\nBODY" After',
    );
    expect(redactSecrets('KEY="FAKE\nBODY" After')).toBe('KEY="[REDACTED]" After');
  });

  const safeCode = [
    "x = 1",
    "a == b",
    "a != b",
    "a <= b",
    "a >= b",
    "const equal = (a, b) => a === b;",
    "const total = a + b;",
    'let name = "Alice";',
    "if (a == b) { x = 1; }",
    "for (i = 0; i < n; i++) { total += i; }",
    "f(x=1, y=2)",
    "result = dict(x=1, name='Alice')",
    "def f(x=1): return x != 2",
    "let mut total: i32 = 0;",
    "let total = items.iter().map(|x| x + 1);",
    "total := a + b",
    'name := "Alice"',
    "for i := 0; i < n; i++ { total += i }",
    'if [ "$a" = "$b" ]; then echo equal; fi',
    '[[ "$a" != "$b" ]] && echo different',
    "echo NAME=value",
    "lowercase=value",
    "PLAIN_VALUE = ordinary_code",
    "SELECT * FROM numbers WHERE a = 1;",
    "| name | value |\n| --- | --- |\n| x = 1 | a == b |",
    "== Heading ==\nA heading\n=========",
    "monkey = 1",
    "keyboard = 2",
    "pwned = 2",
    "const keyboard = { name: 'Alice' };",
    "password == previous",
    "token => token.length",
    "secret::new()",
    'const url = "https://example.test:443/path?name=Alice&x=1";',
    'const url = "https://user@example.test:443/path";',
    '{ "author": "Jane Doe", "license": "MIT" }',
    "authority = 'example.test'",
    "function login(token: string, session?: Session): void {}",
    "interface Creds { password: string; apiKey: string | null }",
    "function f(token: string)",
    "interface Creds { token: string[]; password: Record<string, string> }",
    "function f(token: Record<string, Array<string | null>>, count: number) {}",
    "password: string == previous",
    "token: string => token.length",
    "token: string\nconst total = a + b;",
  ];
  it.each(safeCode)("preserves ordinary code byte-for-byte: %s", (input) => {
    const result = redactSecrets(input);
    expect(result).toBe(input);
    expect(redactSecrets(result)).toBe(result);
  });

  const assignments = [
    ["API_KEY=abc123", "API_KEY=[REDACTED]"],
    ["authorization_code=abc123", "authorization_code=[REDACTED]"],
    ["authorisationCode: abc123", "authorisationCode: [REDACTED]"],
    ["authToken: stringly", "authToken: [REDACTED]"],
    [
      "authToken: stringly<https://host.test/>let mut total: i32 = 0;",
      "authToken: [REDACTED] mut total: i32 = 0;",
    ],
    ['password: string = "hunter2"', 'password: string = "[REDACTED]"'],
    ["const token: string = 'abc'", "const token: string = '[REDACTED]'"],
    [
      'const password: string | null = "hunter2"; const total = a + b;',
      'const password: string | null = "[REDACTED]"; const total = a + b;',
    ],
    ['const token: string[] = "abc";', 'const token: string[] = "[REDACTED]";'],
    [
      "const token: Record<string, string> = 'abc'; x = 1",
      "const token: Record<string, string> = '[REDACTED]'; x = 1",
    ],
    [
      "const token: Record<string, Array<string | null>>='abc'; x = 1",
      "const token: Record<string, Array<string | null>>='[REDACTED]'; x = 1",
    ],
    ["password: string=abc123; x = 1", "password: string=[REDACTED]; x = 1"],
    [
      "const token:\nRecord<string,\nstring>\n=\n'abc'; x = 1",
      "const token:\nRecord<string,\nstring>\n=\n'[REDACTED]'; x = 1",
    ],
    ['password: "string"', 'password: "[REDACTED]"'],
    ["export API_KEY=abc123", "export API_KEY=[REDACTED]"],
    ["API_KEY=ab,cd)ef}gh]", "API_KEY=[REDACTED]"],
    ["password=ab,cd)ef}gh]", "password=[REDACTED]"],
    ["echo apiKey=ab,cd)ef}gh] Safe", "echo apiKey=[REDACTED] Safe"],
    ["export apiKey=ab,cd)ef}gh]", "export apiKey=[REDACTED]"],
    // An unquoted semicolon is a shell operator, so b is a command, not a value suffix.
    ["export PASS=a;b", "export PASS=[REDACTED];b"],
    ["export PASS=a\\;b", "export PASS=[REDACTED]"],
    ["export PASS='a;b'", "export PASS='[REDACTED]'"],
    ['export PASS="a;b"', 'export PASS="[REDACTED]"'],
    ["export PASS=a&&echo safe", "export PASS=[REDACTED]&&echo safe"],
    ["export PASS=a||echo safe", "export PASS=[REDACTED]||echo safe"],
    ["export PASS=a|echo safe", "export PASS=[REDACTED]|echo safe"],
    ["export PASS=a\\&\\&b\\|c", "export PASS=[REDACTED]"],
    ["export PASS=a'b c;d&&e|f',g)h}i] Safe", "export PASS=[REDACTED] Safe"],
    ['export PASS=a"b c;d&&e|f",g)h}i] Safe', "export PASS=[REDACTED] Safe"],
    ["export PASS=a'b\\' Safe", "export PASS=[REDACTED] Safe"],
    ['export API_KEY="abc123"', 'export API_KEY="[REDACTED]"'],
    ["password='abc123'", "password='[REDACTED]'"],
    ['password = "abc123"', 'password = "[REDACTED]"'],
    ['password: "abc123"', 'password: "[REDACTED]"'],
    ['{"password": "abc123", "name": "Alice"}', '{"password": "[REDACTED]", "name": "Alice"}'],
    ["{'password': 'abc123'}", "{'password': '[REDACTED]'}"],
    ["password := abc123", "password := [REDACTED]"],
    ["password: abc123}", "password: [REDACTED]}"],
    ["f(password=abc123, x=1)", "f(password=[REDACTED], x=1)"],
    ["f(password=abc123)", "f(password=[REDACTED])"],
    ["f( password=abc123, x=1)", "f( password=[REDACTED], x=1)"],
    ["f(x=1, password=abc123)", "f(x=1, password=[REDACTED])"],
    ["const token=abc123; const total = a + b;", "const token=[REDACTED]; const total = a + b;"],
    ["let token=abc123, total=1;", "let token=[REDACTED], total=1;"],
    ["var token=abc123, total=1;", "var token=[REDACTED], total=1;"],
    ["password = abc123, total = 1;", "password = [REDACTED], total = 1;"],
    ["password: abc123, total: 1", "password: [REDACTED], total: 1"],
    ["password=abc123; echo safe", "password=[REDACTED]; echo safe"],
    ["password=abc123 Safe", "password=[REDACTED] Safe"],
    ["tool --password abc123 --count 3", "tool --password [REDACTED] --count 3"],
    ['tool --password "abc123" --count 3', 'tool --password "[REDACTED]" --count 3'],
    ["tool --token=abc123 --count 3", "tool --token=[REDACTED] --count 3"],
    ["tool --api-key abc123 --count 3", "tool --api-key [REDACTED] --count 3"],
    ["tool --token==abc123", "tool --token=[REDACTED]"],
    ["?token=abc123&x=1", "?token=[REDACTED]&x=1"],
    ["?token=ab;cd,ef)", "?token=[REDACTED]"],
    ["?token=ab;cd,ef)gh}ij]&x=1", "?token=[REDACTED]&x=1"],
    ["?token=ab;cd,ef)gh}ij]#safe", "?token=[REDACTED]#safe"],
    ["?token=ab;cd,ef)gh}ij] Safe", "?token=[REDACTED] Safe"],
    ["<https://host.test/?token=ab;cd,ef)gh}ij]>", "<https://host.test/?token=[REDACTED]>"],
    ['"?token=ab;cd,ef)gh}ij]"', '"?token=[REDACTED]"'],
    ["'?token=ab;cd,ef)gh}ij]'", "'?token=[REDACTED]'"],
    ["`?token=ab;cd,ef)gh}ij]`", "`?token=[REDACTED]`"],
    ["tool --token=abc123, --count 3", "tool --token=[REDACTED], --count 3"],
    ["&api_key=abc123#section", "&api_key=[REDACTED]#section"],
    ["?token==abc123&x=1", "?token=[REDACTED]&x=1"],
    [
      'const url = "https://host.test/?token=abc123";',
      'const url = "https://host.test/?token=[REDACTED]";',
    ],
    [
      'const apiKey = "abc123"; const total = a + b;',
      'const apiKey = "[REDACTED]"; const total = a + b;',
    ],
    ["password=abc123 token=other456", "password=[REDACTED] token=[REDACTED]"],
    ["API_KEY=( password=ab,cd)ef", "API_KEY=[REDACTED] password=[REDACTED]"],
    ["password=", "password=[REDACTED]"],
    ['password=""', 'password="[REDACTED]"'],
    ['password="abc123', 'password="[REDACTED]'],
    ['password="abc123\\', 'password="[REDACTED]'],
    ["password='abc123", "password='[REDACTED]"],
    ['password="abc\\"123"; x = 1', 'password="[REDACTED]"; x = 1'],
    // Shell single quotes close even after a backslash, but the word continues after the
    // quote (`123'...` opens another quote to end of line), so the whole word redacts.
    ["password='abc\\'123'; x = 1", "password=[REDACTED]"],
    ["PASS='a\\'\nx = 1", "PASS='[REDACTED]'\nx = 1"],
    ["PASS='a\\'\r\nx = 1", "PASS='[REDACTED]'\r\nx = 1"],
    ["pw = 'a\\\\' ; const total = a + b", "pw = '[REDACTED]' ; const total = a + b"],
    // `name: '...'` may be a JS/Python literal (escape-aware) or YAML (literal backslash).
    // An ambiguous or unterminated quote redacts to the end of its line, and scanning resumes
    // on the next line, so it can never swallow a later key.
    ["password: 'a\\'\nx = 1", "password: '[REDACTED]\nx = 1"],
    ['apiKey = "first\nsecond";\nx = 1', 'apiKey = "[REDACTED]\nsecond";\nx = 1'],
    // Not a line-start env assignment: a continuation does not carry the value past its line.
    ["password=first\\\nsecond;\nx = 1", "password=[REDACTED]\nsecond;\nx = 1"],
    ["postgres://user:abc123@host.test/db", "postgres://user:[REDACTED]@host.test/db"],
    ["git+ssh://user:abc123@host.test/repo", "git+ssh://user:[REDACTED]@host.test/repo"],
    ["https://user:abc:123@host.test/", "https://user:[REDACTED]@host.test/"],
    ["https://user:abc@123@host.test/", "https://user:[REDACTED]@host.test/"],
    ["https://user:@host.test/", "https://user:[REDACTED]@host.test/"],
    [
      "https://token:abc123@host.test/?api_key=other456&x=1",
      "https://token:[REDACTED]@host.test/?api_key=[REDACTED]&x=1",
    ],
    ["API_TOKEN=sk-fixture-openai-token", "API_TOKEN=[REDACTED]"],
    ["?token=ghp_fixtureToken123&x=1", "?token=[REDACTED]&x=1"],
    ["https://user:sk-fixture-token@host.test/", "https://user:[REDACTED]@host.test/"],
    ...[
      "[REDACTED]",
      "[REDACTED PRIVATE KEY]",
      "[REDACTED TOKEN]",
      "[REDACTED AWS KEY]",
      "[REDACTED JWT]",
      "[REDACTED AUTHORIZATION]",
      "[REDACTED ENV]",
    ].map((marker) => [`password=${marker}; x = 1`, "password=[REDACTED]; x = 1"]),
  ];
  it.each(assignments)("redacts only the secret value: %s", (input, expected) => {
    const result = redactSecrets(input);
    expect(result).toBe(expected);
    expect(redactSecrets(result)).toBe(result);
  });

  it.each([
    "token",
    "aTOKENsuffix",
    "secret",
    "password",
    "passwd",
    "pwd",
    "pw",
    "servicePw",
    "pass",
    "passphrase",
    "credential",
    "credentials",
    "creds",
    "auth",
    "authentication",
    "cookie",
    "session",
    "bearer",
    "signature",
    "salt",
    "dsn",
    "connection_string",
    "connectionString",
    "conn_str",
    "connStr",
    "client_secret",
    "access_token",
    "refreshToken",
    "KEY",
    "API_KEY",
    "apiKey",
    "APIKey",
    "apiKEY",
    "private_key",
    "key_count",
    "api-key",
    "config.key",
  ])("recognizes credential name %s without removing its spelling", (name) => {
    const result = redactSecrets(`const ${name} = "abc123"; const total = a + b;`);
    expect(result).toBe(`const ${name} = "[REDACTED]"; const total = a + b;`);
    expect(redactSecrets(result)).toBe(result);
  });

  it.each(["\n", "\r\n"])("redacts neutral names in an env block (%j)", (newline) => {
    const input = [
      "DATABASE_URL=postgres://host.test/db",
      "STRIPE_LIVE=abc123",
      '  export CONFIG="first',
      'second"',
      "\tVALUE='other456'",
      "x = 1",
      "lowercase=ordinary",
      "PLAIN_VALUE = ordinary",
    ].join(newline);
    const expected = [
      "DATABASE_URL=[REDACTED]",
      "STRIPE_LIVE=[REDACTED]",
      '  export CONFIG="[REDACTED]"',
      "\tVALUE='[REDACTED]'",
      "x = 1",
      "lowercase=ordinary",
      "PLAIN_VALUE = ordinary",
    ].join(newline);
    expect(redactSecrets(input)).toBe(expected);
    expect(redactSecrets(expected)).toBe(expected);
  });

  it("bounds type recognition and redacts oversized types conservatively", () => {
    const acceptedType = `Record<string, ${"T".repeat(200)}>`;
    const accepted = `const token: ${acceptedType} = 'abc'; x = 1`;
    expect(redactSecrets(accepted)).toBe(`const token: ${acceptedType} = '[REDACTED]'; x = 1`);
    for (const type of [
      `Record<string, ${"T".repeat(300)}>`,
      `Record<string,\n${"T".repeat(300)}>`,
    ]) {
      const result = redactSecrets(`const token: ${type} = 'abc'; const total = a + b;\nx = 1`);
      // Outside the supported bound, the uncertain remainder (including later lines) redacts.
      expect(result).toBe("const token: [REDACTED]");
      expect(redactSecrets(result)).toBe(result);
    }
  });

  it("treats a type window cut off at the bound as inconclusive, not as a non-type", () => {
    const longGeneric = `${"T".repeat(300)}<string>`;
    // A generic head longer than the window still redacts its initializer (conservatively).
    const generic = redactSecrets(`const token: ${longGeneric} = 'abc'; x = 1`);
    expect(generic).toBe("const token: [REDACTED]");
    expect(generic).not.toContain("abc");
    // Whitespace past the window may hide an initializer on a later line.
    const blank = redactSecrets(`token:${"\n".repeat(300)}= 'abc'`);
    expect(blank).toBe("token:[REDACTED]");
    // A long identifier that is not a type is the value itself; the rest of the line survives.
    const value = `${"A".repeat(300)}`;
    expect(redactSecrets(`password: ${value}\nx = 1`)).toBe("password: [REDACTED]\nx = 1");
    for (const result of [generic, blank]) expect(redactSecrets(result)).toBe(result);
  });

  // Code string literals keep their escapes: only shell single quotes treat `\` literally.
  it.each([
    // JavaScript / TypeScript
    ["const password = 'abc\\'def'; x = 1", "const password = '[REDACTED]'; x = 1"],
    ['const token = "abc\\"def"; x = 1', 'const token = "[REDACTED]"; x = 1'],
    ["const apiKey = 'a\\\\'; x = 1", "const apiKey = '[REDACTED]'; x = 1"],
    // Python
    ["password = 'abc\\'def'\nx = 1", "password = '[REDACTED]'\nx = 1"],
    ["f(secret='abc\\'def', count=1)", "f(secret='[REDACTED]', count=1)"],
    // JSON
    ['{"password": "abc\\"def", "name": "Alice"}', '{"password": "[REDACTED]", "name": "Alice"}'],
    ['{"token": "a\\\\", "x": 1}', '{"token": "[REDACTED]", "x": 1}'],
  ])("keeps escape-aware code literals intact around the secret: %s", (input, expected) => {
    const result = redactSecrets(input);
    expect(result).toBe(expected);
    expect(result).not.toMatch(/def|abc/);
    expect(redactSecrets(result)).toBe(result);
  });

  it("never lets an ambiguous quote swallow a later YAML key while leaving its value", () => {
    const yaml = "password: 'a\\'\ntoken: 'xyz'\nname: Alice\napi_key: \"q\\\"r\"\nurl: ok";
    const result = redactSecrets(yaml);
    expect(result).toBe(
      "password: '[REDACTED]\ntoken: '[REDACTED]'\nname: Alice\napi_key: \"[REDACTED]\"\nurl: ok",
    );
    expect(result).not.toMatch(/xyz|q\\"r/);
    expect(redactSecrets(result)).toBe(result);
    // Unterminated quotes stop at their line too.
    expect(redactSecrets('secret: "abc\nother: 1')).toBe('secret: "[REDACTED]\nother: 1');
  });

  it("still treats backslash literally inside shell single quotes", () => {
    expect(redactSecrets("PASS='a\\'\nx = 1")).toBe("PASS='[REDACTED]'\nx = 1");
    expect(redactSecrets("export API_KEY='a\\' && echo ok")).toBe(
      "export API_KEY='[REDACTED]' && echo ok",
    );
  });

  it("is a fixpoint for deterministic combinations of code, secrets and markers", () => {
    // fast-check is not a package devDependency; exercise reproducible combinations instead.
    const fragments = [
      ...safeCode,
      ...assignments.flat(),
      ...corpus.flat(),
      "\u0000",
      "\\",
      '"',
      "'",
      "\r\n",
    ];
    let seed = 36;
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      let input = "";
      for (let part = 0; part < 5; part += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        input += fragments[seed % fragments.length];
      }
      const result = redactSecrets(input);
      expect(redactSecrets(result)).toBe(result);
    }
  });

  it("finishes long adversarial names, whitespace and unfinished quotes in under 100 ms", () => {
    const input = `${"a-".repeat(25_000)}!${" ".repeat(50_000)}\npassword="${"a\\".repeat(25_000)}`;
    redactSecrets("password=warmup");
    const start = performance.now();
    const result = redactSecrets(input);
    const elapsed = performance.now() - start;
    expect(result).toBe(`${"a-".repeat(25_000)}!${" ".repeat(50_000)}\npassword="[REDACTED]`);
    expect(elapsed).toBeLessThan(100);
    expect(redactSecrets(result)).toBe(result);
  });
});
