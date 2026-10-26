import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JsonLdParser } from "jsonld-streaming-parser";
import { DataFactory, type Quad, Store, Writer } from "n3";
import { beforeAll, describe, expect, it } from "vitest";
import { AWP, DPV, DPV_VALIDATION, FIXTURE } from "./profile/vocabulary.js";
import {
  COMPETENCY_QUERIES,
  collectRuntimeEvidence,
  evidenceGraph,
  FORBIDDEN,
  type RuntimeEvidence,
} from "./rdf/competency.js";
import { ledgerToRdf, RDF } from "./rdf/evidence.js";
import { parseTurtle, runQuery, toJsonLd, toSparql, toTurtle } from "./rdf/serialise.js";

const VOCAB_PATH = fileURLToPath(new URL("../../docs/rdf/awp-pilot.ttl", import.meta.url));
const OWL = "http://www.w3.org/2002/07/owl#";

function ntriples(quads: readonly Quad[]): string[] {
  const w = new Writer({ format: "N-Triples" });
  return [...new Set(quads.map((q) => w.quadToString(q.subject, q.predicate, q.object)))].sort();
}

async function parseJsonLd(doc: unknown): Promise<Quad[]> {
  const parser = new JsonLdParser();
  const out: Quad[] = [];
  await new Promise<void>((resolve, reject) => {
    parser.on("data", (q: Quad) => out.push(q));
    parser.on("error", reject);
    parser.on("end", () => resolve());
    parser.write(JSON.stringify(doc));
    parser.end();
  });
  return out;
}

let ev: RuntimeEvidence;
let graph: ReturnType<typeof evidenceGraph>;
let store: Store;
let vocab: Quad[];

beforeAll(async () => {
  ev = await collectRuntimeEvidence();
  graph = evidenceGraph(ev);
  store = new Store(graph.quads);
  vocab = parseTurtle(readFileSync(VOCAB_PATH, "utf8"), pathToFileURL(VOCAB_PATH).href);
}, 60_000);

describe("RDF vocabulary (docs/rdf/awp-pilot.ttl)", () => {
  it("parses; marks every minted term unstable; asserts no equivalence or domain/range axioms", () => {
    expect(vocab.length).toBeGreaterThan(100);
    const bad = vocab.filter((q) =>
      [
        `${OWL}equivalentClass`,
        `${OWL}equivalentProperty`,
        `${OWL}sameAs`,
        "http://www.w3.org/2000/01/rdf-schema#domain",
        "http://www.w3.org/2000/01/rdf-schema#range",
      ].includes(q.predicate.value),
    );
    expect(bad).toEqual([]);
    const declared = new Set(
      vocab
        .filter((q) => q.predicate.value === `${RDF}type` && q.subject.value.startsWith(AWP))
        .map((q) => q.subject.value),
    );
    const status = new Set(
      vocab
        .filter(
          (q) =>
            q.predicate.value === "http://www.w3.org/2003/06/sw-vocab-status/ns#term_status" &&
            q.object.value === "unstable",
        )
        .map((q) => q.subject.value),
    );
    // Every minted class and property (not SKOS concepts, which belong to unstable schemes).
    const terms = [...declared].filter((t) => !/#[a-z]+\//.test(t));
    expect(terms.filter((t) => !status.has(t))).toEqual([]);
  });

  it("describes the profile with PROF; its local artefacts exist", () => {
    const artefacts = vocab
      .filter((q) => q.predicate.value === "http://www.w3.org/ns/dx/prof/hasArtifact")
      .map((q) => q.object.value);
    expect(artefacts).toHaveLength(4);
    for (const a of artefacts.filter((x) => !x.includes("/reports/")))
      expect(existsSync(fileURLToPath(a)), a).toBe(true);
  });
});

describe("RDF evidence from runtime ledgers", () => {
  it("maps the ledgers without blank nodes, JSON literals or undeclared awp terms", () => {
    expect(
      graph.quads.some(
        (q) => q.subject.termType === "BlankNode" || q.object.termType === "BlankNode",
      ),
    ).toBe(false);
    expect(
      graph.quads.filter((q) => q.object.termType === "Literal" && /^\s*[{[]/.test(q.object.value)),
    ).toEqual([]);
    const declared = new Set(vocab.map((q) => q.subject.value));
    const used = new Set<string>();
    for (const q of graph.quads) {
      if (q.predicate.value.startsWith(AWP)) used.add(q.predicate.value);
      if (q.predicate.value === `${RDF}type` && q.object.value.startsWith(AWP))
        used.add(q.object.value);
      if (
        q.object.termType === "NamedNode" &&
        /#(conclusion|authorisation|verification|assessment|method|basis|kind|grant)\//.test(
          q.object.value,
        )
      )
        used.add(q.object.value);
    }
    expect([...used].filter((t) => !declared.has(t))).toEqual([]);
    for (const [id, r] of Object.entries(graph.reports)) {
      expect(r.entries, id).toBeGreaterThan(0);
      expect(r.mapped.verification, id).toBeGreaterThan(0);
    }
  });

  it("uses only DPV 2.1 IRIs that were checked, and fixture IRIs otherwise", () => {
    const dpv = new Set(
      graph.quads
        .flatMap((q) => [q.predicate.value, q.object.value])
        .filter((v) => v.startsWith(DPV)),
    );
    expect(
      [...dpv].filter((v) => !(DPV_VALIDATION.present as readonly string[]).includes(v)),
    ).toEqual([]);
    expect(dpv.has(`${DPV}CommunicationManagement`)).toBe(true);
    expect([...dpv].some((v) => v.endsWith("CreditChecking"))).toBe(false);
    expect(`${FIXTURE}CreditChecking`).toBe("https://example.org/awp-fixture#CreditChecking");
  });

  it("round-trips through Turtle and JSON-LD to the same graph", async () => {
    const expected = ntriples(graph.quads);
    const ttl = await toTurtle(graph.quads);
    expect(ntriples(parseTurtle(ttl))).toEqual(expected);
    const doc = toJsonLd(graph.quads);
    expect(ntriples(await parseJsonLd(doc))).toEqual(expected);
    // Deterministic: converting the same ledgers again gives identical Turtle.
    expect(await toTurtle(evidenceGraph(ev).quads)).toBe(ttl);
  });

  it("emits identifiers exactly as recorded; the runtime mints no invalid ones", () => {
    for (const [id, r] of Object.entries(graph.reports))
      expect(r.invalidIdentifiers, id).toEqual([]);
    const iris = graph.quads
      .flatMap((q) => [q.subject, q.object])
      .filter((t) => t.termType === "NamedNode");
    expect(iris.filter((t) => /#[^#]*#|%23/.test(t.value))).toEqual([]);
    // The mandate id in the ledger IS the RDF subject (one identity, no rewriting).
    const grant = ev.ledgers["urn:awp:ledger:bob"]?.find((e) => e.record.type === "grant");
    const mandateId = grant?.record.id as string;
    expect(store.getQuads(mandateId, `${RDF}type`, `${AWP}OwnerMandate`, null)).toHaveLength(1);
  });

  it("omits and reports a legacy invalid identifier instead of rewriting it", () => {
    const legacy = "https://agents.example/x#agent#mandate-scheduling";
    const r = ledgerToRdf(
      [
        {
          seq: 1,
          at: "2026-10-19T08:00:00.000Z",
          prev: "sha-256:genesis",
          hash: `sha-256:${"a".repeat(64)}`,
          record: { type: "grant", id: legacy, kind: "owner-mandate", digest: "sha-256:x" },
        },
      ],
      "urn:awp:ledger:legacy",
    );
    expect(r.report.invalidIdentifiers).toEqual([legacy]);
    expect(r.report.skeletonOnly).toEqual({ grant: 1 });
    expect(r.quads.some((q) => q.subject.value.includes("mandate-scheduling"))).toBe(false);
  });
});

describe("competency queries over runtime evidence", () => {
  const q = (id: string) => {
    const query = [...COMPETENCY_QUERIES, ...FORBIDDEN].find((x) => x.id === id);
    if (!query) throw new Error(id);
    return query;
  };

  it("CT-02: integrity results name the key holder and state what remains unproved", () => {
    const rows = runQuery(store, q("CQ-CT02"));
    expect(
      rows.some((r) => r.holder === "https://alice.example/#me" && r.outcome === "awpv:valid"),
    ).toBe(true);
    expect(rows.map((r) => r.limitation)).toContain(
      "does not establish truth, source authority or permission",
    );
  });

  it("CT-03: source authority is scoped by evaluator, claim type and rule version", () => {
    const rows = runQuery(store, q("CQ-CT03"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.version).toBeTruthy();
      expect(r.claimType).toBeTruthy();
    }
  });

  it("CT-05: each permitted action traces to a mandate by digest, ODRL action and DPV purpose", () => {
    const rows = runQuery(store, q("CQ-CT05"));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.requested).toBe("odrl:use");
      expect(r.purpose).toBe("dpv:CommunicationManagement");
      expect(r.basis).toBe("awpb:autonomous");
      expect(r.digest).toMatch(/^sha-256:[0-9a-f]{64}$/);
    }
  });

  it("CT-07: the agreement's offer/acceptance and the separate observations of fulfilment", () => {
    const rows = runQuery(store, q("CQ-CT07"));
    const observations = rows.map((r) => `${r.conclusion}/${r.method}`).sort();
    // Alice: completed directly. Bob: uncertain (adapter timed out after commit), then
    // completed by reconciliation — two observations, the first never upgraded in place.
    expect(new Set(rows.map((r) => r.termsDigest)).size).toBe(1);
    expect(new Set(rows.map((r) => r.offer)).size).toBe(1);
    expect(observations).toContain("awpc:uncertain/awpm:direct-response");
    expect(observations).toContain("awpc:completed/awpm:reconciliation");
    expect(observations).toContain("awpc:completed/awpm:direct-response");
    const peer = runQuery(store, q("CQ-CT07-peer"));
    const reported = peer.map((r) => `${r.reporter} ${r.conclusion}`);
    // Bob's peer (Alice) received both of Bob's receipts: uncertain first, then completed.
    expect(reported).toEqual(
      expect.arrayContaining([
        "https://agents.alice.example/personal#agent awpc:completed",
        "https://agents.hostco.example/bob#agent awpc:uncertain",
        "https://agents.hostco.example/bob#agent awpc:completed",
      ]),
    );
  });

  it("R11: an uncertain effect is listed until a later observation resolves it", () => {
    const before = new Store(ledgerToRdf(ev.beforeReconcile, "urn:awp:ledger:bob").quads);
    const unresolvedBefore = runQuery(before, q("CQ-R11-unresolved"));
    expect(unresolvedBefore).toHaveLength(1);
    expect(runQuery(store, q("CQ-R11-unresolved"))).toEqual([]);
  });

  it("assertion-absence checks have no answers in any one agent's export (not a non-entailment proof)", () => {
    // Evaluated per ledger: each agent's graph states only its own provenance. (Merging two
    // agents' graphs legitimately joins A's own delegation with B's record of A's claim.)
    for (const [id, entries] of Object.entries(ev.ledgers)) {
      const one = new Store(ledgerToRdf(entries, id).quads);
      for (const f of FORBIDDEN) expect(runQuery(one, f), `${id} ${f.id}`).toEqual([]);
    }
    // Sanity: the absence checks are not vacuous — the claims they guard exist.
    const bob = new Store(
      ledgerToRdf(ev.ledgers["urn:awp:ledger:bob"] ?? [], "urn:awp:ledger:bob").quads,
    );
    expect(bob.getQuads(null, `${AWP}claimedOnBehalfOf`, null, null).length).toBeGreaterThan(0);
    expect(
      bob.getQuads(null, "http://www.w3.org/ns/prov#actedOnBehalfOf", null, null).length,
    ).toBeGreaterThan(0);
  });

  it("joins on full RDF term identity (literal datatype and language are part of the term)", () => {
    const { namedNode, literal, quad } = DataFactory;
    const s = namedNode("urn:x:s");
    const p = namedNode("urn:x:p");
    const r = namedNode("urn:x:r");
    const xsdInt = namedNode("http://www.w3.org/2001/XMLSchema#integer");
    const join = {
      id: "t",
      question: "t",
      select: ["?v"],
      where: [
        ["urn:x:s", "urn:x:p", "?v"],
        ["urn:x:s", "urn:x:r", "?v"],
      ] as const,
    };
    const run = (a: ReturnType<typeof literal>, b: ReturnType<typeof literal>) =>
      runQuery(new Store([quad(s, p, a), quad(s, r, b)]), join as never);
    expect(run(literal("1", xsdInt), literal("1"))).toEqual([]);
    expect(run(literal("a", "en"), literal("a", "fr"))).toEqual([]);
    expect(run(literal("a", "en"), literal("a"))).toEqual([]);
    expect(run(literal("1", xsdInt), literal("1", xsdInt))).toEqual([{ v: "1" }]);
  });

  it("prints each query as SPARQL", () => {
    const text = toSparql(q("CQ-R11-unresolved"));
    expect(text).toContain("FILTER NOT EXISTS");
    expect(text).toContain("PREFIX awpc:");
  });
});
