// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * CHARACTERIZATION TESTS — the NODE undici-pinning SSRF path (`@jeswr/guarded-fetch/node`),
 * the full closure of the DNS-rebinding (TOCTOU) hole. Ported from federation-client
 * `node.test.ts` + the solid-agent-notify guardedFetch end-to-end suite. Exhaustive by intent:
 * the URL is an attacker-influenceable origin, so the pinning fetch is a security boundary.
 *
 * Two layers exercised:
 *   1. The PINNING DISPATCHER's connect-time lookup (resolve-once → validate-all → pin):
 *      private/loopback/link-local/metadata records REJECTED before any socket opens; a
 *      rebinding multi-record set rejected; a public set accepted and returned to undici.
 *   2. The composed NODE GUARDED FETCH end-to-end against REAL local HTTP servers, proving the
 *      pin holds at the SOCKET level: the resolver flips its answer between the guard's
 *      validation lookup and the connect-time lookup, and the connection is pinned to the
 *      validated address — a rebind cannot redirect it to a private host, and a 30x to a
 *      private IP is blocked at the next hop.
 *
 * End-to-end servers bind to 127.0.0.1, so those tests run with `allowLoopback: true` — the
 * ONLY way to reach a local test server while exercising the real undici connector. The
 * PURE-rejection tests run WITHOUT allowLoopback (the production posture).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { type AddressInfo, createServer, Agent as HttpAgent, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SsrfError } from "../src/index.js";
import {
  createNodeGuardedFetch,
  createPinningDispatcher,
  createValidatingLookup,
  nodeGuardedFetch,
  type ResolveAll,
} from "../src/node.js";

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

function causeChainText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 10 && cur instanceof Error; depth += 1) {
    parts.push(cur.message);
    cur = (cur as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

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
    const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll });
    const res = await fetchImpl(`http://localhost:${goodPort}/registry`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(goodBody);
  });

  it("PINS the socket — a rebind to a PRIVATE IP at connect time cannot reach it", async () => {
    const rebinding: ResolveAll = async () => [{ address: "169.254.169.254", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll: rebinding });
    await expect(fetchImpl(`http://localhost:${goodPort}/x`)).rejects.toBeInstanceOf(SsrfError);
  });

  it("http: loopback→PUBLIC flip is refused at connect (no plaintext leak to a public host)", async () => {
    let call = 0;
    const flipping: ResolveAll = async () => {
      call += 1;
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
    let call = 0;
    const flipping: ResolveAll = async () => {
      call += 1;
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
    expect(call).toBeGreaterThanOrEqual(2);
    expect(causeChainText(err)).toContain("169.254.169.254");
  });

  it("CORE rebinding case (multi-record flip) — connect-time set with one private record is refused", async () => {
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
      { address: "127.0.0.1", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ];
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll: mixed });
    await expect(fetchImpl(`http://localhost:${goodPort}/x`)).rejects.toBeInstanceOf(SsrfError);
  });

  it("blocks a 30x redirect to a private IP literal at the next hop", async () => {
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
          return victimCalls === 1
            ? [{ address: "127.0.0.1", family: 4 }]
            : [{ address: "192.168.1.10", family: 4 }];
        }
        return [{ address: "127.0.0.1", family: 4 }];
      };
      const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll });
      const err = await fetchImpl(`http://localhost:${rport}/start`).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(SsrfError);
      expect(victimCalls).toBeGreaterThanOrEqual(2);
      expect(causeChainText(err)).toContain("192.168.1.10");
    } finally {
      await new Promise<void>((r) => redirector.close(() => r()));
    }
  });

  it("follows a 30x redirect to another PUBLIC-resolving (loopback) host", async () => {
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

  it("rejects a hostname resolving to a private address (URL-level DNS check)", async () => {
    const resolveAll: ResolveAll = async () => [{ address: "10.1.2.3", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({ resolveAll });
    await expect(fetchImpl("https://innocent.example/x")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects a cloud-internal hostname (denylist)", async () => {
    const fetchImpl = createNodeGuardedFetch();
    await expect(fetchImpl("https://metadata.google.internal/")).rejects.toBeInstanceOf(SsrfError);
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
    const res = await runLookup(lookup, "example.com", {});
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
      expect(res.address).toBe("93.184.216.34");
    }
  });

  it("rejects a private record in BOTH the array and single paths", async () => {
    const priv: ResolveAll = async () => [{ address: "10.0.0.1", family: 4 }];
    const lookup = createValidatingLookup(priv, false, false);
    expect((await runLookup(lookup, "x", { all: true })).ok).toBe(false);
    expect((await runLookup(lookup, "x", {})).ok).toBe(false);
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
    expect(
      (await runLookup(createValidatingLookup(none, false, false), "x", { all: true })).ok,
    ).toBe(false);
  });

  it("surfaces a resolver error to the callback", async () => {
    const boom: ResolveAll = async () => {
      throw new Error("ENOTFOUND");
    };
    const res = await runLookup(createValidatingLookup(boom, false, false), "x", { all: true });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The BARE pinning dispatcher's own safe posture (used directly as
// `fetch(url, { dispatcher })`, without the full guard wired in). Two properties:
//   1. PROTOCOL-AWARE — an `http:` hop is validated against the loopback-ONLY rule, an
//      `https:` hop against the public-address rule. A bare-dispatcher `http:` request that
//      flips to a PUBLIC address at connect time is refused (no plaintext leak to a public
//      host), where the previous single-rule dispatcher would have accepted it.
//   2. (covered in the dedicated block below) `http:` is refused outright unless allowLoopback.
// These run undici's REAL connector against a local loopback server.
// ---------------------------------------------------------------------------
describe("createPinningDispatcher — protocol-aware connect (bare dispatcher)", () => {
  let server: Server;
  let port: number;
  beforeEach(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("REACHED");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("http: is validated loopback-ONLY — a public-flipping address is refused at connect (allowLoopback)", async () => {
    // Under allowLoopback an http: dev URL is permitted, but EVERY connect-time record must be
    // loopback. A resolver returning a PUBLIC address must be refused for http: — that is the
    // protocol-aware rule. The previous single (non-loopback-only) lookup served http: too, so
    // it would have ACCEPTED this public address: this test is the regression guard for that.
    const publicResolver: ResolveAll = async () => [{ address: "93.184.216.34", family: 4 }];
    const dispatcher = createPinningDispatcher({ allowLoopback: true, resolveAll: publicResolver });
    const err = await undiciFetch(`http://rebind.example:${port}/x`, {
      dispatcher: dispatcher as unknown as UndiciAgent,
      redirect: "manual",
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    await dispatcher.close().catch(() => {});
    expect(err).toBeInstanceOf(Error);
    expect(causeChainText(err)).toContain("requires loopback-only");
  });

  it("http: to a loopback address IS reachable under allowLoopback (safe case preserved)", async () => {
    const loopback: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const dispatcher = createPinningDispatcher({ allowLoopback: true, resolveAll: loopback });
    const res = await undiciFetch(`http://localhost:${port}/x`, {
      dispatcher: dispatcher as unknown as UndiciAgent,
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("REACHED");
    await dispatcher.close().catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// TLS: pinning the IP must NOT weaken certificate validation. The cert is verified against
// the ORIGINAL hostname (the connector's servername), never the pinned IP.
// ---------------------------------------------------------------------------
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
    dir = mkdtempSync(join(tmpdir(), "gf-tls-"));
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
      skip();
      return;
    }
    const resolveAll: ResolveAll = async () => [{ address: "127.0.0.1", family: 4 }];
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, resolveAll, ca: creds.cert });
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
    const fetchImpl = createNodeGuardedFetch({ allowLoopback: true, ca: creds.cert });
    await expect(fetchImpl(`https://127.0.0.1:${port}/registry`)).rejects.toBeInstanceOf(SsrfError);
  });
});

/**
 * The REPLACE-VS-HARDEN evidence (the maintainer's answer, as executable proof, not prose).
 *
 * The README's library-evaluation matrix rests on two load-bearing architectural facts. These
 * tests REPRODUCE them so the README's "verified, not asserted" claim is backed by the suite
 * (and so a future undici/Node change that invalidates the decision FAILS the gate, forcing a
 * re-evaluation rather than a silently-stale README):
 *
 *   (A) Every maintained Node SSRF filter (`request-filtering-agent`, `ssrf-req-filter`,
 *       `ssrf-agent`, `ssrf-agent-guard`) is a `node:http`/`node:https` `Agent` subclass. An
 *       `http.Agent` is NOT an undici `Dispatcher` — it has no `.dispatch` — so it cannot be
 *       `fetch(url, { dispatcher })` on the suite's native-`fetch`/undici HTTP path. We assert
 *       this against the BASE class (`node:http.Agent`) every such filter extends, so the proof
 *       holds for all of them with no extra dependency.
 *
 *   (B) The strong maintained lib (`request-filtering-agent`) and our `./node` entry use the
 *       IDENTICAL pinning technique: inject a validating `lookup` so the connector dials the
 *       pre-validated IP and never re-resolves. We prove OUR dispatcher (`createPinningDispatcher`)
 *       drives undici's `connect.lookup` exactly that way — the ~25-line technique on the only
 *       seam the suite's HTTP path exposes. (`request-filtering-agent` does the same on the
 *       `http.Agent.createConnection` seam; it just cannot be wired to undici.)
 */
describe("replace-vs-harden evidence — undici Dispatcher vs http.Agent (README matrix ④)", () => {
  it("a node:http.Agent (the base class of every maintained SSRF filter) has NO undici .dispatch", () => {
    const httpAgent = new HttpAgent();
    // The seam the maintained filters override (http.Agent path)…
    expect(typeof httpAgent.createConnection).toBe("function");
    // …is NOT the seam undici fetch needs (Dispatcher path).
    expect((httpAgent as unknown as { dispatch?: unknown }).dispatch).toBeUndefined();
  });

  it("undici fetch REJECTS an http.Agent passed as { dispatcher } (agent.dispatch is not a function)", async () => {
    // A REAL ephemeral loopback port that we then CLOSE — a valid-but-closed port. undici throws
    // at the dispatcher CONTRACT check (agent.dispatch is not a function) BEFORE any socket is
    // opened, so this test makes NO outbound request even if undici's behaviour changed — at
    // worst it would hit a closed loopback port, never the public internet. (A bogus literal
    // port like `:1` is rejected by undici as "bad port" before the dispatcher check, masking
    // the contract failure — hence a real, then-closed, ephemeral port.) We assert the failure
    // is the dispatcher-contract one so the test stays a precise contract proof.
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
    const closedPort = (probe.address() as AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));

    const httpAgent = new HttpAgent();
    const err = await undiciFetch(`http://127.0.0.1:${closedPort}/`, {
      dispatcher: httpAgent as unknown as UndiciAgent,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Error);
    const cause = (err as { cause?: { message?: string } }).cause;
    expect(cause?.message ?? (err as Error).message).toContain("dispatch");
  });

  it("OUR pinning dispatcher IS a real undici Dispatcher (has .dispatch) — the adoptable seam", () => {
    const dispatcher = createPinningDispatcher();
    expect(typeof (dispatcher as unknown as { dispatch?: unknown }).dispatch).toBe("function");
    expect(dispatcher).toBeInstanceOf(UndiciAgent);
    void dispatcher.close().catch(() => {});
  });
});

describe("replace-vs-harden evidence — our lookup pins like request-filtering-agent (README matrix ②)", () => {
  it("validates EVERY record (all:true) and refuses a rebinding set with one private record", async () => {
    // request-filtering-agent iterates all records and fails on the first private one; ours does too.
    const flip: ResolveAll = async () => [
      { address: "93.184.216.34", family: 4 }, // public
      { address: "169.254.169.254", family: 4 }, // cloud metadata — must fail the whole set
    ];
    const lookup = createValidatingLookup(flip, false, false);
    const result = await runLookup(lookup, "rebind.example", { all: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(SsrfError);
      expect(result.error.message).toContain("169.254.169.254");
    }
  });

  it("hands undici back ONLY the pre-validated addresses (the pin — no re-resolution path)", async () => {
    const resolveAll: ResolveAll = async () => [{ address: "93.184.216.34", family: 4 }];
    const lookup = createValidatingLookup(resolveAll, false, false);
    const result = await runLookup(lookup, "ok.example", { all: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The exact validated record(s) are returned for net.connect to dial — pinned.
      expect(result.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
    }
  });
});
