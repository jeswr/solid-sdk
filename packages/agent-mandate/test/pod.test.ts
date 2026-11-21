// AUTHORED-BY Codex GPT-6.1-Sol

import * as solidVc from "@jeswr/solid-vc";
import {
  buildBitstringStatusListCredential,
  issue,
  publishVerificationMethod,
  statusListCredentialToTurtle,
  withStatusBit,
} from "@jeswr/solid-vc";
import { Writer } from "n3";
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
it("bypasses HTTP caches for credential, status and profile evidence", async () => {
  const base = options();
  const seen: {
    url: string;
    cache: RequestInit["cache"];
    redirect: RequestInit["redirect"];
  }[] = [];
  const record =
    (inner: typeof base.fetch): typeof base.fetch =>
    async (input, init) => {
      seen.push({ url: String(input), cache: init?.cache, redirect: init?.redirect });
      return inner(input, init);
    };
  expect(
    await createPodMandateVerifier(
      options({ fetch: record(base.fetch), profileFetch: record(base.fetch) }),
    ).load(),
  ).toBeDefined();
  expect(seen.some((call) => call.url === ID)).toBe(true);
  expect(seen.some((call) => call.url === STATUS)).toBe(true);
  expect(seen.some((call) => call.url !== ID && call.url !== STATUS)).toBe(true);
  expect(seen.every((call) => call.cache === "no-store")).toBe(true);
  expect(seen.every((call) => call.redirect === "manual")).toBe(true);
});
it("cancels an oversized streamed profile before consuming the remainder", async () => {
  const chunks = [
    new TextEncoder().encode(profile),
    new TextEncoder().encode("é".repeat(128 * 1024)),
    new Uint8Array([1]),
  ];
  let consumed = 0;
  const cancelled = vi.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(chunks[consumed++] as Uint8Array);
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    ),
    { headers: { "content-type": "text/turtle" } },
  );
  const unboundedRead = vi.spyOn(response, "text");
  expect(
    await createPodMandateVerifier(options({ profileFetch: async () => response })).load(),
  ).toBeUndefined();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(consumed).toBe(2);
  expect(response.body?.locked).toBe(false);
  expect(unboundedRead).not.toHaveBeenCalled();
});
it("accepts a streamed profile of exactly 256 KiB", async () => {
  const bytes = new TextEncoder().encode(profile);
  const padding = new Uint8Array(256 * 1024 - bytes.byteLength).fill(32);
  const cancelled = vi.fn();
  expect(
    await createPodMandateVerifier(
      options({
        profileFetch: async (input) => {
          const response = new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(bytes);
                controller.enqueue(padding);
                controller.close();
              },
              cancel: cancelled,
            }),
            { status: 202, statusText: "Evidence", headers: { "content-type": "text/turtle" } },
          );
          Object.defineProperty(response, "url", { value: String(input) });
          return response;
        },
      }),
    ).load(),
  ).toMatchObject({ id: ID });
  expect(cancelled).not.toHaveBeenCalled();
});
it("preserves an absent content-type header when bounding profile bodies", async () => {
  expect(
    await createPodMandateVerifier(
      options({
        profileFetch: async () => new Response(new TextEncoder().encode(profile)),
      }),
    ).load(),
  ).toMatchObject({ id: ID });
});
it("bounds the separate signing key document for a signed status list", async () => {
  const mandateKey = await edKey();
  const statusKey = { ...(await edKey()), verificationMethod: "https://keys.example/status#key" };
  const published = await Promise.all(
    [mandateKey, statusKey].map((key) => publishVerificationMethod({ controller: OWNER, key })),
  );
  const writer = new Writer();
  for (const document of published) writer.addQuads([...document.quads]);
  const ownerProfile = await new Promise<string>((resolve, reject) => {
    writer.end((error, text) => (error ? reject(error) : resolve(text)));
  });
  const credential = await mandateToTurtle(
    await issueMandate(mandate(), mandateKey, {
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
  const signedStatus = await statusListCredentialToTurtle(
    await issue({ credential: list, key: statusKey, options: { created: NOW } }),
  );
  let oversized = false;
  let consumed = 0;
  const cancelled = vi.fn();
  const verifier = createPodMandateVerifier(
    options({
      fetch: async (input) =>
        new Response(String(input) === ID ? credential : signedStatus, {
          headers: { "content-type": "application/trig" },
        }),
      profileFetch: async (input) => {
        if (String(input) === "https://keys.example/status" && oversized) {
          return new Response(
            new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  consumed++;
                  controller.enqueue(new Uint8Array(256 * 1024 + 1));
                },
                cancel: cancelled,
              },
              { highWaterMark: 0 },
            ),
            { headers: { "content-type": "text/turtle" } },
          );
        }
        return new Response(ownerProfile, { headers: { "content-type": "text/turtle" } });
      },
    }),
  );
  expect(await verifier.load()).toMatchObject({ id: ID });
  oversized = true;
  expect(await verifier.load()).toBeUndefined();
  expect(cancelled).toHaveBeenCalledOnce();
  expect(consumed).toBe(1);
});
it("fails closed and releases the reader when reading or cancelling fails", async () => {
  for (const kind of ["read", "cancel"] as const) {
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (kind === "read") controller.error(new Error("private read error"));
            else controller.enqueue(new Uint8Array(256 * 1024 + 1));
          },
          cancel() {
            throw new Error("private cancellation error");
          },
        },
        { highWaterMark: 0 },
      ),
    );
    expect(
      await createPodMandateVerifier(options({ profileFetch: async () => response })).load(),
    ).toBeUndefined();
    expect(response.body?.locked).toBe(false);
  }
});
it("keeps profile response status, headers, URL and redirect evidence when bounding bodies", async () => {
  for (const kind of [
    "failed",
    "manual-redirect",
    "redirected",
    "wrong-url",
    "missing-body",
  ] as const) {
    const response = new Response(kind === "missing-body" ? null : profile, {
      status: kind === "failed" ? 404 : kind === "manual-redirect" ? 302 : 200,
      headers: { "content-type": "text/turtle" },
    });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    if (kind === "wrong-url")
      Object.defineProperty(response, "url", { value: "https://foreign.example/profile" });
    expect(
      await createPodMandateVerifier(options({ profileFetch: async () => response })).load(),
      kind,
    ).toBeUndefined();
  }
});
it.each([
  "http://owner.example/profile#key",
  "http://localhost/key",
  "http://127.0.0.1/key",
  "http://[::1]/key",
])("refuses HTTP key %s without requesting it", async (verificationMethod) => {
  const key = { ...(await edKey()), verificationMethod };
  const published = await publishVerificationMethod({ controller: OWNER, key });
  const credential = await mandateToTurtle(
    await issueMandate(mandate(), key, { statusListCredential: STATUS, statusListIndex: "1" }),
  );
  const inner = vi.fn(
    async (_input: Parameters<PodMandateOptions["fetch"]>[0]) =>
      new Response(published.turtle, { headers: { "content-type": "text/turtle" } }),
  );
  expect(
    await createPodMandateVerifier(
      options({
        fetch: async () => new Response(credential),
        profileFetch: inner,
      }),
    ).load(),
  ).toBeUndefined();
  expect(inner).toHaveBeenCalledOnce();
  expect(String(inner.mock.calls[0]?.[0])).toBe(new URL(OWNER).href.split("#")[0]);
});
it("refuses an HTTP controller profile after resolving its HTTPS key document", async () => {
  const owner = "http://owner.example/profile#me";
  const key = await edKey();
  const published = await publishVerificationMethod({ controller: owner, key });
  const credential = await mandateToTurtle(
    await issueMandate({ ...mandate(), issuer: owner }, key, {
      statusListCredential: STATUS,
      statusListIndex: "1",
    }),
  );
  const inner = vi.fn(
    async (_input: Parameters<PodMandateOptions["fetch"]>[0]) =>
      new Response(published.turtle, { headers: { "content-type": "text/turtle" } }),
  );
  expect(
    await createPodMandateVerifier(
      options({
        ownerWebId: owner,
        fetch: async () => new Response(credential),
        profileFetch: inner,
      }),
    ).load(),
  ).toBeUndefined();
  expect(inner).toHaveBeenCalledOnce();
  expect(String(inner.mock.calls[0]?.[0])).toBe(new URL(key.verificationMethod).href.split("#")[0]);
});
it("refuses HTTP status transport requests, including Request inputs, before I/O", async () => {
  const base = options();
  const inner = vi.fn(base.fetch);
  const checked = vi.fn();
  // The configured status URL is HTTPS. Exercise the delegated resolver's transport
  // directly so its own validation cannot mask the wrapper's protocol check.
  const resolver = vi
    .spyOn(solidVc, "createBitstringStatusResolver")
    .mockImplementationOnce((config) => async () => {
      const delegated = config.fetch;
      if (!delegated) throw new Error("Missing evidence transport");
      for (const input of [
        "http://pod.example/agent/mandates/status.ttl",
        new URL("http://localhost/status"),
        new Request("http://127.0.0.1/status"),
      ]) {
        await expect(delegated(input)).rejects.toThrow("Evidence requires HTTPS");
      }
      const response = await delegated(new Request(STATUS), {
        cache: "force-cache",
        redirect: "follow",
      });
      expect(response.ok).toBe(true);
      checked();
      return { status: "unreachable", reason: "Transport exercised" };
    });
  try {
    expect(
      await createPodMandateVerifier(options({ fetch: inner, profileFetch: base.fetch })).load(),
    ).toBeUndefined();
    expect(resolver).toHaveBeenCalledOnce();
    expect(checked).toHaveBeenCalledOnce();
    expect(
      inner.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input)),
    ).toEqual([ID, STATUS]);
    expect(inner.mock.calls[1]?.[1]).toMatchObject({ cache: "no-store", redirect: "manual" });
  } finally {
    resolver.mockRestore();
  }
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
  "http://pod.example/agent/mandates/default.trig",
  "https://pod.example/agent/mandates/nested/default.trig",
])("refuses wrong status location %s", (credentialUrl) => {
  expect(() => createPodMandateVerifier(options({ credentialUrl }))).toThrow(
    "Invalid mandate status location",
  );
});
