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
    ["PLAIN_VALUE = FAKE_PLAIN\r\nNext line", "FAKE_PLAIN"],
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
    for (const quote of ['"', "'"]) {
      const value = `FAKE_FIRST\\${newline}FAKE_SECOND\\${newline}FAKE_LAST`;
      const complete = `Before${newline}export VALUE=${quote}${value}${quote} Safe${newline}After`;
      expect(redactSecrets(complete)).toBe(`Before${newline}[REDACTED ENV] Safe${newline}After`);
      for (const ending of ["", "\\", `\\${newline}`]) {
        const unfinished = `Before${newline}VALUE=${quote}${value}${ending}`;
        const redacted = redactSecrets(unfinished);
        expect(redacted).toBe(`Before${newline}[REDACTED ENV]`);
        expect(redactSecrets(redacted)).toBe(redacted);
      }
    }
    expect(redactSecrets(`VALUE="FAKE\\${newline}ESCAPED\\"QUOTE" Safe`)).toBe(
      "[REDACTED ENV] Safe",
    );
  });
  it.each(["\n", "\r\n"])("redacts unquoted continuations with line ending %j", (newline) => {
    const value = `FAKE_FIRST\\${newline}FAKE_SECOND\\${newline}FAKE_LAST`;
    for (const prefix of ["", "export "]) {
      const redacted = redactSecrets(`Before${newline}${prefix}API_TOKEN=${value}${newline}After`);
      expect(redacted).toBe(`Before${newline}[REDACTED ENV]${newline}After`);
      expect(redactSecrets(redacted)).toBe(redacted);
      for (const ending of ["\\", `\\${newline}`]) {
        const unfinished = redactSecrets(`Before${newline}${prefix}API_TOKEN=${value}${ending}`);
        expect(unfinished).toBe(`Before${newline}[REDACTED ENV]`);
      }
    }
    expect(redactSecrets(`TOKEN=a\\ b${newline}Safe`)).toBe(`[REDACTED ENV]${newline}Safe`);
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
  it("keeps ordinary text and all safe context outside a redaction", () => {
    expect(redactSecrets("Hello, world. Read src/main.ts")).toBe("Hello, world. Read src/main.ts");
    expect(redactSecrets("Before\nAuthorization: FAKE\nAfter")).toBe(
      "Before\n[REDACTED AUTHORIZATION]\nAfter",
    );
    expect(redactSecrets('Before KEY="FAKE\nBODY" After')).toBe("Before [REDACTED ENV] After");
  });
});
