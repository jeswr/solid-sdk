// AUTHORED-BY Codex GPT-6.1-Sol
import { createHash } from "node:crypto";
import type { DatasetCore, Term } from "@rdfjs/types";
import { DataFactory as df, Store } from "n3";
import { iri, NS, normalizeLiteral } from "./rdf.js";

function uuid(namespace: string, name: string): string {
  const hash = createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name)
    .digest();
  hash[6] = ((hash[6] as number) & 15) | 80;
  hash[8] = ((hash[8] as number) & 63) | 128;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** UUIDv5 namespace used by the Python PKG builder. */
export const PKG_NAMESPACE_UUID = uuid("6ba7b811-9dad-11d1-80b4-00c04fd430c8", NS.pkg);
/** Deterministic PKG IRI, with the reference builder's pipe-delimited name. */
export function pkgId(...parts: string[]): string {
  return `urn:uuid:${uuid(PKG_NAMESPACE_UUID, parts.join("|"))}`;
}
/** Preserve UUID message ids; hash provider-specific message ids. */
export function messageId(value: string): string {
  const raw = value
    .replace(/^msg_/, "")
    .replace(/^urn:uuid:/, "")
    .replace(/[{}-]/g, "");
  if (/^[\da-f]{32}$/i.test(raw)) {
    return `urn:uuid:${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`.toLowerCase();
  }
  return pkgId("message", value);
}
const hash = (value: string): bigint =>
  BigInt(`0x${createHash("sha256").update(value).digest("hex")}`);

// These are hash-input encodings, not an RDF writer. RDFlib's N-Triples and
// term.n3() encodings differ, notably for multiline literals and xsd:string.
function termN3(term: Term, nt = false): string {
  if (term.termType === "NamedNode") return `<${term.value}>`;
  if (term.termType === "BlankNode") return `_:${term.value}`;
  if (term.termType !== "Literal") throw new Error("Expected RDF 1.1 term");
  let text: string;
  if (!nt && term.value.includes("\n")) {
    let encoded = term.value.replaceAll("\\", "\\\\").replaceAll('"""', '\\"\\"\\"');
    if (encoded.endsWith('"') && !encoded.endsWith('\\"')) encoded = `${encoded.slice(0, -1)}\\"`;
    text = `"""${encoded.replaceAll("\r", "\\r")}"""`;
  } else {
    text = `"${term.value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"').replaceAll("\r", "\\r")}"`;
  }
  if (term.language) return `${text}@${term.language}`;
  return term.datatype.value === `${NS.xsd}string` ? text : `${text}^^<${term.datatype.value}>`;
}

type Color = { nodes: Term[]; color: string | string[][] };
function colorHash(c: Color): string {
  return typeof c.color === "string"
    ? c.color
    : c.color.reduce((sum, item) => sum + hash(item.join(" ")), 0n).toString(16);
}
function compare(a: Color, b: Color): number {
  return (
    a.nodes.length - b.nodes.length ||
    Buffer.compare(Buffer.from(colorHash(a)), Buffer.from(colorHash(b)))
  );
}
function discrete(colors: Color[]): boolean {
  return colors.every((c) => c.nodes.length === 1);
}

function labels(store: DatasetCore, maxWork: number): Map<string, string> {
  const blank = new Map<string, Term>();
  const others = new Map<string, Term>();
  for (const q of store) {
    const terms = [q.subject, q.predicate, q.object];
    if (!terms.some((t) => t.termType === "BlankNode")) continue;
    for (const t of terms) (t.termType === "BlankNode" ? blank : others).set(termN3(t), t);
  }
  if (blank.size === 0) return new Map();
  const initial: Color[] = [
    { nodes: [...blank.values()], color: [] },
    ...[...others.values()].map((t) => ({ nodes: [t], color: termN3(t) })),
  ];
  function refine(input: Color[], splitters: Color[]): Color[] {
    let colors = [...input];
    let queue = [...splitters].sort(compare).reverse();
    while (queue.length && !discrete(colors)) {
      const splitter = queue.pop() as Color;
      for (const c of [...colors]) {
        if (c.nodes.length === 1 && c.nodes[0]?.termType !== "BlankNode") continue;
        const groups = new Map<string, Color>();
        for (const n of c.nodes) {
          const color = [...(c.color as string[][])];
          for (const adjacent of splitter.nodes) {
            for (const q of store.match(n, null, adjacent))
              color.push(["1", termN3(q.predicate), colorHash(splitter)]);
            for (const q of store.match(adjacent, null, n))
              color.push([colorHash(splitter), termN3(q.predicate), "3"]);
          }
          const key = colorHash({ nodes: [], color });
          let group = groups.get(key);
          if (!group) {
            group = { nodes: [], color };
            groups.set(key, group);
          }
          group.nodes.push(n);
        }
        const replacements = [...groups.values()].sort(compare).reverse();
        colors = colors.filter((other) => other !== c).concat(replacements);
        const position = queue.indexOf(c);
        if (position >= 0) queue.splice(position, 1, ...replacements);
        else queue = replacements.slice(1).concat(queue);
      }
    }
    // Match the reference's final regrouping, including additive hash collisions.
    const combined = new Map(colors.map((c) => [colorHash(c), { ...c, nodes: [] as Term[] }]));
    for (const c of colors) (combined.get(colorHash(c)) as Color).nodes.push(...c.nodes);
    return [...combined.values()];
  }
  let budget = maxWork;
  function distinguish(colors: Color[]): Color[] {
    if (discrete(colors)) return colors;
    let best: Color[][] = [];
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i] as Color;
      if (c.nodes.length === 1) continue;
      for (const n of c.nodes) {
        if (--budget <= 0) throw new Error("Assertion canonicalization work limit exceeded");
        const copy = colors.map((c) => ({ nodes: [...c.nodes], color: c.color }));
        const chosen = copy[i] as Color;
        chosen.nodes = chosen.nodes.filter((t) => !t.equals(n));
        const singleton = {
          nodes: [n],
          color: [...(c.color as string[][]), [String(c.nodes.length)]],
        };
        const candidate = refine([...copy, singleton], [singleton]);
        const comparison = best.length === 0 ? 1 : score(candidate, best[0] as Color[]);
        if (comparison > 0) best = [candidate];
        else if (comparison === 0) best.push(candidate);
      }
    }
    // RDFlib prefers any discrete tied candidate before descending into the
    // first unresolved candidate. Keep all ties; its automorphism pruning is
    // an optimization and is unnecessary for these bounded assertion graphs.
    return best.find(discrete) ?? distinguish(best[0] as Color[]);
  }
  function score(a: Color[], b: Color[]): number {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const diff = compare(a[i] as Color, b[i] as Color);
      if (diff !== 0) return diff;
    }
    return a.length - b.length;
  }
  return new Map(
    distinguish(refine(initial, initial))
      .filter((c) => c.nodes[0]?.termType === "BlankNode")
      .map((c) => [(c.nodes[0] as Term).value, `cb${colorHash(c)}`]),
  );
}

/** Canonical assertion IRI and skolemized graph, compatible with RDFlib 7. */
export function canonicalizeAssertion(
  dataset: DatasetCore,
  { maxWork = 10000 }: { maxWork?: number } = {},
): { id: string; dataset: Store } {
  if (dataset.size === 0) throw new Error("Empty assertion");
  const normalized = new Store();
  for (const q of dataset) {
    if (q.graph.termType !== "DefaultGraph")
      throw new Error("Assertion must be a single default graph");
    for (const t of [
      q.subject,
      q.predicate,
      q.object,
      ...(q.object.termType === "Literal" ? [q.object.datatype] : []),
    ]) {
      if (t.termType === "NamedNode" && iri(t.value) !== t.value)
        throw new Error("Unsafe assertion IRI");
    }
    normalized.addQuad(
      df.quad(
        q.subject,
        q.predicate,
        q.object.termType === "Literal" ? normalizeLiteral(q.object) : q.object,
      ),
    );
  }
  const names = labels(normalized, maxWork);
  const canonical = (t: Term): Term =>
    t.termType === "BlankNode" ? df.blankNode(names.get(t.value) as string) : t;
  const lines = [...normalized]
    .map(
      (q) =>
        `${[q.subject, q.predicate, q.object].map((t) => termN3(canonical(t), true)).join(" ")} .`,
    )
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const digest = createHash("sha256").update(lines.join("\n")).digest("hex");
  const skolem = (t: Term): Term =>
    t.termType === "BlankNode"
      ? df.namedNode(pkgId("assertion", digest, "node", names.get(t.value) as string))
      : t;
  const out = new Store();
  for (const q of normalized)
    out.addQuad(
      df.quad(
        skolem(q.subject) as typeof q.subject,
        q.predicate,
        skolem(q.object) as typeof q.object,
      ),
    );
  return { id: pkgId("assertion", digest), dataset: out };
}
