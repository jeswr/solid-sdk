// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  BUNDLE_VERSION,
  TOKEN_EXCHANGE_GRANT_TYPE,
  WEBAUTHN_ASSERTION_TOKEN_TYPE,
} from "../../src/protocol/index.js";

describe("constants", () => {
  it("pins the WebAuthn assertion token-type URN", () => {
    expect(WEBAUTHN_ASSERTION_TOKEN_TYPE).toBe("urn:solid:token-type:webauthn-assertion");
  });

  it("pins the RFC 8693 token-exchange grant type", () => {
    expect(TOKEN_EXCHANGE_GRANT_TYPE).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
  });

  it("pins the bundle version to 1", () => {
    expect(BUNDLE_VERSION).toBe(1);
  });
});
