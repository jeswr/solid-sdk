// AUTHORED-BY Codex GPT-6.1-Sol
import { PREFIXES } from "@jeswr/site-model";
import { DataFactory, Parser, type Quad, Writer } from "n3";

export { PREFIXES };

export function writeQuads(quads: readonly Quad[]): string {
  // The in-memory n3 writer invokes end synchronously (no external output stream).
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  writer.addQuads([...quads]);
  let result = "";
  writer.end((error, text) => {
    if (error) throw error;
    result = text;
  });
  return result;
}

/** Useful for planner replies that use the well-known prefixes without redeclaring them. */
export function readQuads(text: string): Quad[] {
  return new Parser().parse([writeQuads([]), text].join("\n"));
}

/** Preserve complete connected blank-node structures when imposing the observation budget. */
export function budgetTurtle(turtle: string, budget: number): string {
  if (!turtle || budget <= 0) return "";
  let quads: Quad[];
  try {
    quads = readQuads(turtle);
  } catch {
    return "";
  }
  const kept: Quad[] = [];
  const seen = new Set<Quad>();
  for (const seed of quads) {
    if (seen.has(seed)) continue;
    const subjects = new Set([`${seed.subject.termType}:${seed.subject.value}`]);
    const group = new Set<Quad>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const q of quads) {
        const subject = `${q.subject.termType}:${q.subject.value}`;
        const object = `${q.object.termType}:${q.object.value}`;
        if (subjects.has(subject) || (q.object.termType === "BlankNode" && subjects.has(object))) {
          if (!group.has(q)) changed = true;
          group.add(q);
          subjects.add(subject);
          if (q.object.termType === "BlankNode") subjects.add(object);
        }
      }
    }
    for (const q of group) seen.add(q);
    const candidate = writeQuads([...kept, ...group]);
    if (candidate.length <= budget) kept.push(...group);
  }
  return kept.length ? writeQuads(kept) : "";
}

/** Remove markup/links in literal values, keeping RDF structure and untrusted wrappers intact. */
export function mapLiterals(turtle: string, clean: (text: string) => string): string {
  try {
    return writeQuads(
      readQuads(turtle).map((q) => {
        if (q.object.termType !== "Literal") return q;
        const object = DataFactory.literal(
          clean(q.object.value),
          q.object.language || q.object.datatype,
        );
        return DataFactory.quad(q.subject, q.predicate, object, q.graph);
      }),
    );
  } catch {
    return "";
  }
}
