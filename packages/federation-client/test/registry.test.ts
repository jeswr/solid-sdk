// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Tests for consuming a federation-registry from the client: discoverFromRegistry
// (registry-asserted memberships) and resolveStorageSpecVersion (storage spec-version
// advertisement). All fetches are stubbed — no live network. A public-IP dnsLookup is
// injected so the SSRF guard (exercised separately in ssrf.test.ts) does not gate the
// happy-path fixtures.

import { describe, expect, it } from "vitest";
import { discoverFromRegistry, resolveStorageSpecVersion } from "../src/index.js";
import type { DnsLookup } from "../src/ssrf.js";
import {
  APP_DRIVE,
  APP_MUSIC,
  MALFORMED_TURTLE,
  NO_REGISTRY,
  REGISTRY_BAD_MEMBERSHIP,
  REGISTRY_EMPTY,
  REGISTRY_TWO_MEMBERS,
  REGISTRY_URL,
  SECTOR_SCHED,
  SPEC_SCHED_100,
  SPEC_SCHED_110,
  SPEC_SCHED_200,
  STORAGE_DUAL_READ,
  STORAGE_INVALID_WITH_SPEC,
  STORAGE_NO_SPEC,
  STORAGE_URL,
} from "./registry-fixtures.js";

/** A dnsLookup that resolves every host to a public address (so the guard passes). */
const PUBLIC_DNS: DnsLookup = async () => [{ address: "93.184.216.34", family: 4 }];

/** Build a stub `fetch` returning the given Turtle body with HTTP 200. */
function stubFetch(body: string, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(status === 200 ? body : "err", {
      status,
      headers: { "content-type": "text/turtle" },
    })) as typeof globalThis.fetch;
}

describe("discoverFromRegistry — registry-asserted memberships", () => {
  it("lists every membership with its registry-asserted status + trust flag", async () => {
    const { members, valid } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch(REGISTRY_TWO_MEMBERS),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(members).toHaveLength(2);
    // Both memberships are WELL-FORMED (Suspended is a valid status, just not a
    // trusted/live one) — so the document as a whole verifies clean.
    expect(valid).toBe(true);

    const music = members.find((m) => m.id === APP_MUSIC);
    expect(music?.valid).toBe(true);
    expect(music?.status).toBe("Active");
    expect(music?.trusted).toBe(true);
    expect(music?.source).toBe(REGISTRY_URL);
    expect(music?.membership.assertedBy).toContain("https://registry.example/profile/card#me");

    const drive = members.find((m) => m.id === APP_DRIVE);
    expect(drive?.valid).toBe(true);
    // Suspended is a well-formed status but NOT a live/trusted membership.
    expect(drive?.status).toBe("Suspended");
    expect(drive?.trusted).toBe(false);
  });

  it("lets a caller filter to currently-trusted (Active) members", async () => {
    const { members } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch(REGISTRY_TWO_MEMBERS),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    const trusted = members.filter((m) => m.trusted).map((m) => m.id);
    expect(trusted).toEqual([APP_MUSIC]);
  });

  it("verifies each membership independently — flags an invalid one", async () => {
    const { members } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch(REGISTRY_BAD_MEMBERSHIP),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(members).toHaveLength(1);
    const m = members[0];
    expect(m?.valid).toBe(false);
    // The registry SDK flags the unknown status + the missing assertedBy authority.
    const codes = (m?.issues ?? []).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(["unknown-status", "membership-missing-asserted-by"]),
    );
    // An unknown status leaves the membership untrusted.
    expect(m?.trusted).toBe(false);
  });

  it("returns no members for a registry with none (but stays a found registry)", async () => {
    const { members, issues } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch(REGISTRY_EMPTY),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(members).toEqual([]);
    // The registry exists but lists nothing — a no-membership document-level issue.
    expect(issues.map((i) => i.code)).toContain("no-membership");
  });

  it("surfaces a document with no fedreg:Registry node as a document-level issue", async () => {
    const { members, valid, issues } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch(NO_REGISTRY),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(members).toEqual([]);
    expect(valid).toBe(false);
    // Not a silently-empty list: the caller can see WHY there are no members.
    expect(issues.map((i) => i.code)).toContain("no-registry");
  });

  it("surfaces a fetch failure as a document-level issue (not a silent empty list)", async () => {
    const { members, valid, issues } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch("", 404),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(members).toEqual([]);
    expect(valid).toBe(false);
    const codes = issues.map((i) => i.code);
    expect(codes.some((c) => c === "fetch-failed" || c === "parse-failed")).toBe(true);
  });

  it("surfaces malformed registry RDF as a document-level parse failure", async () => {
    const { members, valid, issues } = await discoverFromRegistry(REGISTRY_URL, {
      fetch: stubFetch(MALFORMED_TURTLE),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(members).toEqual([]);
    expect(valid).toBe(false);
    expect(issues.map((i) => i.code)).toContain("parse-failed");
  });

  it("an SSRF-refused registry URL never fetches and is reported, not thrown", async () => {
    // A loopback registry URL: the guard refuses BEFORE the underlying fetch runs.
    const calls: string[] = [];
    const recordingFetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      return new Response(REGISTRY_TWO_MEMBERS, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }) as typeof globalThis.fetch;
    const { members, valid, issues } = await discoverFromRegistry("https://127.0.0.1/federation", {
      fetch: recordingFetch,
      guard: { dnsLookup: PUBLIC_DNS },
    });
    // The guard's SsrfError is mapped by the registry to a document-level fetch/parse
    // issue (it does not throw out of discoverFromRegistry).
    expect(members).toEqual([]);
    expect(valid).toBe(false);
    const codes = issues.map((i) => i.code);
    expect(codes.some((c) => c === "fetch-failed" || c === "parse-failed")).toBe(true);
    // Crucially, the underlying fetch was NEVER called for the refused host.
    expect(calls).toEqual([]);
  });
});

describe("resolveStorageSpecVersion — storage spec-version advertisement", () => {
  it("resolves the advertised spec-versions + supported sectors", async () => {
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch(STORAGE_DUAL_READ),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(res.valid).toBe(true);
    expect(res.id).toBe(STORAGE_URL);
    expect(res.storage).toBe(STORAGE_URL); // defaults to id when no explicit fedreg:storage
    expect([...res.acceptsSpec].sort()).toEqual([SPEC_SCHED_100, SPEC_SCHED_110]);
    expect(res.supportsSector).toEqual([SECTOR_SCHED]);
  });

  it("accepts an exactly-advertised version and rejects others (exact-IRI semantics)", async () => {
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch(STORAGE_DUAL_READ),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    // Dual-read window: both old + new accepted.
    expect(res.accepts(SPEC_SCHED_100)).toBe(true);
    expect(res.accepts(SPEC_SCHED_110)).toBe(true);
    // A not-yet-advertised version is NOT accepted (no loose/prefix match).
    expect(res.accepts(SPEC_SCHED_200)).toBe(false);
    // A prefix of an advertised IRI must not match.
    expect(res.accepts("https://w3id.org/jeswr/sectors/scheduling#1")).toBe(false);
  });

  it("computes the unsupported gap an app must close before writing", async () => {
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch(STORAGE_DUAL_READ),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    const gap = res.unsupported([SPEC_SCHED_110, SPEC_SCHED_200]);
    expect(gap).toEqual([SPEC_SCHED_200]);
    expect(res.unsupported([SPEC_SCHED_100, SPEC_SCHED_110])).toEqual([]);
  });

  it("fails closed for a storage missing acceptsSpec — accepts NOTHING", async () => {
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch(STORAGE_NO_SPEC),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(res.valid).toBe(false);
    expect(res.acceptsSpec).toEqual([]);
    // Fail-closed: an unverifiable storage accepts no version.
    expect(res.accepts(SPEC_SCHED_100)).toBe(false);
    expect(res.unsupported([SPEC_SCHED_100])).toEqual([SPEC_SCHED_100]);
  });

  it("fails closed for a fetch failure — accepts NOTHING", async () => {
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch("", 500),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(res.valid).toBe(false);
    expect(res.acceptsSpec).toEqual([]);
    expect(res.accepts(SPEC_SCHED_100)).toBe(false);
  });

  it("fails closed for an INVALID description even when it lists a matching spec", async () => {
    // The doc has a well-formed acceptsSpec <…#1.0.0> but is invalid (literal sector).
    // Gating on result.valid means we must NOT advertise that version (round-2 Medium).
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch(STORAGE_INVALID_WITH_SPEC),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(res.valid).toBe(false);
    // Even though the raw doc listed acceptsSpec #1.0.0, an unverifiable storage
    // advertises NOTHING.
    expect(res.acceptsSpec).toEqual([]);
    expect(res.accepts(SPEC_SCHED_100)).toBe(false);
    expect(res.unsupported([SPEC_SCHED_100])).toEqual([SPEC_SCHED_100]);
  });

  it("fails closed for malformed storage RDF — accepts NOTHING", async () => {
    const res = await resolveStorageSpecVersion(STORAGE_URL, {
      fetch: stubFetch(MALFORMED_TURTLE),
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(res.valid).toBe(false);
    expect(res.accepts(SPEC_SCHED_100)).toBe(false);
    const codes = res.issues.map((i) => i.code);
    expect(codes).toContain("parse-failed");
  });

  it("fails closed for an SSRF-refused storage URL — never fetches, accepts NOTHING", async () => {
    const calls: string[] = [];
    const recordingFetch = (async (url: string | URL | Request) => {
      calls.push(typeof url === "string" ? url : url.toString());
      return new Response(STORAGE_DUAL_READ, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    }) as typeof globalThis.fetch;
    const res = await resolveStorageSpecVersion("https://169.254.169.254/storage", {
      fetch: recordingFetch,
      guard: { dnsLookup: PUBLIC_DNS },
    });
    expect(res.valid).toBe(false);
    expect(res.accepts(SPEC_SCHED_100)).toBe(false);
    expect(calls).toEqual([]); // metadata IP was refused before any fetch
  });
});
