// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { discoverCredentialSources, discoverSessionTokens } from "../src/session-tokens.js";

const url = "https://shop.test/account";
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
