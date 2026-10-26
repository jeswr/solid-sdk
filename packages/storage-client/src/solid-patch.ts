// AUTHORED-BY Codex GPT-6.1-Sol
import type { Quad } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { StorageError } from "./errors.js";
import { injectionSafe, rebuildQuads } from "./rdf.js";

/** Default-graph RDF statements for the Solid patch formulas. */
export interface RdfPatchInput {
  inserts: readonly Quad[];
  deletes: readonly Quad[];
  where?: readonly Quad[];
}

// SPARQL 1.1 VARNAME: PN_CHARS_U / digit, then those plus combining characters.
const BASE =
  "A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const VARNAME = new RegExp(`^[${BASE}0-9][${BASE}0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$`, "u");
const terms = (q: Quad) => [q.subject, q.predicate, q.object];

/** Validate before serialization; invalid RDF patches have no HTTP status. */
export async function patchFormulas(input: RdfPatchInput, url = "") {
  if (input.inserts.length === 0 && input.deletes.length === 0) throw new TypeError("empty patch");
  try {
    // Validate the rebuilt terms (plain n3 instances), so what is checked is what is written.
    const where = rebuildQuads(input.where ?? []);
    const deletes = rebuildQuads(input.deletes);
    const inserts = rebuildQuads(input.inserts);
    const bound = new Set(
      where
        .flatMap(terms)
        .filter((t) => t.termType === "Variable")
        .map((t) => t.value),
    );
    for (const [name, quads] of [
      ["where", where],
      ["deletes", deletes],
      ["inserts", inserts],
    ] as const) {
      for (const q of quads) {
        if (q.graph.termType !== "DefaultGraph")
          throw new TypeError("Patch formulas require the default graph");
        for (const term of terms(q)) {
          if (term.termType === "BlankNode" && name !== "inserts")
            throw new TypeError("Blank nodes are only allowed in inserts");
          if (term.termType === "Variable" && (!VARNAME.test(term.value) || !bound.has(term.value)))
            throw new TypeError("Invalid or unbound patch variable");
        }
      }
    }
    // One pass keeps insert labels consistent and reserves the envelope's _:patch subject.
    const safe = injectionSafe([...where, ...deletes, ...inserts], true, new Set(["patch"]));
    const formula = (quads: readonly Quad[]) =>
      serialize(quads, { format: "application/n-triples" });
    return {
      where: await formula(safe.slice(0, where.length)),
      deletes: await formula(safe.slice(where.length, where.length + deletes.length)),
      inserts: await formula(safe.slice(where.length + deletes.length)),
      variables: bound.size > 0,
    };
  } catch (cause) {
    throw new StorageError("bad-request", { method: "PATCH", url, cause });
  }
}

type Formulas = Awaited<ReturnType<typeof patchFormulas>>;

/** Fixed N3 envelope; every formula statement comes from the sanctioned RDF writer. */
export function n3Envelope(formulas: Formulas): string {
  let body =
    "@prefix solid: <http://www.w3.org/ns/solid/terms#>.\n_:patch a solid:InsertDeletePatch;\n";
  for (const name of ["where", "deletes", "inserts"] as const) {
    if (formulas[name]) body += `  solid:${name} {\n${formulas[name]}};\n`;
  }
  return `${body}.\n`;
}

/** Build a deterministic, injection-safe Solid InsertDeletePatch (N3). */
export async function buildN3Patch(input: RdfPatchInput): Promise<string> {
  return n3Envelope(await patchFormulas(input));
}
