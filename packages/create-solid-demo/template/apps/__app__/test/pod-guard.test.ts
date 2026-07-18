/**
 * The sample pod route's fail-closed contract, exercised through the REAL route
 * module (no mocked guard):
 *  - configured issuers + anonymous request ⇒ 401 with a WWW-Authenticate challenge
 *    BEFORE any validation;
 *  - unconfigured issuer allowlist ⇒ 503 (the rail fails closed, never open).
 */
import { beforeEach, expect, test, vi } from "vitest";

const ISSUERS_VAR = "__CSD_ENV_PREFIX___TRUSTED_OIDC_ISSUERS";
const ROUTE_URL = "https://__CSD_APP_SLUG__.example/api/pod/example";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

test("anonymous request is 401 before anything else (issuers configured)", async () => {
  vi.stubEnv(ISSUERS_VAR, "https://issuer.example");
  const { POST } = await import("../app/api/pod/example/route");
  const response = await POST(new Request(ROUTE_URL, { method: "POST" }));
  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBeTruthy();
});

test("unconfigured issuer allowlist fails closed with 503", async () => {
  vi.stubEnv(ISSUERS_VAR, "");
  const { POST } = await import("../app/api/pod/example/route");
  const response = await POST(new Request(ROUTE_URL, { method: "POST" }));
  expect(response.status).toBe(503);
});
