// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * CHARACTERIZATION TESTS — the public-address classifier + the browser-safe IP-literal
 * recogniser. This file is the AUDIT ARTIFACT for the IP primitive: it ports EVERY classifier
 * assertion from all four consolidated copies (prod-solid-server `@pss/guarded-fetch`
 * `addresses.test.ts`, federation-client `ssrf.test.ts`, solid-community-feeds
 * `safeFetch.test.ts`, solid-agent-notify `security/guardedFetch.test.ts`) plus the union of
 * IPv4 / IPv6 / embedded-v4 / alternate-encoding / fuzz vectors. The consolidated classifier
 * must be a strict SUPERSET — it blocks everything any copy blocked.
 *
 * `classifyIpLiteral` (the browser-safe `node:net#isIP` replacement) is fuzzed against the real
 * `node:net#isIP` over a large corpus to keep them in lock-step — a divergence would weaken or
 * over-tighten the SSRF classification, so it is treated as security-critical.
 */
import { isIP } from "node:net";
import { describe, expect, it } from "vitest";
import { classifyIpLiteral, isLoopbackAddress, isPublicAddress } from "../src/index.js";

describe("isPublicAddress — IPv4 ranges (union of all copies)", () => {
  const blocked: [string, string][] = [
    ["0.0.0.0", "0.0.0.0/8 unspecified"],
    ["0.1.2.3", "0/8"],
    ["127.0.0.1", "loopback 127/8"],
    ["127.255.255.255", "loopback 127/8 upper"],
    ["10.0.0.1", "RFC1918 10/8"],
    ["10.255.255.255", "RFC1918 10/8 upper"],
    ["172.16.0.1", "RFC1918 172.16/12 lower"],
    ["172.31.255.255", "RFC1918 172.16/12 upper"],
    ["192.168.0.1", "RFC1918 192.168/16"],
    ["192.168.1.1", "RFC1918 192.168/16"],
    ["169.254.0.1", "link-local 169.254/16"],
    ["169.254.169.254", "cloud metadata 169.254.169.254"],
    ["100.64.0.1", "CGNAT 100.64/10 lower"],
    ["100.127.255.255", "CGNAT 100.64/10 upper"],
    ["224.0.0.1", "multicast 224/4"],
    ["239.255.255.255", "multicast 224/4 upper"],
    ["240.0.0.1", "reserved 240/4"],
    ["255.255.255.255", "broadcast"],
    ["192.0.2.1", "TEST-NET-1"],
    ["198.18.0.1", "benchmarking 198.18/15"],
    ["198.51.100.1", "TEST-NET-2"],
    ["203.0.113.1", "TEST-NET-3"],
  ];
  for (const [ip, label] of blocked) {
    it(`blocks ${ip} (${label})`, () => {
      expect(isPublicAddress(ip, false)).toBe(false);
    });
  }

  it("allows public v4 (incl. just-outside the 172.16/12 boundary)", () => {
    expect(isPublicAddress("8.8.8.8", false)).toBe(true);
    expect(isPublicAddress("1.1.1.1", false)).toBe(true);
    expect(isPublicAddress("93.184.216.34", false)).toBe(true);
    expect(isPublicAddress("172.15.0.1", false)).toBe(true);
    expect(isPublicAddress("172.32.0.1", false)).toBe(true);
  });

  it("re-permits loopback ONLY under allowLoopback; RFC1918/link-local/CGNAT/metadata stay blocked", () => {
    expect(isPublicAddress("127.0.0.1", false)).toBe(false);
    expect(isPublicAddress("127.0.0.1", true)).toBe(true);
    for (const ip of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "169.254.0.1",
      "100.64.0.1",
      "224.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isPublicAddress(ip, true)).toBe(false);
    }
  });

  it("rejects malformed / out-of-range octets and non-IP strings", () => {
    expect(isPublicAddress("999.1.1.1", false)).toBe(false);
    expect(isPublicAddress("not an ip", false)).toBe(false);
    expect(isPublicAddress("not-an-ip", false)).toBe(false);
    expect(isPublicAddress("", false)).toBe(false);
  });
});

describe("isPublicAddress — IPv6 ranges (union of all copies)", () => {
  it("accepts public IPv6 (incl. the documentation prefix, treated public for parity)", () => {
    expect(isPublicAddress("2001:db8::1", false)).toBe(true);
    expect(isPublicAddress("2606:4700::1", false)).toBe(true);
    expect(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946", false)).toBe(true);
  });

  const blocked: [string, string][] = [
    ["::1", "loopback ::1"],
    ["0:0:0:0:0:0:0:1", "loopback expanded"],
    ["::", "unspecified ::"],
    ["0:0:0:0:0:0:0:0", "unspecified expanded"],
    ["fc00::1", "ULA fc00::/7 lower"],
    ["fd00::1", "ULA fd00"],
    ["fd12:3456::1", "ULA fd12"],
    ["fdff::1", "ULA fc00::/7 upper (fd00)"],
    ["fe80::1", "link-local fe80::/10"],
    ["febf::1", "link-local fe80::/10 upper"],
    ["ff02::1", "multicast ff00::/8"],
  ];
  for (const [ip, label] of blocked) {
    it(`blocks ${ip} (${label})`, () => {
      expect(isPublicAddress(ip, false)).toBe(false);
    });
  }

  it("re-permits loopback ::1 ONLY under allowLoopback; ULA stays blocked", () => {
    expect(isPublicAddress("::1", false)).toBe(false);
    expect(isPublicAddress("::1", true)).toBe(true);
    expect(isPublicAddress("fc00::1", true)).toBe(false);
  });

  describe("IPv4-mapped IPv6 (every textual form)", () => {
    it("rejects mapped → private/loopback/metadata v4 (compressed)", () => {
      expect(isPublicAddress("::ffff:10.0.0.1", false)).toBe(false);
      expect(isPublicAddress("::ffff:127.0.0.1", false)).toBe(false);
      expect(isPublicAddress("::ffff:169.254.169.254", true)).toBe(false);
    });
    it("accepts mapped → public v4 (compressed)", () => {
      expect(isPublicAddress("::ffff:8.8.8.8", false)).toBe(true);
    });
    it("rejects HEX-form mapped → private/loopback/metadata v4", () => {
      expect(isPublicAddress("::ffff:0a00:0001", false)).toBe(false); // 10.0.0.1
      expect(isPublicAddress("::ffff:0a00:1", false)).toBe(false); // 10.0.0.1 compressed hextet
      expect(isPublicAddress("::ffff:7f00:0001", false)).toBe(false); // 127.0.0.1
      expect(isPublicAddress("::FFFF:0A00:0001", false)).toBe(false); // upper-case
      expect(isPublicAddress("::ffff:a9fe:a9fe", false)).toBe(false); // 169.254.169.254
    });
    it("accepts HEX-form mapped → public v4", () => {
      expect(isPublicAddress("::ffff:0808:0808", false)).toBe(true); // 8.8.8.8
    });
    it("rejects EXPANDED-form mapped → private/loopback/metadata v4 (roborev 1090-B)", () => {
      expect(isPublicAddress("0:0:0:0:0:ffff:0a00:0001", false)).toBe(false); // 10.0.0.1 hex tail
      expect(isPublicAddress("0:0:0:0:0:ffff:10.0.0.1", false)).toBe(false); // 10.0.0.1 dotted tail
      expect(isPublicAddress("0:0:0:0:0:ffff:7f00:0001", false)).toBe(false); // 127.0.0.1
      expect(isPublicAddress("0:0:0:0:0:ffff:a9fe:a9fe", false)).toBe(false); // 169.254.169.254
    });
    it("accepts EXPANDED-form mapped → public v4", () => {
      expect(isPublicAddress("0:0:0:0:0:ffff:8.8.8.8", false)).toBe(true);
      expect(isPublicAddress("0:0:0:0:0:ffff:0808:0808", false)).toBe(true);
    });
  });

  describe("6to4 (2002::/16) embedded-v4 re-check", () => {
    it("rejects 6to4 embedding a private/loopback v4", () => {
      expect(isPublicAddress("2002:0a00:0001::", false)).toBe(false); // 10.0.0.1
      expect(isPublicAddress("2002:7f00:0001::", false)).toBe(false); // 127.0.0.1
      expect(isPublicAddress("2002:c0a8:0001::", false)).toBe(false); // 192.168.0.1
      expect(isPublicAddress("2002:c0a8:0101::", false)).toBe(false); // 192.168.1.1
    });
    it("accepts 6to4 embedding a public v4", () => {
      expect(isPublicAddress("2002:0808:0808::", false)).toBe(true); // 8.8.8.8
    });
  });

  describe("NAT64 (64:ff9b::/96) embedded-v4 re-check", () => {
    it("rejects NAT64 embedding a private/metadata v4", () => {
      expect(isPublicAddress("64:ff9b::a00:1", false)).toBe(false); // 10.0.0.1 hex
      expect(isPublicAddress("64:ff9b::7f00:1", false)).toBe(false); // 127.0.0.1 hex
      expect(isPublicAddress("64:ff9b::10.0.0.1", false)).toBe(false); // 10.0.0.1 dotted
      expect(isPublicAddress("64:ff9b::a9fe:a9fe", false)).toBe(false); // 169.254.169.254
    });
    it("accepts NAT64 embedding a public v4", () => {
      expect(isPublicAddress("64:ff9b::8.8.8.8", false)).toBe(true);
    });
    it("a non-well-known 64:: address that is not the NAT64 prefix is treated normally", () => {
      expect(isPublicAddress("64:1::1", false)).toBe(true);
    });
  });
});

describe("isLoopbackAddress", () => {
  it("recognises loopback v4/v6 incl. mapped (every octet of 127/8)", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.5.5.5")).toBe(true);
    expect(isLoopbackAddress("127.9.9.9")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
  });
  it("non-loopback is false", () => {
    expect(isLoopbackAddress("8.8.8.8")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackAddress("2001:db8::1")).toBe(false);
    expect(isLoopbackAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isLoopbackAddress("not-an-ip")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyIpLiteral — the browser-safe `node:net#isIP` replacement. It must match isIP
// EXACTLY (a divergence weakens/over-tightens classification). Fuzzed against the real isIP.
// ---------------------------------------------------------------------------
describe("classifyIpLiteral — matches node:net#isIP (browser-safe replacement)", () => {
  const fixedCases = [
    "93.184.216.34",
    "10.0.0.1",
    "127.0.0.1",
    "0.0.0.0",
    "255.255.255.255",
    "256.1.1.1",
    "1.2.3",
    "1.2.3.4.5",
    "01.02.03.04",
    "1.2.3.04",
    "1.2.3.4 ",
    " 1.2.3.4",
    "1.2.3.4.",
    ".1.2.3.4",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "2606:2800:220:1:248:1893:25c8:1946",
    "2002:c0a8:0101::",
    "64:ff9b::0a00:0001",
    "0:0:0:0:0:ffff:0a00:0001",
    "::ffff:7f00:0001",
    "1::2::3",
    "1:2:3:4:5:6:7:8",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "12345::1",
    "g::1",
    "::ffff:256.1.1.1",
    "::1.2.3.4",
    "1.2.3.4::",
    "[::1]",
    "localhost",
    "0x7f.0.0.1",
    "2130706433",
    "not-an-ip",
    "",
    "abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    "ABCD::EF",
    "1:2:3:4:5:6:1.2.3.4",
    "::1.2.3.4.5",
    "fe80::1%eth0",
    "fe80::1%25eth0",
    "::1%lo",
    "fe80::1%",
    "%eth0",
    "::ffff:10.0.0.1%x",
    "fe80%::1",
    "10.0.0.1%eth0",
    "::%",
    "fe80::1%eth0%more",
  ];

  it("matches isIP on a fixed adversarial corpus", () => {
    for (const c of fixedCases) {
      expect([c, classifyIpLiteral(c)]).toEqual([c, isIP(c)]);
    }
  });

  it("matches isIP on randomly fuzzed IPv4 / IPv6 / junk strings", () => {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const samples: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const parts = Array.from({ length: 1 + rnd(5) }, () => String(rnd(400)));
      samples.push(parts.join("."));
      samples.push(parts.map((p) => (rnd(2) ? p : `0${p}`)).join("."));
    }
    const hex = "0123456789abcdefABCDEF";
    for (let i = 0; i < 400; i += 1) {
      const groups = Array.from({ length: 1 + rnd(9) }, () =>
        Array.from({ length: 1 + rnd(5) }, () => hex[rnd(hex.length)]).join(""),
      );
      let s = groups.join(":");
      if (rnd(2)) {
        const idx = rnd(groups.length);
        s = `${groups.slice(0, idx).join(":")}::${groups.slice(idx).join(":")}`;
      }
      if (rnd(3) === 0) {
        s = `${s}:${rnd(300)}.${rnd(300)}.${rnd(300)}.${rnd(300)}`;
      }
      samples.push(s);
      if (rnd(4) === 0) {
        samples.push(`${s}%${rnd(2) ? `z${rnd(50)}` : ""}`);
      }
    }
    for (const s of samples) {
      expect([s, classifyIpLiteral(s)]).toEqual([s, isIP(s)]);
    }
  });
});
