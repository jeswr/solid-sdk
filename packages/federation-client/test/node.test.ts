// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Adversarial tests for the NODE undici-pinning SSRF path (#86) — the full closure of
// the DNS-rebinding (TOCTOU) hole. These tests are exhaustive by intent: the registry
// URL is a user/config-supplied origin, so the pinning fetch is a security boundary.
//
// Two layers are exercised:
//   1. The PINNING DISPATCHER's connect-time lookup (resolve-once → validate-all → pin):
//      private / loopback / link-local / metadata records are REJECTED before any socket
//      opens; a rebinding multi-record set (one public, one private) is rejected; a
//      public set is accepted and returned to undici unchanged.
//   2. The composed NODE GUARDED FETCH end-to-end against REAL local HTTP servers, which
//      proves the pin holds at the SOCKET level: the resolver flips its answer between
//      the guard's validation lookup and the connect-time lookup, and the connection is
//      pinned to the address the connect-time lookup validated — a rebind cannot redirect
//      it to a private host (the connect-time validation refuses the private flip), and a
//      30x to a private IP is blocked at the next hop.
//
// The end-to-end servers bind to 127.0.0.1 (a loopback dev address), so these tests run
// with `allowLoopback: true` — that is the ONLY way to reach a local test server while
// still exercising the real undici connector + the real pinning path. The PURE-rejection
// tests (layer 1) run WITHOUT allowLoopback and assert loopback/private/metadata records
// are refused, which is the production posture.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type AddressInfo, createServer, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetch as undiciFetch } from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SsrfError } from "../src/index.js";
import {
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  nodeGuardedFetch,
  type ResolveAll,
} from "../src/node.js";

/**
 * Promisify the validating lookup's `(err, address, family?)` callback into a tagged
 * result so a test can assert on BOTH the success shape (array vs single) and rejection.
 */
function runLookup(
  lookup: ReturnType<typeof createValidatingLookup>,
  hostname: string,
  opts: { all?: boolean } = {},
): Promise<
  | { ok: true; address: string | Array<{ address: string; family: number }>; family?: number }
  | { ok: false; error: Error }
> {
  return new Promise((resolve) => {
    lookup(hostname, opts, (err, address, family) => {
      if (err) {
        resolve({ ok: false, error: err });
        return;
      }
      resolve({ ok: true, address: address as never, family });
    });
  });
}

/** Flatten an error's `.message` plus every nested `.cause` message into one string. */
function causeChainText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur instanceof Error; depth += 1) {
    parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

// ---------------------------------------------------------------------------
// End-to-end against REAL local HTTP servers, proving the socket pin.
// ---------------------------------------------------------------------------

let good: Server;
let goodPort: number;
let other: Server;
let otherPort: number;
const goodBody = "@prefix ex: <http://example.org/> . ex:s ex:p ex:o .";
const otherBody = "@prefix ex: <http://example.org/> . ex:OTHER ex:p ex:o .";

beforeEach(async () => {
  good = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/turtle" });
    res.end(goodBody);
  });
  other = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/turtle" });
    res.end(otherBody);
  });
  await new Promise<void>((r) => good.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
  goodPort = (good.address() as AddressInfo).port;
  otherPort = (other.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((r) => good.close(() => r()));
  await new Promise<void>((r) => other.close(() => r()));
});

describe("createNodeGuardedFetch — connect-time pin (end-to-end)", () => {
  it("accepts a public-resolving host and pins to the validated address", async () => {
    // The hostname resolves (at BOTH the guard lookup and the connect lookup) to the
    // loopback test server. Under allowLoopback the loopback address is permitted, so
    // the request reaches the good server. This proves the happy path connects through
    // the real undici pinning connector.
    const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({
      allowLoopback: true,
      resolveAll,
      // The guard's OWN URL-level DNS classification (the first resolution) — also
      // loopback, allowed under allowLoopback.
      // (createNodeGuardedFetch threads allowLoopback into both layers.)
    });
    const res = await fetchImpl(`http://localhost:${goodPort}/registry`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(goodBody);
  });

  it("PINS the socket — a rebind to a PRIVATE IP at connect time cannot reach it", async () => {
    // The DNS-rebinding attack: the connect-time resolver returns a NON-public address
    // (link-local cloud-metadata 169.254.169.254). The pinning lookup validates EVERY
    // record at connect time and refuses the non-public one, so no socket to it is ever
    // opened — the request fails closed rather than connecting to the private host.
    const rebinding: ResolveAll = async () => [{ address: "169.254.169.254", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll: rebinding });
    await expect(fetchImpl(`http://localhost:${goodPort}/x`)).rejects.toBeInstanceOf(SsrfError);
  });

  it("http: loopback→PUBLIC flip is refused at connect (no plaintext leak to a public host)", async () => {
    // roborev Medium regression. Under allowLoopback an `http://localhost` dev URL passes
    // the guard's URL check because it resolves to LOOPBACK at validation time. A flip to
    // a PUBLIC address at connect time must NOT be accepted for http: — that would send a
    // plaintext request to a public host. The connect-time pin is protocol-aware and
    // requires loopback-only for http:, so the public flip is refused.
    let call = 0;
    const flipping: ResolveAll = async () => {
      call += 1;
      // 1st (guard URL validation): loopback → http+allowLoopback passes.
      // 2nd (connect-time pin, http: → loopback-only): flips to a PUBLIC IP → refused.
      return call === 1
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    };
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll: flipping });
    const err = await fetchImpl(`http://localhost:${goodPort}/x`).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SsrfError);
    expect(call).toBeGreaterThanOrEqual(2);
    expect(causeChainText(err)).toContain("requires loopback-only");
  });

  it("CORE rebinding case — public at validate, PRIVATE at connect: the connect-time pin refuses it", async () => {
    // The exact TOCTOU race this whole module exists to close. The resolver returns a
    // PUBLIC address on its FIRST call (the guard's URL-level validation passes — a guard
    // that only validated up front would now connect) and a PRIVATE one on its SECOND
    // call (connect time). The connect-time lookup re-validates and REFUSES the flipped
    // private address, so the socket is never opened to the private host. This proves the
    // closure is at CONNECT time, not merely at the earlier URL validation.
    let call = 0;
    const flipping: ResolveAll = async () => {
      call += 1;
      // 1st call (guard URL validation): a real public IP → passes validation.
      // 2nd call (connect-time pin): flips to cloud-metadata link-local → must be refused.
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }];
    };
    const fetchImpl = createNodeGuardedFetch({ resolveAll: flipping });
    const err = await fetchImpl("https://innocent.example/data").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SsrfError);
    expect(call).toBeGreaterThanOrEqual(2); // both validation AND connect-time resolution ran
    // The refusal MUST come from the connect-time pin (not the URL validation, which saw
    // the PUBLIC first answer and passed): assert the connect-time message in the cause
    // chain so a regression that closes the window only at the URL layer is caught.
    expect(causeChainText(err)).toContain("non-public address (169.254.169.254)");
  });

  it("CORE rebinding case (multi-record flip) — connect-time set with one private record is refused", async () => {
    // Same race, but the connect-time flip returns a MULTI-record set whose first record
    // is public and second is private; the every-record-must-pass rule refuses it.
    let call = 0;
    const flipping: ResolveAll = async () => {
      call += 1;
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.7", family: 4 },
          ];
    };
    const fetchImpl = createNodeGuardedFetch({ resolveAll: flipping });
    await expect(fetchImpl("https://innocent.example/data")).rejects.toBeInstanceOf(SsrfError);
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it("rejects a rebinding MULTI-RECORD set (one public, one private) — every record must pass", async () => {
    const mixed: ResolveAll = async () => [
      { address: "127.0.0.1", family: 4 }, // would be allowed under allowLoopback
      { address: "10.0.0.5", family: 4 }, // RFC1918 — fails the whole set
    ];
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll: mixed });
    await expect(fetchImpl(`http://localhost:${goodPort}/x`)).rejects.toBeInstanceOf(SsrfError);
  });

  it("blocks a 30x redirect to a private IP literal at the next hop", async () => {
    // The good server 302s to a private IP literal. The guard re-validates each Location
    // hop and refuses the private literal BEFORE the pinning fetch ever resolves it.
    const redirector = createServer((_req, res) => {
      res.writeHead(302, { location: "http://10.0.0.9/internal" });
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", r));
    const rport = (redirector.address() as AddressInfo).port;
    try {
      const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
      const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll });
      await expect(fetchImpl(`http://localhost:${rport}/start`)).rejects.toBeInstanceOf(SsrfError);
    } finally {
      await new Promise<void>((r) => redirector.close(() => r()));
    }
  });

  it("blocks a 30x redirect to a rebinding HOSTNAME that flips to private only at connect", async () => {
    // The redirect HOP must actually be reached and revalidated — so the redirector is
    // served via a host that ALWAYS resolves to loopback (the initial request succeeds and
    // the 302 is followed). Only the redirect TARGET host (`victim.test`) rebinds: it
    // passes the hop's URL-level validation (loopback), then FLIPS to a private LAN address
    // at connect time, which the connect-time pin refuses. A stateful resolver drives the
    // flip, so this genuinely exercises redirect-hop revalidation + connect-time refusal
    // (roborev Low: the prior version rejected the INITIAL request, never reaching the hop).
    const redirector = createServer((_req, res) => {
      res.writeHead(302, { location: "https://victim.test/internal" });
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", r));
    const rport = (redirector.address() as AddressInfo).port;
    try {
      let victimCalls = 0;
      const resolveAll: ResolveAll = async (host) => {
        if (host === "victim.test") {
          victimCalls += 1;
          // 1st victim call = the hop's URL-level validation → loopback (passes, so the
          // hop is followed). 2nd = connect-time pin → flips to a private LAN address.
          return victimCalls === 1
            ? [{ address: "127.0.0.1", family: 4 }]
            : [{ address: "192.168.1.10", family: 4 }];
        }
        // The redirector host resolves to loopback so the initial request is fetched.
        return [{ address: "127.0.0.1", family: 4 }];
      };
      const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll });
      const err = await fetchImpl(`http://localhost:${rport}/start`).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SsrfError);
      // Proof the failure is the redirect TARGET's connect-time flip, not the initial req:
      // victim.test was resolved at least twice (URL validation + connect-time pin).
      expect(victimCalls).toBeGreaterThanOrEqual(2);
      expect(causeChainText(err)).toContain("192.168.1.10");
    } finally {
      await new Promise<void>((r) => redirector.close(() => r()));
    }
  });

  it("follows a 30x redirect to another PUBLIC-resolving (loopback) host", async () => {
    // Sanity: a legitimate redirect to an allowed host is followed and its body returned.
    const redirector = createServer((_req, res) => {
      res.writeHead(302, { location: `http://localhost:${otherPort}/dest` });
      res.end();
    });
    await new Promise<void>((r) => redirector.listen(0, "127.0.0.1", r));
    const rport = (redirector.address() as AddressInfo).port;
    try {
      const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
      const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll });
      const res = await fetchImpl(`http://localhost:${rport}/start`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(otherBody);
    } finally {
      await new Promise<void>((r) => redirector.close(() => r()));
    }
  });
});

describe("createNodeGuardedFetch — URL-level rejections (strict posture)", () => {
  it("rejects a private IP LITERAL target (no allowLoopback)", async () => {
    const fetchImpl = createNodeGuardedFetch();
    for (const url of [
      "https://10.0.0.1/x",
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/x",
      "https://192.168.0.1/x",
      "https://[fc00::1]/x",
      "https://[fe80::1]/x",
      "https://0.0.0.0/x",
    ]) {
      await expect(fetchImpl(url)).rejects.toBeInstanceOf(SsrfError);
    }
  });

  it("rejects a non-https scheme and userinfo", async () => {
    const fetchImpl = createNodeGuardedFetch();
    await expect(fetchImpl("http://registry.example/x")).rejects.toBeInstanceOf(SsrfError);
    await expect(fetchImpl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
    await expect(fetchImpl("https://user:pass@registry.example/x")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it("rejects a hostname resolving to a private address (Node-branch DNS check)", async () => {
    // Even before connect, the guard's URL-level DNS classification (via the pinning
    // branch) rejects a hostname whose records are private. Here the connect-time
    // resolver is the guard's resolver too (createNodeGuardedFetch shares it), so a
    // private resolution fails at the URL check.
    const resolveAll: ResolveAll = async () => [{ address: "10.1.2.3", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({ resolveAll });
    await expect(fetchImpl("https://innocent.example/x")).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("nodeGuardedFetch (default export) — strict posture wired in", () => {
  it("is a usable fetch that rejects a metadata-IP literal", async () => {
    await expect(nodeGuardedFetch("https://169.254.169.254/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects an http (non-loopback) URL by default", async () => {
    await expect(nodeGuardedFetch("http://registry.example/x")).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("createValidatingLookup — dns.lookup callback contract", () => {
  const publicAddrs: ResolveAll = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
  ];

  it("returns the ARRAY form when all:true (the undici connector path)", async () => {
    const lookup = createValidatingLookup(publicAddrs, false, false);
    const res = await runLookup(lookup, "example.com", { all: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.isArray(res.address)).toBe(true);
      expect(res.address).toHaveLength(2);
    }
  });

  it("returns the SINGLE (address, family) form when all is ABSENT", async () => {
    const lookup = createValidatingLookup(publicAddrs, false, false);
    const res = await runLookup(lookup, "example.com", {}); // no `all` field
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.address).toBe("93.184.216.34");
      expect(res.family).toBe(4);
    }
  });

  it("returns the SINGLE form when all:false", async () => {
    const lookup = createValidatingLookup(publicAddrs, false, false);
    const res = await runLookup(lookup, "example.com", { all: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(typeof res.address).toBe("string");
      expect(res.address).toBe("93.184.216.34");
    }
  });

  it("rejects a private record in BOTH the array and single paths", async () => {
    const priv: ResolveAll = async () => [{ address: "10.0.0.1", family: 4 }];
    const lookup = createValidatingLookup(priv, false, false);
    const a = await runLookup(lookup, "x", { all: true });
    const b = await runLookup(lookup, "x", {});
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
  });

  it("requireLoopbackOnly accepts loopback and rejects a public record", async () => {
    const loop: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const pub: ResolveAll = async () => [{ address: "93.184.216.34", family: 4 }];
    const okRes = await runLookup(createValidatingLookup(loop, true, true), "localhost", {
      all: true,
    });
    const badRes = await runLookup(createValidatingLookup(pub, true, true), "localhost", {
      all: true,
    });
    expect(okRes.ok).toBe(true);
    expect(badRes.ok).toBe(false);
    if (!badRes.ok) {
      expect(badRes.error.message).toContain("requires loopback-only");
    }
  });

  it("rejects when the resolver returns no addresses", async () => {
    const none: ResolveAll = async () => [];
    const res = await runLookup(createValidatingLookup(none, false, false), "x", { all: true });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TLS: pinning the IP must NOT weaken certificate validation. The cert is verified
// against the ORIGINAL hostname (the connector's `servername`), never the pinned IP.
// We stand up a real HTTPS server with a self-signed cert whose SAN is `registry.test`,
// pin `registry.test` → 127.0.0.1, trust the cert as `ca`, and assert the handshake
// validates against the hostname — proving servername is preserved through the pin.
// ---------------------------------------------------------------------------

/** Generate a self-signed cert (SAN DNS:registry.test) via openssl, or null if absent. */
function makeCert(dir: string): { key: Buffer; cert: Buffer } | null {
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "2",
        "-subj",
        "/CN=registry.test",
        "-addext",
        "subjectAltName=DNS:registry.test",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    return { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
  } catch {
    return null;
  }
}

describe("createNodeGuardedFetch — TLS servername preserved under IP pin", () => {
  let dir: string;
  let creds: { key: Buffer; cert: Buffer } | null;
  let server: HttpsServer | undefined;
  let port = 0;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "fedclient-tls-"));
    creds = makeCert(dir);
    if (!creds) {
      return;
    }
    server = createHttpsServer({ key: creds.key, cert: creds.cert }, (_req, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(goodBody);
    });
    await new Promise<void>((r) => (server as HttpsServer).listen(0, "127.0.0.1", r));
    port = ((server as HttpsServer).address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((r) => (server as HttpsServer).close(() => r()));
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("validates the cert against the hostname (not the pinned IP) and connects", async ({
    skip,
  }) => {
    if (!creds) {
      skip(); // openssl unavailable on this box
      return;
    }
    // Pin registry.test → 127.0.0.1 (where the HTTPS server actually listens). The cert's
    // SAN is registry.test, so validation succeeds ONLY because servername stayed the
    // hostname through the pin. allowLoopback lets the loopback pin address through.
    const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({
      allowLoopback: true,
      resolveAll,
      ca: creds.cert,
    });
    const res = await fetchImpl(`https://registry.test:${port}/registry`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(goodBody);
  });

  it("the cert is matched against the connect host — a bare-IP host fails the SAN", async ({
    skip,
  }) => {
    if (!creds) {
      skip();
      return;
    }
    // Counter-test confirming validation is genuine (not disabled): reaching the SAME
    // server by its IP host (127.0.0.1, allowed here only under allowLoopback) sends
    // servername=127.0.0.1, which does NOT match the cert SAN (registry.test), so the TLS
    // handshake FAILS and the guard surfaces an SsrfError. This proves (a) we never set
    // rejectUnauthorized:false, and (b) the cert is checked against the connect host —
    // so the hostname path's success above is real cert validation, not a no-op.
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, ca: creds.cert });
    await expect(fetchImpl(`https://127.0.0.1:${port}/registry`)).rejects.toBeInstanceOf(SsrfError);
  });
});

describe("createPinningDispatcher — protocol-aware http-loopback-only (parity guard, roborev Medium)", () => {
  // This package OWNS createPinningDispatcher (rather than re-exporting guarded-fetch's) to
  // preserve its prior, stricter posture on this low-level escape hatch: an http: connect must
  // use a LOOPBACK-ONLY validating lookup, so even under allowLoopback:true a plaintext http:
  // request can NEVER reach a PUBLIC host at connect time. These tests drive the bare dispatcher
  // through undici.fetch (no shared guard) — the exact path a regression would surface on.

  /** The connect-error message undici surfaces in `.cause` (it wraps it as "fetch failed"). */
  async function connectError(fn: () => Promise<unknown>): Promise<string> {
    try {
      await fn();
      return "(no error — request was ALLOWED)";
    } catch (e) {
      const cause = (e as { cause?: unknown }).cause;
      const causeMsg = cause instanceof Error ? cause.message : "";
      return causeMsg || (e as Error).message;
    }
  }

  it("REFUSES http: OUTRIGHT under DEFAULT options (allowLoopback=false) — no loopback service reach (roborev High)", async () => {
    // roborev High: the loopback-only connector accepts loopback addresses regardless of
    // allowLoopback, so selecting it for http: when allowLoopback is FALSE would let a
    // bare-dispatcher consumer reach http://localhost / 127.x / ::1 with the DEFAULT
    // (production) options. The dispatcher must refuse http: OUTRIGHT unless allowLoopback is
    // set — stricter than even the prior dispatcher. We drive a loopback-resolving host so the
    // ONLY thing that can block it is the http:+!allowLoopback gate.
    const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const dispatcher = createPinningDispatcher({ resolveAll }); // allowLoopback defaults false
    try {
      const msg = await connectError(() =>
        undiciFetch("http://localhost/x", { dispatcher, redirect: "manual" } as never),
      );
      expect(msg).toMatch(/http:.*allowLoopback|allowLoopback.*http:|dev only/i);
    } finally {
      await dispatcher.close().catch(() => {});
    }
  });

  it("REFUSES http: to a PUBLIC-resolving host at connect, even with allowLoopback:true", async () => {
    // The regression case: guarded-fetch's bare dispatcher (loopback-only nuance only in
    // createNodeGuardedFetch) would ALLOW this; our protocol-aware dispatcher must REFUSE it.
    // undici wraps the connect refusal as "fetch failed" with the real reason in `.cause`.
    const resolveAll: ResolveAll = async () => [{ address: "93.184.216.34", family: 4 }];
    const dispatcher = createPinningDispatcher({ allowLoopback: true, resolveAll });
    try {
      const msg = await connectError(() =>
        undiciFetch("http://public.example/x", { dispatcher, redirect: "manual" } as never),
      );
      expect(msg).toMatch(/loopback-only|not loopback/i);
    } finally {
      await dispatcher.close().catch(() => {});
    }
  });

  it("REFUSES https: to a PRIVATE-resolving host at connect (no allowLoopback)", async () => {
    const resolveAll: ResolveAll = async () => [{ address: "10.0.0.1", family: 4 }];
    const dispatcher = createPinningDispatcher({ resolveAll });
    try {
      const msg = await connectError(() =>
        undiciFetch("https://private.example/x", { dispatcher, redirect: "manual" } as never),
      );
      expect(msg).toMatch(/non-public address|not loopback/i);
    } finally {
      await dispatcher.close().catch(() => {});
    }
  });

  it("ALLOWS http: to a LOOPBACK host at connect under allowLoopback (the legitimate dev path)", async () => {
    // A real local http server on 127.0.0.1: the loopback-only http: connector permits it.
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end(goodBody);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const dispatcher = createPinningDispatcher({ allowLoopback: true, resolveAll });
    try {
      const res = await undiciFetch(`http://localhost:${port}/registry`, {
        dispatcher,
        redirect: "manual",
      } as never);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(goodBody);
    } finally {
      await dispatcher.close().catch(() => {});
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
