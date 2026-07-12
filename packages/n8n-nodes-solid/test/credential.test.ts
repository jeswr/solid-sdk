// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Credential-shape tests: the SolidApi credential must declare the fields n8n
// stores + injects, mask the token, and inject it as a Bearer header (so the
// node's own code never sees it). These are non-vacuous: they assert the exact
// authenticate template + property options n8n relies on.

import { describe, expect, it } from "vitest";
import { SolidApi } from "../credentials/SolidApi.credentials.js";

describe("SolidApi credential", () => {
  const cred = new SolidApi();

  it("uses the credential type name the node references", () => {
    expect(cred.name).toBe("solidApi");
    expect(cred.displayName).toContain("Solid");
  });

  it("declares a required pod base URL field", () => {
    const podBase = cred.properties.find((p) => p.name === "podBaseUrl");
    expect(podBase).toBeDefined();
    expect(podBase?.type).toBe("string");
    expect(podBase?.required).toBe(true);
  });

  it("declares a required, password-MASKED access token field", () => {
    const token = cred.properties.find((p) => p.name === "accessToken");
    expect(token).toBeDefined();
    expect(token?.type).toBe("string");
    expect(token?.required).toBe(true);
    // The token must be masked so it is never shown in the n8n UI / logs.
    expect((token?.typeOptions as { password?: boolean } | undefined)?.password).toBe(true);
  });

  it("injects the token as an Authorization: Bearer header (generic auth)", () => {
    expect(cred.authenticate.type).toBe("generic");
    const headers = cred.authenticate.properties.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("=Bearer {{$credentials.accessToken}}");
  });

  it("does NOT put the token in a query string (avoid token leaking into URLs/logs)", () => {
    const qs = cred.authenticate.properties.qs as Record<string, string> | undefined;
    expect(qs).toBeUndefined();
  });

  it("defines a credential test request against the pod base", () => {
    expect(cred.test.request.baseURL).toBe("={{$credentials.podBaseUrl}}");
  });
});
