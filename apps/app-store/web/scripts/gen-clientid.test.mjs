// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for the gen-clientid origin precedence (roborev finding).
//
// The generator resolves the deployment origin from three layers — the shell,
// `.env.local`, and `.env` — and the precedence is non-trivial. Two equivalent
// origin variables exist (`APP_ORIGIN`, preferred, and `VITE_APP_ORIGIN`), and
// the rule is:
//
//   shell (non-empty origin var) > `.env.local` > `.env` > dev default
//
// resolved PER LAYER (each layer's own `APP_ORIGIN` then `VITE_APP_ORIGIN`), so
// `.env.local` FULLY overrides `.env` even ACROSS the two variables. These tests
// pin that — including the regression for the cross-variable bug where a `.env`
// value could beat a `.env.local` value of the OTHER variable.
//
// This is a `.test.mjs` (not `.test.ts`) on purpose: the generator is a plain
// `.mjs` script and `tsconfig` has `allowJs:false`, so co-locating a `.mjs` test
// keeps it OUT of `tsc` while vitest still runs it.
import { describe, expect, it } from "vitest";
import {
  clientIdDocument,
  DEV_DEFAULT,
  normaliseOrigin,
  resolveOriginValue,
} from "./gen-clientid.mjs";

const A = "https://a.example";
const B = "https://b.example";

describe("resolveOriginValue — origin precedence", () => {
  it("`.env.local` wins cross-variable: `.env` APP_ORIGIN vs `.env.local` VITE_APP_ORIGIN → `.env.local` (the regression)", () => {
    expect(
      resolveOriginValue({
        envFile: { APP_ORIGIN: A },
        envLocalFile: { VITE_APP_ORIGIN: B },
      }),
    ).toBe(B);
  });

  it("a non-empty shell origin var beats BOTH files (even across variables)", () => {
    expect(
      resolveOriginValue({
        shellEnv: { VITE_APP_ORIGIN: "https://shell.example" },
        envFile: { APP_ORIGIN: A },
        envLocalFile: { VITE_APP_ORIGIN: B },
      }),
    ).toBe("https://shell.example");
  });

  it("an EMPTY shell origin var is ignored (treated as absent), not a suppressor", () => {
    expect(
      resolveOriginValue({
        shellEnv: { APP_ORIGIN: "" },
        envFile: { APP_ORIGIN: A },
        envLocalFile: { VITE_APP_ORIGIN: B },
      }),
    ).toBe(B);
  });

  it("`.env.local` overrides `.env` on the SAME variable", () => {
    expect(
      resolveOriginValue({
        envFile: { APP_ORIGIN: A },
        envLocalFile: { APP_ORIGIN: B },
      }),
    ).toBe(B);
  });

  it("`.env.local` (APP_ORIGIN) fully overrides `.env` (VITE_APP_ORIGIN) cross-variable", () => {
    expect(
      resolveOriginValue({
        envFile: { VITE_APP_ORIGIN: A },
        envLocalFile: { APP_ORIGIN: B },
      }),
    ).toBe(B);
  });

  it("within a single layer, APP_ORIGIN is preferred over VITE_APP_ORIGIN", () => {
    expect(
      resolveOriginValue({
        shellEnv: { APP_ORIGIN: A, VITE_APP_ORIGIN: B },
      }),
    ).toBe(A);
  });

  it("falls back to `.env` when neither shell nor `.env.local` set an origin", () => {
    expect(resolveOriginValue({ envFile: { APP_ORIGIN: A } })).toBe(A);
  });

  it("falls back to the dev default when nothing is set", () => {
    expect(resolveOriginValue({})).toBe(DEV_DEFAULT);
  });
});

describe("clientIdDocument — redirect_uris", () => {
  it("registers BOTH the popup callback.html AND the app-root (autologin) redirect targets", () => {
    const doc = clientIdDocument("https://drive.example");
    // The popup path posts the code back from callback.html; the full-page redirect
    // (autologin) path redirects back to the app root which re-runs SessionProvider.
    // Both MUST be registered or the OP rejects the respective redirect_uri.
    expect(doc.redirect_uris).toEqual([
      "https://drive.example/callback.html",
      "https://drive.example/",
    ]);
    // client_id is byte-exact the served URL, and the doc stays a public client.
    expect(doc.client_id).toBe("https://drive.example/clientid.jsonld");
    expect(doc.token_endpoint_auth_method).toBe("none");
  });
});

describe("normaliseOrigin", () => {
  it("strips path/query/hash + trailing slash to the byte-exact origin", () => {
    expect(normaliseOrigin("https://x.example/foo?q=1#h")).toBe("https://x.example");
  });

  it("throws on a malformed URL", () => {
    expect(() => normaliseOrigin("not a url")).toThrow();
  });

  it("throws on a non-http(s) scheme", () => {
    expect(() => normaliseOrigin("ftp://x.example")).toThrow();
  });
});

// AUTHORED-BY Codex GPT-6
describe("GitHub Pages client identity", () => {
  it("includes the app base in every identity and redirect URL", () => {
    const doc = clientIdDocument("https://jeswr.github.io", "/solid-sdk/app-store/");
    expect(doc.client_id).toBe("https://jeswr.github.io/solid-sdk/app-store/clientid.jsonld");
    expect(doc.client_uri).toBe("https://jeswr.github.io/solid-sdk/app-store/");
    expect(doc.redirect_uris).toEqual([
      "https://jeswr.github.io/solid-sdk/app-store/callback.html",
      "https://jeswr.github.io/solid-sdk/app-store/",
    ]);
  });
  it.each([
    "https://other.example/",
    "//other.example/",
    "/missing-slash",
    "/query?x/",
    "/hash#x/",
  ])("rejects an invalid client base: %s", (path) => {
    expect(() => clientIdDocument("https://jeswr.github.io", path)).toThrow("CLIENT_BASE_PATH");
  });
});
