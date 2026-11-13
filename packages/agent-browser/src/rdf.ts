// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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

const type = `${PREFIXES.rdf}type`;
const untrustedType = `${PREFIXES.sab}UntrustedText`;
const outcomeType = `${PREFIXES.sab}ActionOutcome`;
const key = (term: Quad["subject"] | Quad["object"]) => `${term.termType}:${term.value}`;

function splitQuads(quads: Quad[], shorten = true): { trusted: Quad[]; untrusted: Quad[] } {
  const untrustedNodes = new Set(
    quads
      .filter((q) => q.predicate.value === type && q.object.value === untrustedType)
      .map((q) => key(q.subject)),
  );
  const outcomes = new Set(
    quads
      .filter((q) => q.predicate.value === type && q.object.value === outcomeType)
      .map((q) => key(q.subject)),
  );
  const trusted: Quad[] = [];
  const untrusted: Quad[] = [];
  const marker = "… [truncated]";
  for (let q of quads) {
    const unsafe =
      untrustedNodes.has(key(q.subject)) ||
      untrustedNodes.has(key(q.object)) ||
      (q.object.termType === "Literal" && q.object.datatype.value === untrustedType);
    if (shorten && unsafe && q.object.termType === "Literal" && q.object.value.length > 200)
      q = DataFactory.quad(
        q.subject,
        q.predicate,
        DataFactory.literal(
          q.object.value.slice(0, 200 - marker.length) + marker,
          q.object.language || q.object.datatype,
        ),
        q.graph,
      );
    (unsafe ? untrusted : trusted).push(q);
  }
  return {
    trusted: [
      ...trusted.filter((q) => outcomes.has(key(q.subject))),
      ...trusted.filter((q) => !outcomes.has(key(q.subject))),
    ],
    untrusted,
  };
}

/** Cap third-party prose before imposing any trusted-fact budget. */
export function observationParts(turtle: string): { trusted: Quad[]; untrusted: Quad[] } {
  try {
    return splitQuads(readQuads(turtle));
  } catch {
    return { trusted: [], untrusted: [] };
  }
}

/** Receipts first, then the last step's trusted facts, then earlier steps and third-party text. */
export function orderObservations(turtles: readonly string[]): string {
  // Parse separately so identically named blank nodes from different responses cannot merge.
  const graphs = turtles.map((turtle) => {
    try {
      return splitQuads(readQuads(turtle), false);
    } catch {
      return { trusted: [], untrusted: [] };
    }
  });
  const receipts = graphs.filter((g) =>
    g.trusted.some((q) => q.predicate.value === type && q.object.value === outcomeType),
  );
  const steps = graphs.filter((g) => !receipts.includes(g)).reverse();
  const quads = [
    ...receipts.flatMap((g) => g.trusted),
    ...steps.flatMap((g) => g.trusted),
    ...[...graphs].reverse().flatMap((g) => g.untrusted),
  ];
  const seen = new Set<string>();
  const unique = quads.filter((q) => {
    const identity = JSON.stringify(q);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
  return unique.length ? writeQuads(unique) : "";
}

/** Preserve connected blank-node structures, considering quads in priority order. */
export function budgetQuads(
  quads: readonly Quad[],
  budget: number,
  initial: readonly Quad[] = [],
): Quad[] {
  if (budget <= 0) return [];
  const kept: Quad[] = [...initial];
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
    const next = [...kept, ...group];
    if (writeQuads(next).length <= budget) kept.push(...group);
  }
  return kept;
}

/** Shorten untrusted text first; discard untrusted structures before trusted items. */
export function budgetTurtle(turtle: string, budget: number): string {
  const { trusted, untrusted } = observationParts(turtle);
  const kept = budgetQuads(trusted, budget);
  // Untrusted links are considered independently so they cannot crowd out their item's facts.
  const result = budgetQuads(untrusted, budget, kept);
  return result.length ? writeQuads(result) : "";
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
