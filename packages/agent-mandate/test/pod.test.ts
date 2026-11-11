// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildBitstringStatusListCredential,
  issue,
  publishVerificationMethod,
  statusListCredentialToTurtle,
  withStatusBit,
} from "@jeswr/solid-vc";
import { beforeAll, expect, it, vi } from "vitest";
import { mandateToTurtle } from "../src/document.js";
import { issueMandate } from "../src/mandate.js";
import { createPodMandateVerifier, type PodMandateOptions } from "../src/pod.js";
import { ACTOR, clock, edKey, ID, mandate, NOW, OWNER, STATUS } from "./helpers.js";

let body: string;
let differentBody: string;
let status: string;
let revoked: string;
let profile: string;
beforeAll(async () => {
  const key = await edKey();
  profile = (
    await publishVerificationMethod({
      controller: OWNER,
      verificationMethod: key.verificationMethod,
      key,
    })
  ).turtle;
  body = await mandateToTurtle(
    await issueMandate(mandate(), key, { statusListCredential: STATUS, statusListIndex: "1" }),
  );
  differentBody = await mandateToTurtle(
    await issueMandate({ ...mandate(), id: `${ID}-different` }, key, {
      statusListCredential: STATUS,
      statusListIndex: "1",
    }),
  );
  const list = await buildBitstringStatusListCredential({
    id: STATUS,
    issuer: OWNER,
    statusPurpose: "revocation",
    validFrom: NOW.toISOString(),
    validUntil: "2026-11-26T12:00:00.000Z",
  });
  status = await statusListCredentialToTurtle(
    await issue({ credential: list, key, options: { created: NOW } }),
  );
  revoked = await statusListCredentialToTurtle(
    await issue({ credential: await withStatusBit(list, 1, true), key, options: { created: NOW } }),
  );
});
function options(patch: Partial<PodMandateOptions> = {}): PodMandateOptions {
  return {
    credentialUrl: ID,
    ownerWebId: OWNER,
    agentId: ACTOR,
    now: clock,
    fetch: async (input, init) => {
      if (String(input) === ID) {
        expect(new Headers(init?.headers).get("accept")).toBe("application/trig");
        expect(init?.redirect).toBe("manual");
        return new Response(body);
      }
      if (String(input) === STATUS)
        return new Response(status, { headers: { "content-type": "application/trig" } });
      return new Response(profile, { headers: { "content-type": "text/turtle" } });
    },
    ...patch,
  };
}
it("loads a real signed mandate with confirmed-clear signed status and authoritative WebID key", async () => {
  expect(await createPodMandateVerifier(options()).load()).toMatchObject({
    id: ID,
    issuer: OWNER,
    subject: ACTOR,
  });
  const opts = options();
  expect(
    await createPodMandateVerifier(options({ profileFetch: opts.fetch })).load(),
  ).toMatchObject({ id: ID, issuer: OWNER, subject: ACTOR });
});
it("refreshes the injected time and status on every load", async () => {
  let expired = false;
  const verifier = createPodMandateVerifier(
    options({ now: () => (expired ? new Date("2027-01-01") : NOW) }),
  );
  expect(await verifier.load()).toBeDefined();
  expired = true;
  expect(await verifier.load()).toBeUndefined();
  vi.useFakeTimers();
  try {
    vi.setSystemTime(NOW);
    expect(await createPodMandateVerifier({ ...options(), now: undefined }).load()).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
  expect(
    await createPodMandateVerifier(
      options({
        now: () => {
          throw new Error("private clock error");
        },
      }),
    ).load(),
  ).toBeUndefined();
});
it("rejects revoked and unreachable status", async () => {
  for (const response of [
    new Response(revoked, { headers: { "content-type": "application/trig" } }),
    new Response(null, { status: 503 }),
  ]) {
    const opts = options();
    expect(
      await createPodMandateVerifier(
        options({
          fetch: (url, init) =>
            String(url) === STATUS ? Promise.resolve(response) : opts.fetch(url, init),
        }),
      ).load(),
    ).toBeUndefined();
  }
});
it("reloads owner key control and revocation status on every load", async () => {
  let withdrawn = false;
  const keys = createPodMandateVerifier(
    options({
      profileFetch: async () =>
        withdrawn
          ? new Response(null, { status: 404 })
          : new Response(profile, { headers: { "content-type": "text/turtle" } }),
    }),
  );
  expect(await keys.load()).toBeDefined();
  withdrawn = true;
  expect(await keys.load()).toBeUndefined();

  let revokedNow = false;
  const opts = options();
  const statuses = createPodMandateVerifier(
    options({
      fetch: (url, init) =>
        String(url) === STATUS
          ? Promise.resolve(
              new Response(revokedNow ? revoked : status, {
                headers: { "content-type": "application/trig" },
              }),
            )
          : opts.fetch(url, init),
    }),
  );
  expect(await statuses.load()).toBeDefined();
  revokedNow = true;
  expect(await statuses.load()).toBeUndefined();
});
it("rejects an id mismatch, malformed document and missing body", async () => {
  for (const response of [
    new Response(differentBody),
    new Response("invalid"),
    new Response(null),
  ]) {
    const opts = options();
    expect(
      await createPodMandateVerifier(
        options({
          fetch: (url, init) =>
            String(url) === ID ? Promise.resolve(response) : opts.fetch(url, init),
        }),
      ).load(),
    ).toBeUndefined();
  }
});
it("rejects every failed response, redirects, oversized bytes and thrown I/O", async () => {
  const redirected = new Response(body);
  Object.defineProperty(redirected, "redirected", { value: true });
  const wrongUrl = new Response(body);
  Object.defineProperty(wrongUrl, "url", { value: "https://foreign.example/secret" });
  const sameUrl = new Response(body);
  Object.defineProperty(sameUrl, "url", { value: ID });
  const opts = options();
  expect(
    await createPodMandateVerifier(
      options({
        fetch: (url, init) =>
          String(url) === ID ? Promise.resolve(sameUrl) : opts.fetch(url, init),
      }),
    ).load(),
  ).toBeDefined();
  for (const response of [
    new Response(null, { status: 302 }),
    new Response(null, { status: 404 }),
    redirected,
    wrongUrl,
    new Response("é".repeat(131073)),
  ])
    expect(
      await createPodMandateVerifier(options({ fetch: async () => response })).load(),
    ).toBeUndefined();
  expect(
    await createPodMandateVerifier(
      options({
        fetch: async () => {
          throw Error("private URL");
        },
      }),
    ).load(),
  ).toBeUndefined();
  // The byte bound is inclusive, and chunks can split a multibyte code point.
  const padded = body + " ".repeat(256 * 1024 - new TextEncoder().encode(body).length);
  expect(
    await createPodMandateVerifier(
      options({
        fetch: (url, init) =>
          String(url) === ID ? Promise.resolve(new Response(padded)) : opts.fetch(url, init),
      }),
    ).load(),
  ).toBeDefined();
});
it.each([
  "invalid",
  "https://pod.example/wrong/default.trig",
  "https://pod.example/agent/mandates/nested/default.trig",
])("refuses wrong status location %s", (credentialUrl) => {
  expect(() => createPodMandateVerifier(options({ credentialUrl }))).toThrow(
    "Invalid mandate status location",
  );
});
