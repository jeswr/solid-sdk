// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  type AssertionBundle,
  type AuthenticationResponseJSON,
  BUNDLE_VERSION,
  decodeAssertionBundle,
  encodeAssertionBundle,
  encodeBase64url,
  MalformedBundleError,
} from "../../src/protocol/index.js";

const credential: AuthenticationResponseJSON = {
  id: "Y3JlZC1pZA",
  rawId: "Y3JlZC1pZA",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
    authenticatorData: "YXV0aERhdGE",
    signature: "c2ln",
    userHandle: "dXNlcg",
  },
  clientExtensionResults: {},
  type: "public-key",
};

const bundle: AssertionBundle = { version: BUNDLE_VERSION, credential };

describe("assertion bundle codec", () => {
  it("round-trips a bundle through encode/decode", () => {
    const token = encodeAssertionBundle(bundle);
    expect(decodeAssertionBundle(token)).toEqual(bundle);
  });

  it("produces url-safe base64 with no padding", () => {
    const token = encodeAssertionBundle(bundle);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects an unknown bundle version", () => {
    const token = encodeBase64url(JSON.stringify({ version: 2, credential }));
    expect(() => decodeAssertionBundle(token)).toThrow(MalformedBundleError);
    expect(() => decodeAssertionBundle(token)).toThrow(/version/i);
  });

  it("rejects a missing version", () => {
    const token = encodeBase64url(JSON.stringify({ credential }));
    expect(() => decodeAssertionBundle(token)).toThrow(MalformedBundleError);
  });

  it("rejects a bundle without credential", () => {
    const token = encodeBase64url(JSON.stringify({ version: BUNDLE_VERSION }));
    expect(() => decodeAssertionBundle(token)).toThrow(/credential/);
  });

  it("rejects a null credential", () => {
    const token = encodeBase64url(JSON.stringify({ version: BUNDLE_VERSION, credential: null }));
    expect(() => decodeAssertionBundle(token)).toThrow(/credential/);
  });

  it("rejects non-base64url input", () => {
    expect(() => decodeAssertionBundle("not valid!! base64url")).toThrow(MalformedBundleError);
  });

  it("rejects valid base64url that is not JSON", () => {
    expect(() => decodeAssertionBundle(encodeBase64url("hello"))).toThrow(/JSON/);
  });

  it("rejects a JSON primitive", () => {
    const token = encodeBase64url(JSON.stringify("a string"));
    expect(() => decodeAssertionBundle(token)).toThrow(MalformedBundleError);
  });

  it("rejects JSON null", () => {
    const token = encodeBase64url(JSON.stringify(null));
    expect(() => decodeAssertionBundle(token)).toThrow(MalformedBundleError);
  });

  it("rejects a JSON array", () => {
    const token = encodeBase64url(JSON.stringify([1, 2, 3]));
    // Arrays are objects; they fail at the version check with a clean error.
    expect(() => decodeAssertionBundle(token)).toThrow(MalformedBundleError);
  });

  describe("inner AuthenticatorAssertionResponseJSON validation", () => {
    function tokenWith(over: Record<string, unknown>): string {
      return encodeBase64url(
        JSON.stringify({
          version: BUNDLE_VERSION,
          credential: { ...credential, ...over },
        }),
      );
    }

    function responseWithout(field: string): string {
      const { [field]: _omit, ...rest } = credential.response as unknown as Record<string, unknown>;
      return encodeBase64url(
        JSON.stringify({
          version: BUNDLE_VERSION,
          credential: { ...credential, response: rest },
        }),
      );
    }

    it("accepts a credential without the optional userHandle", () => {
      const token = responseWithout("userHandle");
      expect(() => decodeAssertionBundle(token)).not.toThrow();
    });

    it("accepts a credential with a null userHandle", () => {
      const token = encodeBase64url(
        JSON.stringify({
          version: BUNDLE_VERSION,
          credential: {
            ...credential,
            response: { ...credential.response, userHandle: null },
          },
        }),
      );
      expect(() => decodeAssertionBundle(token)).not.toThrow();
    });

    it("rejects a missing credential.id", () => {
      expect(() => decodeAssertionBundle(tokenWith({ id: undefined }))).toThrow(/id/);
    });

    it("rejects an empty credential.id", () => {
      expect(() => decodeAssertionBundle(tokenWith({ id: "" }))).toThrow(/id/);
    });

    it("rejects a non-base64url credential.id (illegal chars / padding)", () => {
      expect(() => decodeAssertionBundle(tokenWith({ id: "not base64!" }))).toThrow(/base64url/);
      expect(() => decodeAssertionBundle(tokenWith({ id: "AAAA==" }))).toThrow(/base64url/);
    });

    it("rejects a missing rawId", () => {
      expect(() => decodeAssertionBundle(tokenWith({ rawId: undefined }))).toThrow(/rawId/);
    });

    it("rejects a non-base64url response.signature", () => {
      const token = encodeBase64url(
        JSON.stringify({
          version: BUNDLE_VERSION,
          credential: {
            ...credential,
            response: { ...credential.response, signature: "has spaces!" },
          },
        }),
      );
      expect(() => decodeAssertionBundle(token)).toThrow(/base64url/);
    });

    it('rejects a non-"public-key" type', () => {
      expect(() => decodeAssertionBundle(tokenWith({ type: "totally-fake" }))).toThrow(
        /public-key/,
      );
    });

    it("rejects a missing response object", () => {
      expect(() => decodeAssertionBundle(tokenWith({ response: undefined }))).toThrow(/response/);
    });

    it("rejects a null response object", () => {
      expect(() => decodeAssertionBundle(tokenWith({ response: null }))).toThrow(/response/);
    });

    it("rejects a response missing clientDataJSON", () => {
      expect(() => decodeAssertionBundle(responseWithout("clientDataJSON"))).toThrow(
        /clientDataJSON/,
      );
    });

    it("rejects a response missing authenticatorData", () => {
      expect(() => decodeAssertionBundle(responseWithout("authenticatorData"))).toThrow(
        /authenticatorData/,
      );
    });

    it("rejects a response missing signature", () => {
      expect(() => decodeAssertionBundle(responseWithout("signature"))).toThrow(/signature/);
    });

    it("rejects a non-string userHandle", () => {
      const token = encodeBase64url(
        JSON.stringify({
          version: BUNDLE_VERSION,
          credential: {
            ...credential,
            response: { ...credential.response, userHandle: 42 },
          },
        }),
      );
      expect(() => decodeAssertionBundle(token)).toThrow(/userHandle/);
    });
  });
});
