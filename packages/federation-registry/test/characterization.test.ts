// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Characterization (golden-master) tests pinning the OBSERVABLE behaviour of the
// public API BEFORE any refactor — so a later structural change is proven to have
// moved code, not behaviour. Two axes are pinned exhaustively:
//
//   1. EMITTED RDF — every build path's quads are canonicalised to SORTED N-Quads
//      and snapshotted. This proves serialisation equivalence across a refactor
//      (the constraint: a serialisation change must prove canonical-quad round-trip
//      equivalence) WITHOUT depending on n3.Writer's pretty-printing layout.
//   2. VERIFY ISSUES — the exact { code, message, subject, value } objects, in
//      document order, for every invalid fixture. The verify layer's issue codes
//      and messages are an observable contract (a consumer branches on `code`); the
//      ordering of issues within a record is also pinned so a flatten/early-return
//      refactor cannot silently reorder them.
//
// Determinism: every build fixture passes an EXPLICIT `asserted` timestamp (the
// non-deterministic default-`now` path is pinned separately in registry.test.ts),
// and blank-node ids (membership records minted without an explicit IRI) are
// relabelled to stable, identity-PRESERVING `_:b0`/`_:b1`/… tokens by
// canonicalQuads (distinct blank nodes stay distinct — see its doc comment).

import type { Quad } from "@rdfjs/types";
import { describe, expect, it } from "vitest";
import {
  buildMembership,
  buildRegistry,
  parseRegistry,
  verifyMembership,
} from "../src/registry.js";
import { describeStorage, parseStorage } from "../src/storage.js";
import {
  APP_DRIVE,
  APP_MUSIC,
  AUTHORITY,
  MEMBERSHIP_LITERAL_APP,
  MEMBERSHIP_NO_STATUS,
  MEMBERSHIP_TWO_APPS,
  MEMBERSHIP_TWO_STATUSES,
  REGISTRY_BAD_MEMBERSHIP,
  REGISTRY_NO_ASSERTED_BY,
  REGISTRY_NS,
  SECTOR_SCHED,
  SPEC_SCHED_100,
  SPEC_SCHED_110,
  STORAGE,
  STORAGE_NO_SPEC,
} from "./fixtures.js";

const body = (b: string) => ({ body: b, bodyContentType: "text/turtle" as const });

/**
 * Canonicalise a quad array to a SORTED N-Quads-style line set with DETERMINISTIC,
 * IDENTITY-PRESERVING blank-node relabelling. n3 mints blank-node labels
 * non-deterministically, so a stable golden master must relabel them — but it must
 * NOT collapse distinct blank nodes to a single token (that would mask a regression
 * that mints extra blank nodes or misattaches triples to the wrong one). So:
 *
 *   1. produce a label-blind sort key for each quad (every blank node masked to the
 *      same placeholder) and sort by it — a stable order independent of the minted
 *      labels;
 *   2. walk that stable order and assign each DISTINCT original blank-node id the
 *      next index (`_:b0`, `_:b1`, …) on first appearance;
 *   3. emit the lines using those stable per-node labels.
 *
 * Two graphs are equal iff their canonical line sets match — blank-node COUNT and
 * the triples attached to each are preserved. Every build fixture passes an EXPLICIT
 * `asserted` timestamp (the default-`now` path is pinned in registry.test.ts).
 */
function canonicalQuads(quads: readonly Quad[]): string[] {
  // A quad's graph term is included (as an N-Quads 4th position) so a regression
  // that moves a triple into a named graph cannot canonicalize identically to the
  // default-graph original. DefaultGraph (value "") emits no 4th term.
  type AnyTerm = Quad["subject"] | Quad["object"] | Quad["graph"];
  const blindTerm = (t: AnyTerm): string => {
    if (t.termType === "DefaultGraph") return "";
    if (t.termType === "BlankNode") return "_:?";
    if (t.termType === "Literal") return `"${t.value}"^^<${t.datatype.value}>`;
    return `<${t.value}>`;
  };
  const blindLine = (q: Quad): string => {
    const g = blindTerm(q.graph);
    return `${blindTerm(q.subject)} <${q.predicate.value}> ${blindTerm(q.object)}${g ? ` ${g}` : ""} .`;
  };

  // Step 1+2: stable order (label-blind), then assign each distinct blank node an
  // index by first appearance in that order (across subject, object AND graph).
  const ordered = [...quads].sort((a, b) => blindLine(a).localeCompare(blindLine(b)));
  const labels = new Map<string, string>();
  const labelOf = (t: AnyTerm): void => {
    if (t.termType === "BlankNode" && !labels.has(t.value)) {
      labels.set(t.value, `_:b${labels.size}`);
    }
  };
  for (const q of ordered) {
    labelOf(q.subject);
    labelOf(q.object);
    labelOf(q.graph);
  }

  // Step 3: emit with the stable labels, then sort the final lines.
  const termStr = (t: AnyTerm): string => {
    if (t.termType === "DefaultGraph") return "";
    if (t.termType === "BlankNode") return labels.get(t.value) ?? "_:?";
    if (t.termType === "Literal") return `"${t.value}"^^<${t.datatype.value}>`;
    return `<${t.value}>`;
  };
  return quads
    .map((q) => {
      const g = termStr(q.graph);
      return `${termStr(q.subject)} <${q.predicate.value}> ${termStr(q.object)}${g ? ` ${g}` : ""} .`;
    })
    .sort();
}

describe("characterization — emitted RDF (canonical sorted quads)", () => {
  it("buildRegistry with explicit + blank-node members", () => {
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
          app: APP_DRIVE,
          status: "Revoked",
          assertedBy: [AUTHORITY],
          asserted: "2026-06-16T11:00:00Z",
        },
      ],
    });
    expect(canonicalQuads(built.quads)).toMatchInlineSnapshot(`
      [
        "<https://registry.example/federation#m-music> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fedreg#Membership> .",
        "<https://registry.example/federation#m-music> <https://w3id.org/jeswr/fedreg#app> <https://music.example/clientid.jsonld> .",
        "<https://registry.example/federation#m-music> <https://w3id.org/jeswr/fedreg#asserted> "2026-06-16T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .",
        "<https://registry.example/federation#m-music> <https://w3id.org/jeswr/fedreg#assertedBy> <https://registry.example/profile/card#me> .",
        "<https://registry.example/federation#m-music> <https://w3id.org/jeswr/fedreg#status> <https://w3id.org/jeswr/fedreg#Active> .",
        "<https://registry.example/federation> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fedreg#Registry> .",
        "<https://registry.example/federation> <https://w3id.org/jeswr/fedreg#member> <https://registry.example/federation#m-music> .",
        "<https://registry.example/federation> <https://w3id.org/jeswr/fedreg#member> _:b0 .",
        "_:b0 <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fedreg#Membership> .",
        "_:b0 <https://w3id.org/jeswr/fedreg#app> <https://drive.example/clientid.jsonld> .",
        "_:b0 <https://w3id.org/jeswr/fedreg#asserted> "2026-06-16T11:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .",
        "_:b0 <https://w3id.org/jeswr/fedreg#assertedBy> <https://registry.example/profile/card#me> .",
        "_:b0 <https://w3id.org/jeswr/fedreg#status> <https://w3id.org/jeswr/fedreg#Revoked> .",
      ]
    `);
  });

  it("buildMembership standalone record", () => {
    const built = buildMembership({
      id: `${REGISTRY_NS}#m1`,
      app: APP_MUSIC,
      status: "Suspended",
      assertedBy: [AUTHORITY],
      asserted: "2026-06-16T10:00:00Z",
    });
    expect(canonicalQuads(built.quads)).toMatchInlineSnapshot(`
      [
        "<https://registry.example/federation#m1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fedreg#Membership> .",
        "<https://registry.example/federation#m1> <https://w3id.org/jeswr/fedreg#app> <https://music.example/clientid.jsonld> .",
        "<https://registry.example/federation#m1> <https://w3id.org/jeswr/fedreg#asserted> "2026-06-16T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .",
        "<https://registry.example/federation#m1> <https://w3id.org/jeswr/fedreg#assertedBy> <https://registry.example/profile/card#me> .",
        "<https://registry.example/federation#m1> <https://w3id.org/jeswr/fedreg#status> <https://w3id.org/jeswr/fedreg#Suspended> .",
      ]
    `);
  });

  it("describeStorage with an explicit fedreg:storage link", () => {
    const built = describeStorage({
      id: "https://registry.example/catalog#alice",
      storage: STORAGE,
      acceptsSpec: [SPEC_SCHED_100, SPEC_SCHED_110],
      supportsSector: [SECTOR_SCHED],
    });
    expect(canonicalQuads(built.quads)).toMatchInlineSnapshot(`
      [
        "<https://registry.example/catalog#alice> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fedreg#StorageDescription> .",
        "<https://registry.example/catalog#alice> <https://w3id.org/jeswr/fedreg#acceptsSpec> <https://w3id.org/jeswr/sectors/scheduling#1.0.0> .",
        "<https://registry.example/catalog#alice> <https://w3id.org/jeswr/fedreg#acceptsSpec> <https://w3id.org/jeswr/sectors/scheduling#1.1.0> .",
        "<https://registry.example/catalog#alice> <https://w3id.org/jeswr/fedreg#storage> <https://alice.pod.example/> .",
        "<https://registry.example/catalog#alice> <https://w3id.org/jeswr/fedreg#supportsSector> <https://w3id.org/jeswr/sectors/scheduling#sector> .",
      ]
    `);
  });

  it("describeStorage WITHOUT an explicit storage emits no fedreg:storage triple", () => {
    const built = describeStorage({ id: STORAGE, acceptsSpec: [SPEC_SCHED_100] });
    expect(canonicalQuads(built.quads)).toMatchInlineSnapshot(`
      [
        "<https://alice.pod.example/> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://w3id.org/jeswr/fedreg#StorageDescription> .",
        "<https://alice.pod.example/> <https://w3id.org/jeswr/fedreg#acceptsSpec> <https://w3id.org/jeswr/sectors/scheduling#1.0.0> .",
      ]
    `);
  });
});

describe("characterization — verify issues (exact code/message/order)", () => {
  it("REGISTRY_NO_ASSERTED_BY", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(REGISTRY_NO_ASSERTED_BY));
    expect(parsed.members.flatMap((m) => m.issues)).toMatchInlineSnapshot(`
      [
        {
          "code": "membership-missing-asserted-by",
          "message": "fedreg:Membership has no fedreg:assertedBy — a registry assertion MUST name the authority that vouches for it (else it is indistinguishable from a self-asserted claim).",
          "subject": "https://registry.example/federation#m1",
        },
      ]
    `);
  });

  it("REGISTRY_BAD_MEMBERSHIP (unknown status + missing app)", async () => {
    const parsed = await parseRegistry(REGISTRY_NS, body(REGISTRY_BAD_MEMBERSHIP));
    expect(parsed.members.flatMap((m) => m.issues)).toMatchInlineSnapshot(`
      [
        {
          "code": "membership-missing-app",
          "message": "fedreg:Membership names no fedreg:app (the app's client_id).",
          "subject": "https://registry.example/federation#m1",
        },
        {
          "code": "unknown-status",
          "message": "fedreg:status is not a known fedreg:MembershipStatus value: https://w3id.org/jeswr/fedreg#Bogus",
          "subject": "https://registry.example/federation#m1",
          "value": "https://w3id.org/jeswr/fedreg#Bogus",
        },
      ]
    `);
  });

  it("MEMBERSHIP_LITERAL_APP (term-type + missing-app order)", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_LITERAL_APP));
    expect(v.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "invalid-term-type",
          "message": "Expected an IRI (NamedNode) for <https://w3id.org/jeswr/fedreg#app> but found a Literal ("https://music.example/clientid.jsonld").",
          "subject": "https://registry.example/federation#m1",
          "value": "https://music.example/clientid.jsonld",
        },
        {
          "code": "membership-missing-app",
          "message": "fedreg:Membership names no fedreg:app (the app's client_id).",
          "subject": "https://registry.example/federation#m1",
        },
      ]
    `);
  });

  it("MEMBERSHIP_TWO_APPS", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_TWO_APPS));
    expect(v.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "membership-multiple-apps",
          "message": "fedreg:Membership names 2 apps via fedreg:app; expected exactly one.",
          "subject": "https://registry.example/federation#m1",
        },
      ]
    `);
  });

  it("MEMBERSHIP_TWO_STATUSES", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_TWO_STATUSES));
    expect(v.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "membership-multiple-statuses",
          "message": "fedreg:Membership has 2 fedreg:status values; expected exactly one. (https://w3id.org/jeswr/fedreg#Active, https://w3id.org/jeswr/fedreg#Revoked)",
          "subject": "https://registry.example/federation#m1",
        },
      ]
    `);
  });

  it("MEMBERSHIP_NO_STATUS", async () => {
    const v = await verifyMembership(`${REGISTRY_NS}#m1`, body(MEMBERSHIP_NO_STATUS));
    expect(v.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "membership-missing-status",
          "message": "fedreg:Membership has no fedreg:status.",
          "subject": "https://registry.example/federation#m1",
        },
      ]
    `);
  });

  it("STORAGE_NO_SPEC", async () => {
    const v = await parseStorage(STORAGE, body(STORAGE_NO_SPEC));
    expect(v.issues).toMatchInlineSnapshot(`
      [
        {
          "code": "storage-missing-accepts-spec",
          "message": "fedreg:StorageDescription advertises no fedreg:acceptsSpec — it carries no spec-version information for migration coordination.",
          "subject": "https://alice.pod.example/",
        },
      ]
    `);
  });
});

describe("characterization — build → parse round-trip view equivalence", () => {
  it("a built registry parses back to the same membership views", async () => {
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
      ],
    });
    const parsed = await parseRegistry(REGISTRY_NS, body(await built.toString()));
    expect(parsed.valid).toBe(true);
    expect(parsed.registry?.members).toMatchInlineSnapshot(`
      [
        {
          "app": "https://music.example/clientid.jsonld",
          "asserted": "2026-06-16T10:00:00Z",
          "assertedBy": [
            "https://registry.example/profile/card#me",
          ],
          "id": "https://registry.example/federation#m-music",
          "status": "Active",
          "statusIri": "https://w3id.org/jeswr/fedreg#Active",
        },
      ]
    `);
  });
});
