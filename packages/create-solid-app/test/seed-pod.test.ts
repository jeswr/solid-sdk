// AUTHORED-BY Claude Opus 4.8
/**
 * --seed-pod boots a local in-memory CSS on :3088 and the printed credentials
 * actually log in (client-credentials DPoP token request succeeds). Skipped
 * unless RUN_SLOW=1 because CSS boot is ~15s.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  requestClientCredentialsToken,
  SEED_POD_PORT,
  type SeededPod,
  seedPod,
} from "../src/seed-pod.ts";

const RUN = process.env["RUN_SLOW"] === "1";

/**
 * Fast, network-free guard on the port-reuse path: if something is already listening on the seed
 * port but it is NOT the seeded CSS (no `alice` login / no client-credentials), seedPod must fail
 * with an actionable error instead of returning fallback creds pointing at a foreign server.
 */
describe("seedPod port-reuse verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // `restoreAllMocks` does NOT undo `vi.stubGlobal`; without this the faked `fetch` leaks into
    // later tests in the same worker.
    vi.unstubAllGlobals();
  });

  it("fails loudly when the reused listener is not the seeded CSS", async () => {
    const base = `http://localhost:${SEED_POD_PORT}/`;
    // Base responds OK (so the port looks "in use" -> reuse path), but the .account control API
    // returns no login URL, so provisionClientCredentials yields undefined.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === base) return new Response("ok", { status: 200 });
        // .account/ control document with no password.login control.
        return new Response(JSON.stringify({ controls: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await expect(seedPod()).rejects.toThrow(/not the seeded CSS|not have the seeded "alice"/);
  });
});

describe.skipIf(!RUN)("seedPod (slow — boots CSS)", () => {
  let pod: SeededPod | undefined;

  afterAll(async () => {
    if (pod) await pod.stop();
  });

  it("boots CSS on :3088, seeds an account, and the credentials mint a token", async () => {
    pod = await seedPod();
    expect(pod.baseUrl).toBe("http://localhost:3088/");
    expect(pod.webId).toMatch(/^http:\/\/localhost:3088\/alice\/profile\/card#me$/);

    // The pod is reachable.
    const res = await fetch(pod.baseUrl);
    expect(res.ok).toBe(true);

    // The printed credentials actually log in.
    expect(pod.clientId, "client-credentials not provisioned").toBeTruthy();
    const token = await requestClientCredentialsToken(pod);
    expect(token.ok, `token request failed (status ${token.status})`).toBe(true);
    expect(token.accessToken).toBeTruthy();
  }, 240_000);
});
