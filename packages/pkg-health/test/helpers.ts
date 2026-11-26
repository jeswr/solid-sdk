// AUTHORED-BY Codex GPT-6.1-Sol
import {
  buildNanopublications,
  type Claim,
  createFactAssertion,
  type Fact,
  type Nanopublications,
} from "@jeswr/pkg-memory";
import type { DatasetCore, Term } from "@rdfjs/types";
import { NamedNodeFrom, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df, type Store } from "n3";
import { entities } from "../src/generated/model.js";
export const owner = "https://example.org/people/avery#me";
export const other = "https://example.org/people/morgan#me";
export const generatedAt = "2026-11-10T12:00:00Z";
export const H = "https://jeswr.org/ns/sectors/health#";
export const S = "https://schema.org/";
export const X = "http://www.w3.org/2001/XMLSchema#";
/** Fixture writes use wrapper mappers and the public builder, never hand-built quads. */
export class FixtureNode extends TermWrapper {
  constructor(term: string | Term, dataset: DatasetCore) {
    super(typeof term === "string" ? df.namedNode(term) : term, dataset, df);
  }
  text(p: string, value: string, datatype = `${X}string`): this {
    SetFrom.subjectPredicate(this, p, TermAs.term, TermFrom.itself).add(
      df.literal(value, df.namedNode(datatype)),
    );
    return this;
  }
  link(p: string, value: string | Term): this {
    SetFrom.subjectPredicate(this, p, TermAs.term, TermFrom.itself).add(
      typeof value === "string" ? NamedNodeFrom.string(value, df) : value,
    );
    return this;
  }
}
export function condition(name = "Fictional condition", id = "condition"): Fact {
  return { template: "condition", value: { id: `https://example.org/entities/${id}`, name } };
}
export function medication(): Fact {
  return {
    template: "medication",
    value: {
      id: "https://example.org/entities/medication",
      medication: {
        id: "https://example.org/entities/product",
        name: "Fictionalium",
        atcCode: "C01AA00",
      },
      dose: { value: "2.00", unit: "mg", frequency: "daily" },
    },
  };
}
export function observation(
  options: {
    id?: string;
    label?: string;
    value?: string;
    datatype?: string;
    date?: string;
    dateType?: string;
    unit?: string;
    patient?: string;
    code?: string;
  } = {},
): Store {
  const id = `https://example.org/observations/${options.id ?? "one"}`;
  const store = entities.Observation.build(id, {
    name: options.label ?? "Heart rate",
    patient: options.patient ?? owner,
    unitCode: options.unit ?? "/min",
  });
  const node = new FixtureNode(id, store);
  node.text(`${H}value`, options.value ?? "72", X + (options.datatype ?? "integer"));
  if (options.date !== undefined)
    node.text(`${H}effectiveTime`, options.date, X + (options.dateType ?? "dateTime"));
  if (options.code) {
    const code = `https://example.org/codes/${options.code}`;
    node.link(`${H}hasCode`, code);
    const data = entities.CodeableConcept.build(code, {
      codeValue: options.code,
      exactMatch: `https://loinc.org/${options.code}`,
    });
    store.addQuads([...data]);
  }
  return store;
}
export async function batch(claims: Claim[], id = "health-test"): Promise<Nanopublications> {
  return buildNanopublications(
    {
      batch_id: id,
      worker: { agent_id: "https://example.org/agents/client", agent_label: "Fictional extractor" },
      sources: [
        {
          id: "chat",
          kind: "codex-thread",
          thread_id: "12345678-1234-4234-8234-123456789abc",
          title: "Fictional health discussion",
          model: "fictional-model",
          created: "2026-11-01T10:00:00Z",
        },
      ],
      claims,
    },
    { owner, generatedAt },
  );
}
export function claim(id: string, fact: Fact = condition()): Claim {
  return {
    id,
    assertion: createFactAssertion(owner, fact),
    epistemic: "SelfReportedExplicit",
    categories: ["pd:MedicalHealth"],
  };
}

/**
 * Like `batch`, but models a record from a foreign or older export that this builder did
 * not write: the builder always adds `pd:MedicalHealth` to a claim whose assertion has a
 * clinical type, so it is removed again for every claim whose own `categories` omit it
 * (and that is not listed in `nonClinical`). Each removal is asserted to have happened.
 */
export async function foreignBatch(
  claims: Claim[],
  id = "health-test",
  nonClinical: readonly string[] = [],
): Promise<Nanopublications> {
  const value = await batch(claims, id);
  const medical = df.namedNode("https://w3id.org/dpv/pd#MedicalHealth");
  const hasPersonalData = df.namedNode("https://w3id.org/dpv#hasPersonalData");
  for (const c of claims) {
    // Claims whose assertion has no clinical type are never auto-tagged: nothing to remove.
    if (nonClinical.includes(c.id)) continue;
    if (c.categories?.some((category) => category.endsWith("MedicalHealth"))) continue;
    const np = value.nanopubs.find((n) => n.identifier === `${id}/${c.id}`);
    if (!np) throw new Error("Missing fixture nanopub");
    const removed = value.dataset.removeQuad(
      df.quad(
        df.namedNode(np.assertionId),
        hasPersonalData,
        medical,
        df.namedNode(np.provenanceId),
      ),
    );
    // Every targeted claim must really have carried the auto-added category.
    if (!removed || !np.categories.includes(medical.value))
      throw new Error("Auto-added category not found");
    np.categories = np.categories.filter((category) => category !== medical.value);
  }
  return value;
}
