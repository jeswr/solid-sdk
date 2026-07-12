// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CHARACTERIZATION (golden-master) test for the IP-literal classification core —
// `classifyIpLiteral` / `isPublicAddress` / `isLoopbackAddress`. These three pure
// functions are the SSRF security primitive: every allow/deny decision in the guard
// (and in the Node pinning path) ultimately rests on their verdict. This test pins
// their OBSERVABLE OUTPUT over a large, DETERMINISTIC boundary corpus so that a
// structure-only refactor (extracting them to their own module, lowering their
// cognitive complexity) can be PROVEN to change shape, not behaviour: if a single
// verdict flips, this test goes red.
//
// Unlike the existing random fuzz-vs-`node:net#isIP` test (non-deterministic, an
// oracle check), this is a STABLE snapshot keyed on hand-enumerated boundary inputs —
// each chosen to exercise one classification range / edge (RFC 1918, CGNAT, link-local,
// metadata, multicast, reserved, the IPv6 ULA / link-local / 6to4 / NAT64 / IPv4-mapped
// embedded-v4 cases, compression, embedded-v4, zone ids, malformed forms). The expected
// column is the verdict on the PRE-refactor code; do NOT `--update` it to make a red
// test green (that would launder a behaviour change).

import { isIP } from "node:net";
import { describe, expect, it } from "vitest";
import { classifyIpLiteral, isLoopbackAddress, isPublicAddress } from "../src/ssrf.js";

// --- classifyIpLiteral: kind (0 = not-a-literal, 4 = IPv4, 6 = IPv6) -----------
// Each entry is [input, expectedKind]. Pinned on the pre-refactor behaviour.
const CLASSIFY_CASES: ReadonlyArray<readonly [string, 0 | 4 | 6]> = [
  // canonical IPv4
  ["0.0.0.0", 4],
  ["1.2.3.4", 4],
  ["255.255.255.255", 4],
  ["127.0.0.1", 4],
  ["169.254.169.254", 4],
  // malformed IPv4 (leading zeros / out-of-range / wrong arity / hex / spaces)
  ["01.2.3.4", 0],
  ["1.2.3.256", 0],
  ["1.2.3", 0],
  ["1.2.3.4.5", 0],
  ["1.2.3.04", 0],
  ["0x7f.0.0.1", 0],
  [" 1.2.3.4", 0],
  ["1.2.3.4 ", 0],
  ["1.2.3.4\n", 0],
  // canonical IPv6
  ["::1", 6],
  ["::", 6],
  ["fe80::1", 6],
  ["fc00::1", 6],
  ["2001:db8::1", 6],
  ["2001:0db8:0000:0000:0000:0000:0000:0001", 6],
  ["::ffff:1.2.3.4", 6],
  ["::ffff:10.0.0.1", 6],
  ["0:0:0:0:0:ffff:0a00:0001", 6],
  ["2002:c000:0204::", 6],
  ["64:ff9b::1.2.3.4", 6],
  ["fe80::1%eth0", 6],
  // malformed IPv6 (double ::, over-length, empty zone, bracketed, junk)
  ["::ffff::1", 0],
  ["1:2:3:4:5:6:7:8:9", 0],
  ["fe80::1%", 0],
  ["fe80::1%eth0%more", 0],
  ["[::1]", 0],
  ["gggg::1", 0],
  ["", 0],
  ["example.com", 0],
  ["localhost", 0],
  ["1.2.3.4:80", 0],
];

// --- isPublicAddress(addr, allowLoopback) --------------------------------------
// [input, public@allowLoopback=false, public@allowLoopback=true].
const PUBLIC_CASES: ReadonlyArray<readonly [string, boolean, boolean]> = [
  // public IPv4
  ["93.184.216.34", true, true],
  ["1.1.1.1", true, true],
  ["8.8.8.8", true, true],
  // 0.0.0.0/8
  ["0.0.0.0", false, false],
  ["0.1.2.3", false, false],
  // loopback 127/8 (re-permitted only under allowLoopback)
  ["127.0.0.1", false, true],
  ["127.255.255.255", false, true],
  // RFC 1918
  ["10.0.0.1", false, false],
  ["10.255.255.255", false, false],
  ["172.16.0.1", false, false],
  ["172.31.255.255", false, false],
  ["172.15.0.1", true, true], // just below the 172.16 block — public
  ["172.32.0.1", true, true], // just above — public
  ["192.168.0.1", false, false],
  ["192.169.0.1", true, true], // just above 192.168 — public
  // link-local + metadata
  ["169.254.0.1", false, false],
  ["169.254.169.254", false, false],
  // CGNAT 100.64.0.0/10
  ["100.64.0.1", false, false],
  ["100.127.255.255", false, false],
  ["100.63.255.255", true, true], // just below — public
  ["100.128.0.1", true, true], // just above — public
  // multicast / reserved
  ["224.0.0.1", false, false],
  ["239.255.255.255", false, false],
  ["240.0.0.1", false, false],
  ["255.255.255.255", false, false],
  // TEST-NET + benchmarking
  ["192.0.2.1", false, false],
  ["198.18.0.1", false, false],
  ["198.19.255.255", false, false],
  ["198.51.100.1", false, false],
  ["203.0.113.1", false, false],
  // IPv6 loopback / unspecified
  ["::1", false, true],
  ["0:0:0:0:0:0:0:1", false, true],
  ["::", false, false],
  ["0:0:0:0:0:0:0:0", false, false],
  // IPv6 link-local / ULA / multicast
  ["fe80::1", false, false],
  ["febf::1", false, false],
  ["fc00::1", false, false],
  ["fd00::1", false, false],
  ["ff00::1", false, false],
  ["ff02::1", false, false],
  // IPv6 globally-routable public
  ["2606:4700:4700::1111", true, true],
  // NOTE: `2001:db8::/32` is the RFC 3849 IPv6 DOCUMENTATION prefix. The classifier
  // (kept in lock-step with the @pss/guarded-fetch source) does NOT block it, unlike
  // the blocked IPv4 TEST-NET ranges above — so it currently classifies as public.
  // This pins the CURRENT verdict; it is a candidate gap to raise UPSTREAM in
  // @pss/guarded-fetch (and mirror here), NOT a behaviour to change in this
  // behaviour-preserving pass. See the report follow-up.
  ["2001:db8::1", true, true],
  // IPv4-mapped IPv6 — classify per embedded v4 (compressed AND expanded forms)
  ["::ffff:93.184.216.34", true, true],
  ["::ffff:10.0.0.1", false, false],
  ["::ffff:127.0.0.1", false, true],
  ["0:0:0:0:0:ffff:0a00:0001", false, false], // = 10.0.0.1 expanded
  // 6to4 (2002::/16) with embedded private v4
  ["2002:0a00:0001::", false, false], // embeds 10.0.0.1
  ["2002:5db8:d822::", true, true], // embeds a public v4 (93.184...)
  // NAT64 well-known prefix 64:ff9b::/96
  ["64:ff9b::a00:1", false, false], // embeds 10.0.0.1
  ["64:ff9b::5db8:d822", true, true], // embeds public
  // non-IP strings
  ["not-an-ip", false, false],
  ["example.com", false, false],
  ["", false, false],
];

// --- isLoopbackAddress ---------------------------------------------------------
const LOOPBACK_CASES: ReadonlyArray<readonly [string, boolean]> = [
  ["127.0.0.1", true],
  ["127.255.255.255", true],
  ["126.0.0.1", false],
  ["128.0.0.1", false],
  ["::1", true],
  ["0:0:0:0:0:0:0:1", true],
  ["::ffff:127.0.0.1", true],
  ["::ffff:127.255.255.255", true],
  ["::ffff:10.0.0.1", false],
  ["::ffff:93.184.216.34", false],
  ["fe80::1", false],
  ["10.0.0.1", false],
  ["not-an-ip", false],
  ["", false],
];

describe("IP classification — characterization (golden master)", () => {
  it("classifyIpLiteral pins the kind for every boundary input", () => {
    for (const [input, expected] of CLASSIFY_CASES) {
      expect([input, classifyIpLiteral(input)]).toEqual([input, expected]);
    }
  });

  it("classifyIpLiteral agrees with node:net#isIP on the boundary corpus", () => {
    // Belt-and-braces: the same corpus must also match the Node oracle, so the
    // expected column above cannot silently drift from real isIP semantics.
    for (const [input] of CLASSIFY_CASES) {
      expect([input, classifyIpLiteral(input)]).toEqual([input, isIP(input)]);
    }
  });

  it("isPublicAddress pins the verdict for every boundary input (both allowLoopback)", () => {
    for (const [input, pubStrict, pubLoopback] of PUBLIC_CASES) {
      expect([input, "strict", isPublicAddress(input, false)]).toEqual([
        input,
        "strict",
        pubStrict,
      ]);
      expect([input, "loopback", isPublicAddress(input, true)]).toEqual([
        input,
        "loopback",
        pubLoopback,
      ]);
    }
  });

  it("isLoopbackAddress pins the verdict for every boundary input", () => {
    for (const [input, expected] of LOOPBACK_CASES) {
      expect([input, isLoopbackAddress(input)]).toEqual([input, expected]);
    }
  });
});
