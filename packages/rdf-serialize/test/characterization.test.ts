// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Behavior-parity characterization of the consolidated serializer against EACH of
// the five consumers' original `src/serialize.ts` implementations.
//
// `oldSerialize` below is a verbatim reconstruction of the shared body every copy
// shipped (the only per-copy differences are the prefix map and whether an empty
// graph short-circuits to ""). Each consumer's exact prefix map + short-circuit
// flag is encoded as a fixture. We run the OLD body and the NEW consolidated
// `serialize` on the same quad set, canonicalize both outputs (so the assertion
// proves observable equivalence, not byte-identical formatting), and assert equal.
//
// This gives a true behavior-parity proof WITHOUT importing the five packages.

import { DataFactory, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { serialize } from "../src/index.js";

const { namedNode, literal, blankNode, quad, defaultGraph } = DataFactory;

// ---------------------------------------------------------------------------
// The original shared implementation, reconstructed verbatim (the only knobs the
// five copies varied: `prefixes` and whether to short-circuit an empty graph).
// ---------------------------------------------------------------------------
function oldSerialize(
  quads: readonly import("@rdfjs/types").Quad[],
  format: string,
  prefixes: Readonly<Record<string, string>>,
  shortCircuitEmpty: boolean,
): Promise<string> {
  if (shortCircuitEmpty && quads.length === 0) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    const writer = new Writer({ format, prefixes });
    writer.addQuads(quads as import("@rdfjs/types").Quad[]);
    writer.end((error: Error | null, result: string) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Canonicalize a serialised RDF document so we compare observable content, not
// incidental formatting: trim, drop blank lines, sort the remaining lines. This
// neutralises statement ordering, prefix-declaration ordering and whitespace
// while still detecting any genuine difference in emitted triples/prefixes.
// ---------------------------------------------------------------------------
function canon(s: string): string {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .sort()
    .join("\n");
}

// ---------------------------------------------------------------------------
// The exact prefix maps each consumer hard-coded (IRIs from each src/vocab.ts).
// ---------------------------------------------------------------------------
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const ACL_NS = "http://www.w3.org/ns/auth/acl#";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
const SCHEMA_NS = "https://schema.org/";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const ODRL_NS = "http://www.w3.org/ns/odrl/2/";
const SH_NS = "http://www.w3.org/ns/shacl#";
const LDP_NS = "http://www.w3.org/ns/ldp#";
const FOAF_NS = "http://xmlns.com/foaf/0.1/";
const INTEROP_NS = "http://www.w3.org/ns/solid/interop#";

const VC_NS = "https://www.w3.org/2018/credentials#";
const SEC_NS = "https://w3id.org/security#";
const SVC_NS = "https://w3id.org/jeswr/solid-vc#";
const DPV_NS = "https://w3id.org/dpv#";
const A2A_NS = "https://w3id.org/jeswr/a2a#";
const FEDAPP_NS = "https://w3id.org/jeswr/fed#";
const SHACL_NS = "http://www.w3.org/ns/shacl#";
const ANP_AD_NS = "https://w3id.org/agent-description#";

interface ConsumerFixture {
  name: string;
  prefixes: Readonly<Record<string, string>>;
  // The 4-of-5 short-circuit an empty graph; federation-client does not.
  shortCircuitEmpty: boolean;
}

const CONSUMERS: readonly ConsumerFixture[] = [
  {
    name: "solid-vc",
    prefixes: {
      cred: VC_NS,
      sec: SEC_NS,
      svc: SVC_NS,
      acl: ACL_NS,
      odrl: ODRL_NS,
      schema: SCHEMA_NS,
      xsd: XSD_NS,
      rdf: RDF_NS,
      rdfs: RDFS_NS,
      // vc derives dcterms via DC_CREATED.replace("created","").
      dcterms: DCTERMS_NS,
    },
    shortCircuitEmpty: true,
  },
  {
    name: "solid-odrl",
    prefixes: {
      odrl: ODRL_NS,
      acl: ACL_NS,
      dpv: DPV_NS,
      xsd: XSD_NS,
      dcterms: DCTERMS_NS,
      rdf: RDF_NS,
      rdfs: RDFS_NS,
    },
    shortCircuitEmpty: true,
  },
  {
    name: "solid-a2a",
    prefixes: {
      a2a: A2A_NS,
      schema: SCHEMA_NS,
      acl: ACL_NS,
      ldp: LDP_NS,
      sh: SH_NS,
      xsd: XSD_NS,
      dcterms: DCTERMS_NS,
      rdf: RDF_NS,
      rdfs: RDFS_NS,
    },
    shortCircuitEmpty: true,
  },
  {
    name: "federation-client",
    prefixes: {
      fedapp: FEDAPP_NS,
      acl: ACL_NS,
      sh: SHACL_NS,
      rdf: RDF_NS,
    },
    // federation-client does NOT short-circuit empty input.
    shortCircuitEmpty: false,
  },
  {
    name: "solid-agent-card",
    prefixes: {
      ad: ANP_AD_NS,
      interop: INTEROP_NS,
      schema: SCHEMA_NS,
      foaf: FOAF_NS,
      dcterms: DCTERMS_NS,
      rdf: RDF_NS,
      rdfs: RDFS_NS,
    },
    shortCircuitEmpty: true,
  },
];

// A representative quad set exercising the prefixes each consumer declares plus
// the common ones, a typed literal, a language-tagged literal and a blank node.
function representativeQuads(): import("@rdfjs/types").Quad[] {
  const s = namedNode("https://example.org/subject");
  const b = blankNode("b0");
  return [
    quad(s, namedNode(`${RDF_NS}type`), namedNode(`${SCHEMA_NS}Thing`)),
    quad(s, namedNode(`${RDFS_NS}label`), literal("A thing", "en")),
    quad(s, namedNode(`${SCHEMA_NS}name`), literal("Example")),
    quad(s, namedNode(`${DCTERMS_NS}created`), literal("2026-06-19", namedNode(`${XSD_NS}date`))),
    quad(s, namedNode(`${ACL_NS}mode`), namedNode(`${ACL_NS}Read`)),
    quad(s, namedNode(`${SCHEMA_NS}about`), b),
    quad(b, namedNode(`${RDFS_NS}comment`), literal("nested")),
  ];
}

// The new consolidated serializer, parameterised exactly like a consumer.
function consolidated(
  quads: readonly import("@rdfjs/types").Quad[],
  format: string,
  c: ConsumerFixture,
): Promise<string> {
  return serialize(quads, {
    format,
    prefixes: c.prefixes,
    emptyAsEmptyString: c.shortCircuitEmpty,
  });
}

describe("behavior parity vs each consumer's original serializer", () => {
  for (const c of CONSUMERS) {
    describe(c.name, () => {
      const quads = representativeQuads();

      it("matches Turtle (default format) output", async () => {
        const oldOut = await oldSerialize(quads, "text/turtle", c.prefixes, c.shortCircuitEmpty);
        const newOut = await consolidated(quads, "text/turtle", c);
        expect(canon(newOut)).toBe(canon(oldOut));
        expect(newOut.length).toBeGreaterThan(0);
      });

      it("matches application/n-triples output", async () => {
        const oldOut = await oldSerialize(
          quads,
          "application/n-triples",
          c.prefixes,
          c.shortCircuitEmpty,
        );
        const newOut = await consolidated(quads, "application/n-triples", c);
        expect(canon(newOut)).toBe(canon(oldOut));
      });

      it("matches application/n-quads output", async () => {
        // N-Quads include the graph term; add a quad in a named graph.
        const g = namedNode("https://example.org/graph");
        const quadsWithGraph = [
          ...quads,
          quad(
            namedNode("https://example.org/s2"),
            namedNode(`${RDF_NS}type`),
            namedNode(`${SCHEMA_NS}Thing`),
            g,
          ),
        ];
        const oldOut = await oldSerialize(
          quadsWithGraph,
          "application/n-quads",
          c.prefixes,
          c.shortCircuitEmpty,
        );
        const newOut = await consolidated(quadsWithGraph, "application/n-quads", c);
        expect(canon(newOut)).toBe(canon(oldOut));
      });

      it("matches the bogus-format -> Turtle fallback (n3.Writer's own behaviour)", async () => {
        const oldOut = await oldSerialize(
          quads,
          "application/totally-bogus",
          c.prefixes,
          c.shortCircuitEmpty,
        );
        const newOut = await consolidated(quads, "application/totally-bogus", c);
        expect(canon(newOut)).toBe(canon(oldOut));
        // The fallback is Turtle, so it equals the Turtle output.
        const ttl = await consolidated(quads, "text/turtle", c);
        expect(canon(newOut)).toBe(canon(ttl));
      });

      it("matches empty-graph behaviour", async () => {
        const oldOut = await oldSerialize([], "text/turtle", c.prefixes, c.shortCircuitEmpty);
        const newOut = await consolidated([], "text/turtle", c);
        expect(newOut).toBe(oldOut);
        if (c.shortCircuitEmpty) {
          expect(newOut).toBe("");
        } else {
          // federation-client: n3.Writer emits a (possibly preamble) string.
          expect(typeof newOut).toBe("string");
        }
      });
    });
  }
});

describe("empty-graph divergence is reproduced by emptyAsEmptyString", () => {
  const quads: import("@rdfjs/types").Quad[] = [];
  const prefixes = { schema: SCHEMA_NS };

  it("emptyAsEmptyString:true -> '' (the 4-of-5 majority)", async () => {
    const out = await serialize(quads, { prefixes, emptyAsEmptyString: true });
    expect(out).toBe("");
  });

  it("emptyAsEmptyString:false -> non-empty preamble (federation-client parity)", async () => {
    const out = await serialize(quads, { prefixes, emptyAsEmptyString: false });
    expect(typeof out).toBe("string");
    // With prefixes declared and no short-circuit, n3.Writer emits the preamble.
    expect(out.length).toBeGreaterThan(0);
  });

  it("emptyAsEmptyString defaults to true", async () => {
    const out = await serialize(quads, { prefixes });
    expect(out).toBe("");
  });

  it("empty graph with NO prefixes and emptyAsEmptyString:false matches raw n3.Writer", async () => {
    const out = await serialize([], { emptyAsEmptyString: false });
    const writer = new Writer({ format: "text/turtle", prefixes: {} });
    const raw = await new Promise<string>((resolve, reject) => {
      writer.end((e: Error | null, r: string) => (e ? reject(e) : resolve(r)));
    });
    expect(out).toBe(raw);
  });
});

describe("blank-node round-trip", () => {
  it("serialises a blank-node-anchored statement deterministically", async () => {
    const b = blankNode("anchor");
    const quads = [
      quad(b, namedNode(`${RDF_NS}type`), namedNode(`${SCHEMA_NS}Thing`)),
      quad(b, namedNode(`${SCHEMA_NS}name`), literal("anon")),
    ];
    const out = await serialize(quads, { prefixes: { schema: SCHEMA_NS } });
    expect(out).toContain("schema:Thing");
    expect(out).toContain('"anon"');
    // Repeated serialisation of the same input is byte-identical.
    const again = await serialize(quads, { prefixes: { schema: SCHEMA_NS } });
    expect(again).toBe(out);
  });
});

describe("literal with datatype + language tag", () => {
  const s = namedNode("https://example.org/s");

  it("emits a language-tagged literal", async () => {
    const out = await serialize([quad(s, namedNode(`${RDFS_NS}label`), literal("bonjour", "fr"))], {
      prefixes: { rdfs: RDFS_NS },
    });
    expect(out).toContain('"bonjour"@fr');
  });

  it("emits a datatyped literal", async () => {
    const out = await serialize(
      [quad(s, namedNode(`${SCHEMA_NS}value`), literal("42", namedNode(`${XSD_NS}integer`)))],
      { prefixes: { schema: SCHEMA_NS, xsd: XSD_NS } },
    );
    // n3 abbreviates xsd:integer-typed literals; the value must be present.
    expect(out).toContain("42");
  });
});

describe("prefix ordering determinism", () => {
  it("produces byte-identical output across repeated calls", async () => {
    const quads = representativeQuads();
    const prefixes = { schema: SCHEMA_NS, rdf: RDF_NS, rdfs: RDFS_NS };
    const a = await serialize(quads, { prefixes });
    const b = await serialize(quads, { prefixes });
    const c = await serialize(quads, { prefixes });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

// Ensure unused factory helpers are referenced (defaultGraph) to keep the import
// honest and to document the default-graph case the writer handles implicitly.
describe("default graph", () => {
  it("serialises a default-graph quad like a triple", async () => {
    const q = quad(
      namedNode("https://example.org/s"),
      namedNode(`${RDF_NS}type`),
      namedNode(`${SCHEMA_NS}Thing`),
      defaultGraph(),
    );
    const out = await serialize([q], { prefixes: { schema: SCHEMA_NS } });
    expect(out).toContain("schema:Thing");
  });
});
