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
      new Set(["one", "two", "three", "four", "five", "six", "seven"]),
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
});
