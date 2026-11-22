// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import type { AgentMemory, RecalledMemory } from "@jeswr/agent-memory";
import { canonicalJson, isIri } from "@jeswr/agent-reference";
import type { AdmittedFact } from "@jeswr/agent-reference/gates/common";
import { DataFactory } from "n3";

export interface RuntimeMemoryOptions {
  readonly facts: () => readonly AdmittedFact[];
  readonly owner: Pick<AgentMemory, "recall">;
  readonly purpose: string;
  readonly maxItems?: number;
  readonly maxBytes?: number;
}

type MemoryItem =
  | {
      kind: "admitted-fact";
      id: string;
      claimType: string;
      subject: AdmittedFact["subject"];
      statement: AdmittedFact["statement"];
      provenance: Pick<
        AdmittedFact,
        | "source"
        | "asOf"
        | "method"
        | "digest"
        | "admittedPurpose"
        | "supersededBy"
        | "disputedWith"
      > & {
        originalDigest: string | undefined;
        terms: NonNullable<AdmittedFact["terms"]>;
      };
    }
  | {
      kind: "owner-memory";
      resource: string;
      nanopublication: {
        dataset: Readonly<ReturnType<RecalledMemory["dataset"]["toArray"]>>;
        nanopubs: RecalledMemory["nanopubs"];
      };
    };

export interface RecallResult {
  items: MemoryItem[];
  withheld: number;
}

function time(value: string | undefined): number {
  const parsed = value === undefined ? NaN : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function recallTerms(facts: readonly AdmittedFact[], purpose: string) {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const decisions = new Map<AdmittedFact, AdmittedFact["terms"]>();
  function hasReusableTerms(
    terms: AdmittedFact["terms"] | null,
  ): terms is NonNullable<AdmittedFact["terms"]> {
    // A missing policy, including a null inherited policy, permits only the original interaction.
    return (
      terms != null && (terms.inherited?.every((input) => hasReusableTerms(input.terms)) ?? true)
    );
  }
  function effectiveTerms(fact: AdmittedFact): AdmittedFact["terms"] {
    if (decisions.has(fact)) return decisions.get(fact);
    decisions.set(fact, undefined); // Withhold cycles as well as ineligible inputs.
    const { terms, admittedPurpose, supersededBy, statement } = fact;
    if (admittedPurpose !== purpose || supersededBy !== undefined || !hasReusableTerms(terms))
      return undefined;

    const derivation = statement?.derivation;
    if (
      derivation &&
      typeof derivation === "object" &&
      !Array.isArray(derivation) &&
      "inputs" in derivation
    ) {
      const { inputs } = derivation;
      if (
        !Array.isArray(inputs) ||
        !inputs.every((input) => {
          if (
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            typeof input.id !== "string" ||
            typeof input.digest !== "string"
          )
            return false;
          const source = byId.get(input.id);
          // A different revision with the same ID cannot authorize recall of the recorded input.
          return source?.digest === input.digest && effectiveTerms(source) !== undefined;
        })
      )
        return undefined;
    }
    decisions.set(fact, terms);
    return terms;
  }
  return effectiveTerms;
}

export function createRuntimeMemory(o: RuntimeMemoryOptions): {
  recall(query: string): Promise<RecallResult>;
} {
  const { facts, owner, purpose, maxItems = 20, maxBytes = 64 * 1024 } = o;
  if (!isIri(purpose)) throw new TypeError("Memory purpose must be an IRI");
  if (
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  )
    throw new RangeError("Invalid memory bounds");

  return {
    async recall(query) {
      const needle = query.toLowerCase();
      const matches = (value?: string) => value?.toLowerCase().includes(needle) === true;
      const recalled = await owner.recall({ purpose, limit: 50 });
      const candidates: { item: MemoryItem; at: number; id: string }[] = [];
      const result: RecallResult = { items: [], withheld: 0 };
      const admitted = facts();
      const effectiveTerms = recallTerms(admitted, purpose);
      for (const fact of admitted) {
        const terms = effectiveTerms(fact);
        if (!terms) {
          result.withheld++;
          continue;
        }
        const {
          id,
          claimType,
          subject,
          source,
          asOf,
          method,
          digest,
          original,
          admittedPurpose,
          supersededBy,
          disputedWith,
          statement,
        } = fact;
        if (
          ![claimType, subject, source].some(matches) &&
          !(statement && matches(canonicalJson(statement)))
        )
          continue;
        candidates.push({
          id,
          at: time(asOf),
          item: {
            kind: "admitted-fact",
            id,
            claimType,
            subject,
            statement,
            provenance: {
              source,
              asOf,
              method,
              digest,
              originalDigest: original?.digest,
              admittedPurpose,
              terms,
              supersededBy,
              disputedWith,
            },
          },
        });
      }
      for (const { resource, dataset, nanopubs } of recalled) {
        // AgentMemory supplies one permitted nanopublication and its four graphs per result.
        const publication = nanopubs[0];
        if (!publication) continue;
        const assertions = dataset.getQuads(
          null,
          null,
          null,
          DataFactory.namedNode(publication.assertionId),
        );
        if (
          !assertions.some(({ subject, predicate, object }) =>
            [subject.value, predicate.value, object.value].some(matches),
          )
        )
          continue;
        candidates.push({
          id: publication.id,
          at: time(publication.generatedAt),
          // Preserve the quads and metadata in a JSON-serializable tool result.
          item: {
            kind: "owner-memory",
            resource,
            nanopublication: { dataset: dataset.toArray(), nanopubs },
          },
        });
      }
      candidates.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : Number(a.id > b.id)));
      let bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes > maxBytes) throw new RangeError("Memory bounds cannot fit the recall result");
      for (const { item } of candidates) {
        if (result.items.length >= maxItems) break;
        const size = Buffer.byteLength(JSON.stringify(item)) + Number(result.items.length > 0);
        if (bytes + size > maxBytes) continue;
        result.items.push(item);
        bytes += size;
      }
      return result;
    },
  };
}
