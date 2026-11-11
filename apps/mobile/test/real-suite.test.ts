// AUTHORED-BY Codex GPT-6
import { describe, expect, test } from "vitest";
import { quoteAndroidShell } from "../e2e/checks.ts";
import {
  checkPrivateRead,
  checkShare,
  type LoginEvidence,
  redactLogcat,
  reportStatus,
  sendIntent,
} from "../e2e/real-suite-checks.ts";

const login: LoginEvidence = {
  customTab: true,
  passwordSubmitted: true,
  consentSubmitted: true,
  schemeCallback: true,
  signedInAccount: true,
};
const body = 'Private\n"exact" café\n';

describe("real-suite authentication evidence", () => {
  test.each([401, 403])("requires anonymous denial (%i) and exact body", (status) => {
    expect(checkPrivateRead(login, status, body, body)).toEqual([]);
  });
  test.each([200, 302, 404, 500])("rejects vacuous privacy proof (%i)", (status) => {
    expect(checkPrivateRead(login, status, body, body)).toContain("Resource was not private");
  });
  test.each([
    undefined,
    null,
    "",
    body.trim(),
    `${body}extra`,
  ])("rejects a missing/different preview", (observed) => {
    expect(checkPrivateRead(login, 401, observed, body)).not.toEqual([]);
  });
  test.each(Object.keys(login) as (keyof LoginEvidence)[])("cannot omit %s", (key) => {
    expect(checkPrivateRead({ ...login, [key]: false }, 401, body, body)).toContain(
      `Missing native login evidence: ${key}`,
    );
  });
  test("missing evidence fields also fail closed", () => {
    expect(checkPrivateRead({} as LoginEvidence, 401, body, body)).toHaveLength(5);
  });
  test("partial, running, deferred and timed-out reports never pass", () => {
    const passed = Array.from({ length: 7 }, () => ({ status: "passed" }));
    expect(reportStatus(passed)).toBe("passed");
    expect(reportStatus([])).toBe("failed");
    expect(reportStatus(passed.slice(1))).toBe("failed");
    for (const status of ["running", "failed", "deferred", "timeout"])
      expect(reportStatus([...passed.slice(1), { status }])).toBe("failed");
  });
});

describe("real Android share intents and DOM observations", () => {
  test("preserves text as a single shell argument", () => {
    const text = "quotes ' \" & $literal; `command`";
    const args = sendIntent(text);
    expect(args[args.indexOf("android.intent.extra.TEXT") + 1]).toBe(text);
    expect(args.map(quoteAndroidShell).join(" ")).toContain(quoteAndroidShell(text));
    expect(args).toContain("android.intent.action.SEND");
    expect(args).not.toContain("--eu");
  });
  test("sends a typed external file URI with a read grant", () => {
    const uri = "content://media/external/file/123";
    const args = sendIntent(undefined, uri);
    expect(args).toContain("--grant-read-uri-permission");
    expect(args.slice(args.indexOf("--eu"), args.indexOf("--eu") + 3)).toEqual([
      "--eu",
      "android.intent.extra.STREAM",
      uri,
    ]);
    expect(args).not.toContain("android.intent.extra.TEXT");
    expect(args).toContain("application/pdf");
  });
  test.each([
    "file:///data/private",
    "content://org.jeswr.suite.fileprovider/file",
    "https://example.com",
    "content://media/external/file/1;evil",
  ])("rejects %s", (uri) => {
    expect(() => sendIntent(undefined, uri)).toThrow();
  });
  test("requires a share item", () => expect(() => sendIntent(undefined)).toThrow());
  test("requires one exact item on the signed-in share route", () => {
    const observed = {
      path: "/share/",
      heading: "Save to Suite",
      sessionReady: true,
      items: [body],
    };
    expect(checkShare(observed, body)).toEqual([]);
    for (const change of [
      { path: "/signin" },
      { heading: "Other screen" },
      { sessionReady: false },
      { items: [] },
      { items: [body, body] },
      { items: [body.trim()] },
    ])
      expect(checkShare({ ...observed, ...change }, body)).not.toEqual([]);
  });
});

test("diagnostics drop credentials, protocol URLs, callback codes and token lines", () => {
  const privateLines = [
    "dat=org.jeswr.suite:/oauth/callback?code=sensitive&state=state",
    "loading https://localhost:8443/.oidc/auth?state=sensitive",
    "Authorization: DPoP credential",
    "refresh_token credential",
    "password=credential",
    "eyJheader.payload.signature",
    "disposable-password",
    "private@example.com",
  ];
  const redacted = redactLogcat(["AndroidRuntime: stack frame", ...privateLines].join("\n"), [
    "disposable-password",
    "private@example.com",
  ]);
  expect(redacted.split("\n")[0]).toBe("AndroidRuntime: stack frame");
  expect(redacted.split("\n").slice(1)).toEqual(
    privateLines.map(() => "[redacted sensitive log line]"),
  );
});
