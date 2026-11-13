// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { discoverCredentialSources, discoverSessionTokens } from "../src/session-tokens.js";

const url = "https://shop.test/account";
describe("explicit credential sources", () => {
  it("registers short meta/hidden tokens and every cookie on first use without repetition", () => {
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
          html: '<script>const csrfToken="one"; window.csrfToken="two"; csrfToken="three"; const settings={csrfToken:"four"}; const form_key=`five`; const _token="six"+"seven";</script>',
        },
      ],
      [],
    );
    expect(result.tokens.size).toBe(0);
    expect(result.secrets).toEqual(
      new Set(["one", "two", "three", "four", "five", "six", "seven", "sixseven"]),
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
