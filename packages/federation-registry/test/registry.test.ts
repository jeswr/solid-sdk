// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  buildMembership,
  buildRegistry,
  listMembers,
  parseRegistry,
  verifyMembership,
  verifyMembershipDataset,
} from "../src/registry.js";
import {
  APP_DRIVE,
  APP_MUSIC,
  AUTHORITY,
  BARE_MEMBERSHIPS,
  MEMBERSHIP_LITERAL_APP,
  MEMBERSHIP_NO_STATUS,
  MEMBERSHIP_TWO_APPS,
  MEMBERSHIP_TWO_STATUSES,
  NO_REGISTRY,
  REGISTRY_BAD_MEMBERSHIP,
  REGISTRY_EMPTY,
  REGISTRY_NO_ASSERTED_BY,
  REGISTRY_NS,
  REGISTRY_TWO_MEMBERS,
  TWO_REGISTRIES,
  turtleFetch,
} from "./fixtures.js";

const body = (b: string) => ({ body: b, bodyContentType: "text/turtle" as const });

describe("parseRegistry", () => {
  it("parses a registry with two members and verifies each", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(REGISTRY_TWO_MEMBERS));
    expect(parsed.valid).toBe(true);
    expect(parsed.registry?.id).toBe(REGISTRY_NS);
    expect(parsed.members).toHaveLength(2);

    const byApp = new Map(parsed.members.map((m) => [m.membership?.app, m]));
    expect(byApp.get(APP_MUSIC)?.membership?.status).toBe("Active");
    expect(byApp.get(APP_DRIVE)?.membership?.status).toBe("Suspended");
    expect(byApp.get(APP_MUSIC)?.membership?.assertedBy).toEqual([AUTHORITY]);
    expect(byApp.get(APP_MUSIC)?.membership?.asserted).toBe("2026-06-16T10:00:00Z");
    expect(parsed.members.every((m) => m.valid)).toBe(true);
  });

  it("flags a membership missing assertedBy (not a registry assertion)", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(REGISTRY_NO_ASSERTED_BY));
    expect(parsed.valid).toBe(false);
    const codes = parsed.members.flatMap((m) => m.issues.map((i) => i.code));
    expect(codes).toContain("membership-missing-asserted-by");
  });

  it("flags an unknown status IRI and a missing app", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(REGISTRY_BAD_MEMBERSHIP));
    expect(parsed.valid).toBe(false);
    const codes = parsed.members.flatMap((m) => m.issues.map((i) => i.code));
    expect(codes).toContain("unknown-status");
    expect(codes).toContain("membership-missing-app");
  });

  it("reports no-registry for a document with no fedreg:Registry", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(NO_REGISTRY));
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.map((i) => i.code)).toContain("no-registry");
    expect(parsed.members).toHaveLength(0);
  });

  it("reports no-membership for an empty registry", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(REGISTRY_EMPTY));
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.map((i) => i.code)).toContain("no-membership");
  });

  it("returns fetch-failed when fetch rejects with a status", async () => {
    const failing: typeof globalThis.fetch = async () =>
      new Response("nope", { status: 404, headers: { "content-type": "text/plain" } });
    const parsed = await parseRegistry("https://registry.example/missing", { fetch: failing });
    expect(parsed.valid).toBe(false);
    expect(parsed.issues[0]?.code).toBe("fetch-failed");
  });

  it("fetches over the supplied fetch and verifies (the network path)", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, { fetch: turtleFetch(REGISTRY_TWO_MEMBERS) });
    expect(parsed.valid).toBe(true);
    expect(parsed.members).toHaveLength(2);
  });

  it("flags multiple-registries when more than one fedreg:Registry is present", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(TWO_REGISTRIES));
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.map((i) => i.code)).toContain("multiple-registries");
  });

  it("flags a membership that names more than one app", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_TWO_APPS));
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain("membership-multiple-apps");
  });

  it("flags a membership with conflicting statuses regardless of iteration order", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_TWO_STATUSES));
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain("membership-multiple-statuses");
  });
});

describe("listMembers", () => {
  it("lists the members of a registry", async () => {
    const members = await listMembers(REGISTRY_NS, body(REGISTRY_TWO_MEMBERS));
    expect(members).toHaveLength(2);
  });

  it("falls back to bare fedreg:Membership records with no wrapping Registry", async () => {
    const members = await listMembers(REGISTRY_NS, body(BARE_MEMBERSHIPS));
    expect(members).toHaveLength(1);
    expect(members[0]?.membership?.app).toBe(APP_MUSIC);
    expect(members[0]?.valid).toBe(true);
  });

  it("fetches the resource exactly once, even on the bare-membership fallback", async () => {
    let calls = 0;
    const counting: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response(BARE_MEMBERSHIPS, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
    };
    const members = await listMembers(REGISTRY_NS, { fetch: counting });
    expect(members).toHaveLength(1);
    expect(calls).toBe(1);
  });
});

describe("verifyMembership", () => {
  it("verifies a single bare membership record", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(BARE_MEMBERSHIPS));
    expect(v.valid).toBe(true);
    expect(v.membership?.app).toBe(APP_MUSIC);
  });

  it("rejects a literal in the app position (term-type violation)", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_LITERAL_APP));
    expect(v.valid).toBe(false);
    const codes = v.issues.map((i) => i.code);
    expect(codes).toContain("invalid-term-type");
    // The literal app is rejected, so the app is also "missing".
    expect(codes).toContain("membership-missing-app");
  });

  it("reports no-membership when none present", async () => {
    const v = await verifyMembership(REGISTRY_NS, body(NO_REGISTRY));
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("no-membership");
  });

  it("flags a membership with no status", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_NO_STATUS));
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain("membership-missing-status");
    // A missing status leaves the view without a status / statusIri.
    expect(v.membership?.status).toBeUndefined();
  });

  it("reports parse-failed on malformed Turtle", async () => {
    const v = await verifyMembership(REGISTRY_NS, body("this is not turtle @@@ {"));
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("parse-failed");
  });
});

describe("buildRegistry", () => {
  it("builds a registry that round-trips through parseRegistry", async () => {
    const built = buildRegistry({
      id: REGISTRY_NS,
      members: [
        {
          id: `${REGISTRY_NS}#m-music`,
          app: APP_MUSIC,
          status: "Active",
          assertedBy: AUTHORITY,
          asserted: "2026-06-16T10:00:00Z",
        },
        {
          app: APP_DRIVE, // blank-node membership (no id)
          status: "Revoked",
          assertedBy: [AUTHORITY],
        },
      ],
    });
    const turtle = await built.toString();
    expect(turtle).toContain("fedreg:Registry");

    const parsed = await parseRegistry(REGISTRY_NS, body(turtle));
    expect(parsed.valid).toBe(true);
    expect(parsed.members).toHaveLength(2);
    const statuses = parsed.members.map((m) => m.membership?.status).sort();
    expect(statuses).toEqual(["Active", "Revoked"]);
  });

  it("defaults status to Active and asserted to an ISO timestamp", async () => {
    const built = buildRegistry({
      id: REGISTRY_NS,
      members: [{ app: APP_MUSIC, assertedBy: AUTHORITY }],
    });
    const parsed = await parseRegistry(REGISTRY_NS, body(await built.toString()));
    expect(parsed.members[0]?.membership?.status).toBe("Active");
    expect(parsed.members[0]?.membership?.asserted).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("throws without a registry id", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => buildRegistry({ members: [] })).toThrow(TypeError);
  });
});

describe("buildMembership", () => {
  it("builds a standalone membership record", async () => {
    const built = buildMembership({
      id: `${REGISTRY_NS}#m1`,
      app: APP_MUSIC,
      status: "Active",
      assertedBy: AUTHORITY,
    });
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(await built.toString()));
    expect(v.valid).toBe(true);
    expect(v.membership?.app).toBe(APP_MUSIC);
  });

  it("throws without a membership id (a standalone record must be dereferenceable)", () => {
    expect(() =>
      // @ts-expect-error — exercising the runtime guard (id is required here)
      buildMembership({ app: APP_MUSIC, assertedBy: AUTHORITY }),
    ).toThrow(TypeError);
  });
});

describe("verifyMembershipDataset", () => {
  it("verifies a parsed dataset directly", async () => {
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const ds = await parseRdf(BARE_MEMBERSHIPS, "text/turtle", { baseIRI: REGISTRY_NS });
    const v = verifyMembershipDataset(ds);
    expect(v.valid).toBe(true);
    expect(v.membership?.app).toBe(APP_MUSIC);
  });

  it("reports no-membership on an empty dataset", async () => {
    const { parseRdf } = await import("@jeswr/fetch-rdf");
    const ds = await parseRdf(NO_REGISTRY, "text/turtle", { baseIRI: REGISTRY_NS });
    const v = verifyMembershipDataset(ds);
    expect(v.valid).toBe(false);
    expect(v.issues[0]?.code).toBe("no-membership");
  });
});
