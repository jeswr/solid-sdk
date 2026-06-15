// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { describe, expect, it } from "vitest";
import { verify } from "../src/index.js";
import {
  INVALID_BAD_ACCESS_MODE,
  INVALID_EMPTY,
  INVALID_INCOMPLETE_SECTOR_USE,
  INVALID_MULTIPLE_APPS,
  INVALID_NO_ACCESS,
  INVALID_NO_APP,
  VALID_FLAT,
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
