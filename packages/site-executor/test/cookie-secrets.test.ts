// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import {
  isSessionCredentialCookie,
  MIN_REDACTION_LENGTH,
  registerCookieSecrets,
  registerSecret,
  secretRedactor,
} from "../src/index.js";

it.each([
  "session",
  "Sess",
  "SID",
  "auth",
  "token",
  "JWT",
  "remember_me",
  "csrf",
  "xsrf",
  "PHPSESSID",
  "form_key",
  "connect.sid",
])("classifies common session cookie %s at any length", (name) => {
  const secrets = new Set<string>();
  expect(isSessionCredentialCookie({ name, value: "1" })).toBe(true);
  registerCookieSecrets(secrets, { name, value: "1" });
  expect(secrets.size).toBe(0);
  registerCookieSecrets(secrets, { name, value: "abcd" });
  expect(secretRedactor(secrets)("item abcd; item xabcd9")).toBe("item [redacted]; item xabcd9");
});
it.each([
  { httpOnly: true },
  { declaredNames: ["ordinary"] },
  { loginCookieNames: ["ordinary"] },
])("classifies a short explicit session credential: %j", (context) => {
  const cookie = { name: "ordinary", value: "1", httpOnly: "httpOnly" in context };
  const secrets = new Set<string>();
  expect(isSessionCredentialCookie(cookie, context)).toBe(true);
  registerCookieSecrets(secrets, cookie, context);
  expect(secrets.size).toBe(0);
  expect(secretRedactor(secrets)("1")).toBe("1");
});
it.each([
  "1",
  '"1"',
  "%22%31%22",
  "%2525252531",
])("keeps short preference payloads out of the secret set: %s", (value) => {
  const secrets = new Set<string>();
  registerCookieSecrets(secrets, { name: "preference", value });
  expect(secretRedactor(secrets)("1 /items/1 item18")).toBe("1 /items/1 item18");
  expect(secrets.size).toBe(0);
});
it.each([
  '"quoted-cookie-secret"',
  "%22quoted-cookie-secret%22",
])("registers every logical cookie payload: %s", (value) => {
  const secrets = new Set<string>();
  registerCookieSecrets(secrets, { name: "sid", value });
  const redact = secretRedactor(secrets);
  for (const echo of [
    value,
    "quoted-cookie-secret",
    "quoted&#45;cookie&#45;secret",
    "%71uoted-cookie-secret",
  ])
    expect(redact(echo)).toContain("[redacted]");
});
it("applies the heuristic floor to ordinary long preferences", () => {
  const secrets = new Set<string>();
  registerCookieSecrets(secrets, { name: "preference", value: "abcdefgh" });
  expect(secretRedactor(secrets)("abcdefgh")).toBe("[redacted]");
});

it("ignores sub-four-character cookies even when model or vault declares them", () => {
  for (const context of [
    {
      model: {
        login: [{ method: "cookie-check" as const, sessionCookies: ["ordinary"] }],
        operations: [],
      },
    },
    { declaredNames: ["ordinary"] },
  ]) {
    const secrets = new Set<string>();
    registerCookieSecrets(secrets, { name: "ordinary", value: "1" }, context);
    expect(secrets.size).toBe(0);
    expect(secretRedactor(secrets)("1")).toBe("1");
  }
});

it.each([
  "",
  "1",
  "abc",
  "ab ",
  "%61%62%63",
  "&#97;&#98;&#99;",
  "😀😀😀",
])("does not register sub-four-character credentials or their encodings: %s", (value) => {
  const secrets = new Set<string>();
  registerSecret(secrets, value);
  expect(secrets.size).toBe(0);
  expect(secretRedactor(new Set([value]))(value)).toBe(value);
});
it.each([
  '"1"',
  "%22%31%22",
  "%2525252531",
])("does not register encoded short HttpOnly payloads: %s", (value) => {
  const secrets = new Set<string>();
  registerCookieSecrets(secrets, { name: "ordinary", value, httpOnly: true });
  expect(secrets.size).toBe(0);
});
it("shares the four-character floor while retaining short boundaries and full long redaction", () => {
  expect(MIN_REDACTION_LENGTH).toBe(4);
  for (const value of ["abcd", "abcde", "abcdef", "abcdefg"]) {
    const secrets = new Set<string>();
    registerSecret(secrets, value);
    expect(secretRedactor(secrets)(`(${value}) x${value}9`)).toBe(`([redacted]) x${value}9`);
  }
  expect(secretRedactor(new Set(["abcdefgh"]))("xabcdefgh9")).toBe("x[redacted]9");
});
