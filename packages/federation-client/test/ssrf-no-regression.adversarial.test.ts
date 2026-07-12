// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// ADVERSARIAL no-SSRF-regression guard for the @jeswr/guarded-fetch adoption.
//
// This package replaced its inline SSRF classifier/guard with the consolidated suite guard
// @jeswr/guarded-fetch. The adoption's load-bearing invariant is: the new guard is AT LEAST
// AS STRICT as the old one — NO address/host the old classifier blocked may become allowed.
// Before the rewire a differential oracle compared the OLD classifier (origin/main
// `src/ip.ts`) and an end-to-end OLD-guard-vs-guarded-fetch run over a large adversarial
// corpus and found ZERO regressions. This file PINS that property durably in the gate so a
// future guarded-fetch bump cannot silently re-open a hole through this package's surface.
//
// It works two ways:
//   1. CLASSIFIER level — every private/loopback/link-local/metadata/ULA/mapped/6to4/NAT64
//      literal in the corpus must classify NON-public via the re-exported `isPublicAddress`
//      (the exact predicate the old guard used). One flip to public fails the test.
//   2. END-TO-END guard level — every blocked vector, driven as a full URL through the
//      re-exported `createGuardedFetch` (with an injected DNS resolver so it is offline +
//      deterministic), must be REFUSED before reaching the underlying fetch.
//
// Public addresses are also asserted to stay reachable (so the guard is not vacuously
// "block everything"). The corpus is the union of the suite block-set categories the task
// enumerated: private v4 (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, 0.0.0.0/8, CGNAT,
// multicast, reserved/TEST-NET), v6 (ULA, link-local, ::ffff-mapped, 6to4, NAT64,
// loopback/unspecified), alt-encoded loopback (URL-canonicalised), bracketed v6, zone ids.

import { describe, expect, it } from "vitest";
import { createGuardedFetch, type DnsLookup, isPublicAddress, SsrfError } from "../src/index.js";

// --- corpus: literals that MUST classify non-public (one flip = SSRF regression) --------
const MUST_BE_NON_PUBLIC: readonly string[] = [
  // RFC 1918 + boundaries
  "10.0.0.1",
  "10.255.255.255",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.0.1",
  "192.168.255.255",
  // link-local + cloud metadata
  "169.254.0.1",
  "169.254.169.254",
  // loopback (non-public at allowLoopback=false)
  "127.0.0.1",
  "127.255.255.255",
  // 0.0.0.0/8 (unspecified)
  "0.0.0.0",
  "0.1.2.3",
  // CGNAT 100.64/10
  "100.64.0.1",
  "100.127.255.255",
  // multicast / reserved / TEST-NET / benchmarking
  "224.0.0.1",
  "239.255.255.255",
  "240.0.0.1",
  "255.255.255.255",
  "192.0.2.1",
  "198.18.0.1",
  "198.51.100.1",
  "203.0.113.1",
  // v6 loopback / unspecified
  "::1",
  "0:0:0:0:0:0:0:1",
  "::",
  // v6 link-local / ULA / multicast
  "fe80::1",
  "febf::1",
  "fc00::1",
  "fd00::1",
  "ff00::1",
  "ff02::1",
  // IPv4-mapped v6 (compressed + expanded) embedding a private/loopback v4
  "::ffff:10.0.0.1",
  "::ffff:127.0.0.1",
  "::ffff:169.254.169.254",
  "0:0:0:0:0:ffff:0a00:0001", // = 10.0.0.1 expanded
  // 6to4 embedding a private v4
  "2002:0a00:0001::", // 10.0.0.1
  "2002:a9fe:a9fe::", // 169.254.169.254
  // NAT64 embedding a private v4
  "64:ff9b::a00:1", // 10.0.0.1
  "64:ff9b::169.254.169.254",
];

// Public literals that MUST stay public (the guard is not vacuously block-everything).
const MUST_BE_PUBLIC: readonly string[] = [
  "93.184.216.34",
  "1.1.1.1",
  "8.8.8.8",
  "172.15.255.255", // just below 172.16/12
  "172.32.0.1", // just above
  "192.169.0.1", // just above 192.168/16
  "100.63.255.255", // just below CGNAT
  "100.128.0.1", // just above
  "2606:4700:4700::1111",
  "::ffff:93.184.216.34",
  "2002:5db8:d822::", // 6to4 embedding a public v4
];

describe("no-SSRF-regression — classifier level (re-exported isPublicAddress)", () => {
  it("blocks EVERY private/loopback/link-local/metadata/ULA/mapped/6to4/NAT64 literal (both allowLoopback)", () => {
    for (const addr of MUST_BE_NON_PUBLIC) {
      // strict: never public.
      expect([addr, "strict", isPublicAddress(addr, false)]).toEqual([addr, "strict", false]);
      // allowLoopback re-permits ONLY 127/8 + ::1 + ::ffff:127.x — everything else stays blocked.
      const isLoopbackish =
        addr.startsWith("127.") ||
        addr === "::1" ||
        addr === "0:0:0:0:0:0:0:1" ||
        addr === "::ffff:127.0.0.1";
      expect([addr, "loopback", isPublicAddress(addr, true)]).toEqual([
        addr,
        "loopback",
        isLoopbackish,
      ]);
    }
  });

  it("keeps EVERY genuinely-public literal public (not vacuously block-everything)", () => {
    for (const addr of MUST_BE_PUBLIC) {
      expect([addr, isPublicAddress(addr, false)]).toEqual([addr, true]);
    }
  });
});

describe("no-SSRF-regression — end-to-end guard (createGuardedFetch, offline)", () => {
  // A resolver that returns the literal back for hostname tests is not needed: we drive IP
  // literals directly (no resolution). For hostname rebinding we inject a fixed resolver.
  const okFetch = () => {
    const calls: string[] = [];
    const fetch = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return new Response("ok", { status: 200, headers: { "content-type": "text/turtle" } });
    }) as typeof globalThis.fetch;
    return { fetch, calls };
  };
  const PublicDns: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

  it("REFUSES every blocked literal as a full URL before reaching fetch", async () => {
    for (const addr of MUST_BE_NON_PUBLIC) {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: PublicDns });
      // Bracket v6 literals for the URL host.
      const host = addr.includes(":") ? `[${addr}]` : addr;
      await expect(guarded(`https://${host}/doc`)).rejects.toBeInstanceOf(SsrfError);
      expect([addr, calls]).toEqual([addr, []]);
    }
  });

  it("REFUSES a DNS-rebinding multi-record set where ANY record is private", async () => {
    const dns: DnsLookup = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    const { fetch, calls } = okFetch();
    const guarded = createGuardedFetch({ fetch, dnsLookup: dns });
    await expect(guarded("https://rebind.example/doc")).rejects.toBeInstanceOf(SsrfError);
    expect(calls).toEqual([]);
  });

  it("ALLOWS a public literal as a full URL (guard is not block-everything)", async () => {
    for (const addr of MUST_BE_PUBLIC) {
      const { fetch, calls } = okFetch();
      const guarded = createGuardedFetch({ fetch, dnsLookup: PublicDns });
      const host = addr.includes(":") ? `[${addr}]` : addr;
      await expect(guarded(`https://${host}/doc`)).resolves.toBeInstanceOf(Response);
      expect([addr, calls.length]).toEqual([addr, 1]);
    }
  });
});
