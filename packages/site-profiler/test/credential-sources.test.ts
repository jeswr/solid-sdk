// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import {
  discoverCredentialSources,
  discoverSessionTokens,
  redactOutput,
} from "../src/session-tokens.js";

const url = "https://shop.test/account";
it("distinguishes witnessed credential selectors from values without suppressing explicit credentials", () => {
  const selector = 'input[name="form_key"]';
  const html = `<input type="hidden" name="form_key" value="actual-form-credential"><script>window.config={formKeyInputSelector:${JSON.stringify(selector)}};</script>`;
  const pages = [{ url, html }];
  const result = discoverCredentialSources(pages, []);
  expect(result.secrets).toContain("actual-form-credential");
  expect(result.secrets).not.toContain(selector);
  expect(
    discoverCredentialSources(
      [
        {
          url,
          html: `<script>window.config={formKeyInputSelector:${JSON.stringify(selector)}};</script>`,
        },
      ],
      [],
    ).secrets,
  ).toContain(selector);
  expect(
    discoverCredentialSources(pages, [{ name: "session", value: selector }]).secrets,
  ).toContain(selector);
  expect(
    discoverCredentialSources(
      [{ url, html: `${html}<script>window.csrfToken=${JSON.stringify(selector)};</script>` }],
      [],
    ).secrets,
  ).toContain(selector);
  const response = {
    seq: 0,
    phase: "verify" as const,
    method: "GET",
    url,
    resourceType: "xhr",
    requestHeaders: {},
    cookieNames: [],
    contentType: "application/json",
    bodySample: JSON.stringify({
      formKeyInputSelector: selector,
      csrfToken: "json-form-credential",
    }),
  };
  const json = discoverCredentialSources(pages, [], [response]);
  expect(json.secrets).toContain("json-form-credential");
  expect(json.secrets).not.toContain(selector);
});

it("uses the final union for repeated output strings without sharing masks across runs", () => {
  const original = {
    model: { label: "late-probe-secret" },
    trace: Array.from({ length: 100 }, () => ({
      label: "late-probe-secret",
      evidence: ["late-probe-secret"],
    })),
  };
  const masked = redactOutput(original, ["late-probe-secret"]);
  expect(masked.model.label).toBe("[redacted]");
  expect(
    masked.trace.every((r) => r.label === "[redacted]" && r.evidence[0] === "[redacted]"),
  ).toBe(true);
  expect(original.model.label).toBe("late-probe-secret");
  expect(redactOutput(original, ["other-secret"])).toEqual(original);
});
describe("explicit credential sources", () => {
  it("registers eligible meta/hidden tokens and session cookies on first use without repetition", () => {
    const result = discoverCredentialSources(
      [
        {
          url,
          html: '<meta name="csrf-token" content="meta"><input type="hidden" name="_token" value="hidden"><input type="password" value="password-value"><input type="hidden" name="ordinary" value="ordinary-opaque-value">',
        },
      ],
      [{ name: "sid", value: "cookie" }],
    );
    expect(result.secrets).toEqual(new Set(["meta", "hidden", "password-value", "cookie"]));
    expect(result.tokens.get("meta")).toEqual({
      kind: "meta",
      name: "csrf-token",
      urlTemplate: url,
    });
    expect(result.tokens.get("hidden")).toMatchObject({
      kind: "html",
      urlTemplate: url,
      attribute: "value",
    });
    expect(result.tokens.get("cookie")).toEqual({ kind: "cookie", name: "sid" });
    expect(result.tokens.has("ordinary-opaque-value")).toBe(false);
  });
  it("registers script credentials for redaction but never invents a supported session source", () => {
    const result = discoverCredentialSources(
      [
        {
          url,
          html: '<script>const csrfToken="first"; window.csrfToken="second"; csrfToken="three"; const settings={csrfToken:"four"}; const form_key=`five`; const _token="sixth"+"seven";</script>',
        },
      ],
      [],
    );
    expect(result.tokens.size).toBe(0);
    expect(result.secrets).toEqual(
      new Set(["first", "second", "three", "four", "five", "sixth", "seven", "sixthseven"]),
    );
  });
  it("keeps ordinary opaque-value discovery dependent on repetition", () => {
    expect(
      discoverSessionTokens(
        [{ url, html: '<input type="hidden" name="ordinary" value="ordinary-opaque-value">' }],
        [],
        [],
      ),
    ).toEqual(new Map());
  });
  it.each([
    "window.csrfToken=1234567890;",
    "const csrfToken=1234567890;",
    "csrfToken=1234567890;",
    "self.settings={csrfToken:1234567890};",
    "const value=1234567890;window.csrfToken=String(value);",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: JavaScript fixture, never evaluated here
    "const value=1234567890;window.csrfToken=`${value}`;",
    'window.csrfToken="1234567890";',
    "broken( window.csrfToken=1234567890;",
  ])("registers numeric credential values and string forms without inventing a source: %s", (source) => {
    const result = discoverCredentialSources([{ url, html: `<script>${source}</script>` }], []);
    expect(result.secrets.has("1234567890")).toBe(true);
    expect(result.tokens.size).toBe(0);
  });
  it.each([
    ["0x499602d2", "1234567890"],
    ["1.23456789e9", "1234567890"],
    ["1_234_567_890", "1234567890"],
    ["-1234567890", "-1234567890"],
  ])("registers numeric source and transmitted spellings: %s", (raw, transmitted) => {
    for (const prefix of ["", "broken( "]) {
      const result = discoverCredentialSources(
        [],
        [],
        [
          {
            seq: 0,
            phase: "crawl",
            method: "GET",
            url,
            resourceType: "script",
            requestHeaders: {},
            cookieNames: [],
            status: 200,
            contentType: "application/javascript",
            bodySample: `${prefix}window.csrfToken=${raw};`,
          },
        ],
      );
      expect(result.secrets).toEqual(new Set([raw, transmitted]));
      expect(result.tokens.size).toBe(0);
    }
  });
  it("scans external script variables, global assignments, aliases and nested JSON credentials", () => {
    const sources = [
      [
        "script",
        "application/javascript",
        'const opaque="alias-secret";window.csrfToken=opaque;self["accessToken"]="self-secret";globalThis.sessionToken="global-secret";window.config={csrfToken:"nested-secret"};',
      ],
      [
        "xhr",
        "application/json",
        '{"config":{"accessToken":"json-secret"},"tokens":["array-secret"],"ordinary":"public"}',
      ],
      ["script", "text/plain", 'export const csrfToken="module-secret";'],
      ["script", "application/javascript", 'with(x){window.csrfToken="classic-secret"}'],
      ["script", "application/javascript", 'broken( window.csrfToken="broken-script-secret";'],
    ];
    const result = discoverCredentialSources(
      [],
      [],
      sources.map(([resourceType, contentType, bodySample], seq) => ({
        seq,
        phase: "demonstration",
        method: "POST",
        url,
        resourceType: resourceType as string,
        requestHeaders: {},
        cookieNames: [],
        status: 400,
        contentType,
        bodySample,
      })),
    );
    expect(result.tokens.size).toBe(0);
    expect(result.secrets).toEqual(
      new Set([
        "alias-secret",
        "self-secret",
        "global-secret",
        "nested-secret",
        "json-secret",
        "array-secret",
        "module-secret",
        "classic-secret",
        "broken-script-secret",
      ]),
    );
  });
  it("does not mistake cookie names, storage keys or token helper method literals for credentials", () => {
    const result = discoverCredentialSources(
      [
        {
          url,
          html: '<script>const csrfToken=readCookie("csrf");const accessToken=localStorage.getItem("storage-key");window.api={token:()=>transport("/token",{method:"POST"})};window.csrfToken="actual-secret";</script>',
        },
      ],
      [],
    );
    expect(result.secrets).toEqual(new Set(["actual-secret"]));
  });
});
