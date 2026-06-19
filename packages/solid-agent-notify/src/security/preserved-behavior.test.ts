// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Regression tests pinning the agent-notify POSTURE that the @jeswr/guarded-fetch
 * rewire must preserve — the behaviours that are STRICTER than guarded-fetch's
 * defaults, or that are agent-notify-specific, and so are most at risk of silently
 * regressing when the SSRF mechanism is delegated to the shared library:
 *
 *  1. The STRICTER hostname denylist: agent-notify refuses `localhost` /
 *     `*.localhost` / `*.local` UNCONDITIONALLY (even under allowLoopback) — these
 *     are NOT in guarded-fetch's smaller DEFAULT_HOSTNAME_DENYLIST. They stay blocked
 *     ONLY because we thread FETCH_HOSTNAME_DENYLIST through `hostnameDenylist`. A
 *     regression here would re-open a loopback-name SSRF path under allowLoopback.
 *  2. POST refuses to follow ANY 3xx (confused-deputy fail-closed) — including a
 *     same-host redirect — so an authenticated POST + body is never bounced.
 *  3. DNS-rebinding is refused at the connect-time pin: a resolver returning a
 *     private record (multi-record set) fails the request.
 *
 * The exhaustive IP-classification + redirect + body/timeout coverage lives in
 * guardedFetch.test.ts and the differential oracle in ssrf-differential.test.ts;
 * THIS file pins the posture deltas a reviewer most needs reassurance on.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GuardedFetchError, SsrfError, guardedFetch } from "./guardedFetch.js";
import { assertNotSsrf, isDeniedHostname } from "./ssrf.js";

let server: http.Server;
let base: string;
const routes = new Map<
  string,
  (req: http.IncomingMessage, res: http.ServerResponse) => void
>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const fn = routes.get(req.url ?? "");
    if (fn) {
      fn(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
});

function stubDns(...addrs: { address: string; family: number }[]) {
  return vi.fn(async () => addrs);
}

describe("preserved posture — STRICTER hostname denylist (localhost / .local)", () => {
  it("isDeniedHostname blocks localhost / *.localhost / *.local (agent-notify stricter list)", () => {
    for (const h of [
      "localhost",
      "foo.localhost",
      "service.local",
      "printer.local",
    ]) {
      expect(isDeniedHostname(h)).toBe(true);
    }
  });

  it("assertNotSsrf refuses `localhost` even under allowLoopback (unconditional denylist)", async () => {
    // Under allowLoopback a loopback IP literal is permitted, but the NAME `localhost` must still be
    // refused by the stricter denylist BEFORE DNS — this is the posture delta vs guarded-fetch's
    // default (which would permit `localhost` under allowLoopback).
    await expect(
      assertNotSsrf("http://localhost/", {
        allowLoopback: true,
        enforceHttpsExceptLoopback: true,
        dnsLookup: stubDns({ address: "127.0.0.1", family: 4 }),
      })
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("assertNotSsrf refuses a `.local` name even under allowLoopback", async () => {
    await expect(
      assertNotSsrf("https://nas.local/", {
        allowLoopback: true,
        dnsLookup: stubDns({ address: "8.8.8.8", family: 4 }),
      })
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("guardedFetch refuses `localhost` under allowLoopback (denylist short-circuit, no socket)", async () => {
    // The denylist fires BEFORE DNS, so no socket opens and the stub is never consulted.
    const dns = stubDns({ address: "127.0.0.1", family: 4 });
    await expect(
      guardedFetch("http://localhost/card", {
        allowLoopback: true,
        dnsLookup: dns,
      })
    ).rejects.toBeInstanceOf(SsrfError);
    expect(dns).not.toHaveBeenCalled();
  });

  it("guardedFetch still reaches a 127.0.0.1 IP-literal fixture under allowLoopback (the IT path)", async () => {
    // agent-notify's loopback IT fixtures use the 127.0.0.1 LITERAL (not the name `localhost`), so
    // the stricter denylist does not break them — proven end-to-end here.
    routes.set("/card", (_req, res) => {
      res.writeHead(200, { "content-type": "text/turtle" });
      res.end("<#me> <http://x/p> <http://x/o> .");
    });
    const r = await guardedFetch(`${base}/card`, { allowLoopback: true });
    expect(r.status).toBe(200);
    expect(r.contentType).toBe("text/turtle");
  });
});

describe("preserved posture — POST refuses ALL redirects (confused-deputy)", () => {
  it("refuses to follow a POST 307 redirect even to the SAME host (fails closed → GuardedFetchError)", async () => {
    routes.set("/post-307", (_req, res) => {
      res.writeHead(307, { location: `${base}/post-dst` });
      res.end();
    });
    let dstHit = false;
    routes.set("/post-dst", (_req, res) => {
      dstHit = true;
      res.writeHead(201);
      res.end();
    });
    await expect(
      guardedFetch(`${base}/post-307`, {
        allowLoopback: true,
        method: "POST",
        body: "<#it> a <https://www.w3.org/ns/activitystreams#Announce> .",
        headers: { "content-type": "text/turtle" },
        skipContentTypeAllowlist: true,
      })
    ).rejects.toBeInstanceOf(GuardedFetchError);
    // The body must NEVER have been bounced to the redirect target.
    expect(dstHit).toBe(false);
  });

  it("refuses a POST redirect to a private host (token-leak bounce blocked)", async () => {
    routes.set("/post-priv", (_req, res) => {
      res.writeHead(302, { location: "https://169.254.169.254/" });
      res.end();
    });
    await expect(
      guardedFetch(`${base}/post-priv`, {
        allowLoopback: true,
        method: "POST",
        body: "x",
        skipContentTypeAllowlist: true,
      })
    ).rejects.toBeInstanceOf(GuardedFetchError);
  });
});

describe("preserved posture — DNS-rebinding refused at validation (every record must be public)", () => {
  it("guardedFetch refuses a host whose resolver returns a public+private set (multi-record)", async () => {
    await expect(
      guardedFetch("https://rebind.example/", {
        dnsLookup: stubDns(
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 }
        ),
      })
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("assertNotSsrf refuses the same rebinding set (the pin would never be a private IP)", async () => {
    await expect(
      assertNotSsrf("https://rebind.example/", {
        allowLoopback: false,
        dnsLookup: stubDns(
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.1", family: 4 }
        ),
      })
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it("TOCTOU: a resolver that FLIPS public->private between the URL check and the connect-time pin is refused at connect", async () => {
    // The canonical DNS-rebinding attack: the URL-validation lookup returns a PUBLIC address (so the
    // guard's URL check passes), then the resolver FLIPS to a PRIVATE address by the time the socket
    // connects. The single-record URL check alone cannot catch this — only the connect-time pinning
    // lookup (createNodeGuardedFetch's resolveAll, validated per record) does. guardedFetch wires the
    // injected dnsLookup into BOTH the URL check AND the connect-time resolveAll, so this STATEFUL
    // stub proves the connect-time pin re-validates and refuses the flip. A regression that stopped
    // wiring the resolver into resolveAll would let the second (private) answer through → this fails.
    let call = 0;
    const flipping = vi.fn(async () => {
      call += 1;
      // First call (URL classification): public → passes. Subsequent calls (connect-time pin): private.
      return call === 1
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "169.254.169.254", family: 4 }];
    });
    await expect(
      guardedFetch("https://flip.example/", { dnsLookup: flipping })
    ).rejects.toBeInstanceOf(SsrfError);
    // The connect-time lookup MUST have been consulted (>= 2 calls) — proving the pin path ran, not
    // just the URL check. If only the URL check ran (1 call) the flip would have connected.
    expect(flipping.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
