// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import { verify, verifyDataset } from "../src/index.js";
import {
  INVALID_BAD_ACCESS_MODE,
  INVALID_BNODE_SECTOR,
  INVALID_EMPTY,
  INVALID_INCOMPLETE_SECTOR_USE,
  INVALID_LITERAL_ACCESS,
  INVALID_MULTIPLE_APPS,
  INVALID_NO_ACCESS,
  INVALID_NO_APP,
  VALID_FLAT,
  VALID_FLAT_OTHER_SUBJECT,
  VALID_NESTED,
} from "./fixtures.js";

const BASE = "https://app.example/clientid";

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe("verify — valid registrations", () => {
  it("accepts a well-formed flat-form registration", async () => {
    const r = await verify(BASE, { body: VALID_FLAT });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.registration?.id).toBe(BASE);
    expect(r.registration?.sectors).toContain("https://w3id.org/jeswr/sectors/identity");
    expect([...(r.registration?.access ?? [])].sort()).toEqual(["Read", "Write"]);
    expect(r.registration?.declaresShape).toContain("https://app.example/shapes/Profile#shape");
  });

  it("accepts a well-formed nested SectorUse registration", async () => {
    const r = await verify(BASE, { body: VALID_NESTED });
    expect(r.valid).toBe(true);
    expect(r.registration?.sectorUse).toHaveLength(2);
    const sectors = (r.registration?.sectorUse ?? []).map((su) => su.sector).sort();
    expect(sectors).toEqual([
      "https://w3id.org/jeswr/sectors/finance",
      "https://w3id.org/jeswr/sectors/health",
    ]);
    const health = (r.registration?.sectorUse ?? []).find((su) => su.sector.endsWith("/health"));
    expect(health?.access).toEqual(["Read"]);
    expect(health?.consumes).toContain("https://w3id.org/jeswr/sectors/health#Observation");
  });
});

describe("verify — invalid registrations", () => {
  it("rejects a document with no fedapp:App", async () => {
    const r = await verify(BASE, { body: INVALID_NO_APP });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("no-app");
    expect(r.registration).toBeUndefined();
  });

  it("rejects an unknown access mode", async () => {
    const r = await verify(BASE, { body: INVALID_BAD_ACCESS_MODE });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("invalid-access-mode");
    const issue = r.issues.find((i) => i.code === "invalid-access-mode");
    expect(issue?.value).toBe("https://example.com/bogus#Superuser");
    // The valid mode still parses through.
    expect(r.registration?.access).toContain("Read");
  });

  it("rejects a SectorUse missing sector and access", async () => {
    const r = await verify(BASE, { body: INVALID_INCOMPLETE_SECTOR_USE });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toEqual(
      expect.arrayContaining(["sector-use-missing-sector", "sector-use-missing-access"]),
    );
  });

  it("rejects an empty registration", async () => {
    const r = await verify(BASE, { body: INVALID_EMPTY });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("empty-registration");
  });

  it("flags a registration that requests no access modes", async () => {
    const r = await verify(BASE, { body: INVALID_NO_ACCESS });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("missing-access");
  });

  it("flags multiple fedapp:App subjects", async () => {
    const r = await verify(BASE, { body: INVALID_MULTIPLE_APPS });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("multiple-apps");
  });
});

describe("verify — term-type validation (IRI-valued properties)", () => {
  it("rejects fedapp:access given as a string literal (not a NamedNode)", async () => {
    const r = await verify(BASE, { body: INVALID_LITERAL_ACCESS });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("invalid-term-type");
    const issue = r.issues.find((i) => i.code === "invalid-term-type");
    // The literal's lexical value is the valid acl:Read IRI, yet it is rejected
    // on TERM TYPE — it must NOT pass as a valid access mode.
    expect(issue?.value).toBe("http://www.w3.org/ns/auth/acl#Read");
    expect(r.registration?.access ?? []).toHaveLength(0);
  });

  it("rejects fedapp:sector given as a blank node (not a NamedNode)", async () => {
    const r = await verify(BASE, { body: INVALID_BNODE_SECTOR });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("invalid-term-type");
    expect(r.registration?.sectors ?? []).toHaveLength(0);
  });
});

describe("verify — subject binding (anti-spoofing)", () => {
  function stubFetch(body: string): typeof globalThis.fetch {
    return (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      })) as typeof globalThis.fetch;
  }

  it("rejects a FETCHED document whose App subject ≠ the fetch URL (default)", async () => {
    const r = await verify("https://app.example/clientid", {
      fetch: stubFetch(VALID_FLAT_OTHER_SUBJECT),
    });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("subject-mismatch");
    const issue = r.issues.find((i) => i.code === "subject-mismatch");
    expect(issue?.subject).toBe("https://attacker.example/otherapp");
    expect(issue?.value).toBe("https://app.example/clientid");
  });

  it("allows a FETCHED subject mismatch when requireSubjectMatch is explicitly false", async () => {
    const r = await verify("https://app.example/clientid", {
      fetch: stubFetch(VALID_FLAT_OTHER_SUBJECT),
      requireSubjectMatch: false,
    });
    expect(codes(r.issues)).not.toContain("subject-mismatch");
    expect(r.valid).toBe(true);
    expect(r.registration?.id).toBe("https://attacker.example/otherapp");
  });

  it("accepts a FETCHED document whose App subject equals the fetch URL", async () => {
    const r = await verify("https://app.example/clientid", { fetch: stubFetch(VALID_FLAT) });
    expect(r.valid).toBe(true);
    expect(codes(r.issues)).not.toContain("subject-mismatch");
  });

  it("does NOT bind the subject for a body in hand by default (offline path)", async () => {
    // A body supplied directly carries no authoritative location, so a subject
    // that differs from the base IRI is allowed (no subject-mismatch).
    const r = await verify("https://app.example/clientid", { body: VALID_FLAT_OTHER_SUBJECT });
    expect(codes(r.issues)).not.toContain("subject-mismatch");
    expect(r.valid).toBe(true);
  });

  it("verifyDataset leaves subject-binding off by default (registry/multi-app path)", async () => {
    const dataset = await parseRdf(VALID_FLAT_OTHER_SUBJECT, "text/turtle", {
      baseIRI: "https://app.example/clientid",
    });
    const r = verifyDataset(dataset, "https://app.example/clientid");
    expect(codes(r.issues)).not.toContain("subject-mismatch");
    expect(r.valid).toBe(true);
  });

  it("verifyDataset rejects a subject mismatch when requireSubjectMatch is set", async () => {
    const dataset = await parseRdf(VALID_FLAT_OTHER_SUBJECT, "text/turtle", {
      baseIRI: "https://app.example/clientid",
    });
    const r = verifyDataset(dataset, "https://app.example/clientid", { requireSubjectMatch: true });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("subject-mismatch");
  });
});

describe("verify — over a (stubbed) network fetch", () => {
  function stubFetch(body: string, status = 200): typeof globalThis.fetch {
    return (async () =>
      new Response(status === 200 ? body : "err", {
        status,
        headers: { "content-type": "text/turtle" },
      })) as typeof globalThis.fetch;
  }

  it("fetches + verifies a registration over fetch", async () => {
    const r = await verify("https://app.example/clientid", {
      fetch: stubFetch(VALID_FLAT),
    });
    expect(r.valid).toBe(true);
    expect(r.registration?.id).toBe(BASE);
  });

  it("reports fetch-failed for a non-2xx response", async () => {
    const r = await verify("https://app.example/missing", {
      fetch: stubFetch("", 404),
    });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("fetch-failed");
  });
});

describe("verify — parse / fetch failures", () => {
  it("reports a parse failure for malformed Turtle", async () => {
    const r = await verify(BASE, { body: "@prefix : <broken" });
    expect(r.valid).toBe(false);
    expect(codes(r.issues)).toContain("parse-failed");
  });

  it("reports a fetch failure when the network fetch rejects", async () => {
    const failingFetch: typeof globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const r = await verify("https://unreachable.example/doc", { fetch: failingFetch });
    expect(r.valid).toBe(false);
    // A thrown non-RdfFetchError surfaces as parse-failed (no HTTP status).
    expect(codes(r.issues).some((c) => c === "parse-failed" || c === "fetch-failed")).toBe(true);
  });
});
