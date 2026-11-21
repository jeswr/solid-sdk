// AUTHORED-BY Codex GPT-6.2 Sol
// AUTHORED-BY Codex GPT-6
import { DataFactory, type Store } from "n3";
import type { Json } from "../../core/types.js";
import type { AdmittedFact, ItemTerms } from "../../gates/common.js";
import { AWP, ODRL, PROV } from "../../profile/vocabulary.js";
import { makeNode } from "../core-node.js";
import { evidenceItemSpec } from "../evidence-item.js";
import { NamedValuesNode, SCHEMA, scopedId } from "../named-values.js";
import { enumeration, exact, field, instant, link, RDFS, StoreNode, storeModel } from "./common.js";
import { type NativePolicy, policyDataset, policyFromStore } from "./policy.js";

const policyLink = ODRL + "hasPolicy";
const termsLink = AWP + "terms";
const grantLink = AWP + "dataUseGrant";
const inheritedLink = AWP + "inheritedTerms";
const MAX_TERMS_DEPTH = 32;
const MAX_INHERITED_REFERENCES = 8_192;
const { namedNode } = DataFactory;

storeModel(
  "StoreEvidenceItem",
  {
    role: evidenceItemSpec.fields.role!,
    format: evidenceItemSpec.fields.format!,
    value: exact("evidenceBytes", "evidenceBytesDigest"),
  },
  evidenceItemSpec.type,
);
storeModel("OriginalStatement", {
  id: field("iri", "recordIdentifier"),
  digest: field("text", "digest"),
  statement: field("open", "statement"),
  evidence: link("node", "evidence", "StoreEvidenceItem"),
});
const factFields = {
  id: field("iri", "recordIdentifier"),
  label: field("text", RDFS + "label"),
  claimType: field("text", "claimType"),
  source: field("value", PROV + "wasAttributedTo"),
  digest: field("text", "digest", true),
  compactProofDigest: field("text", "compactProofDigest", true),
  subject: field("value", "subject", true),
  method: field("value", "method", true),
  asOf: instant("asOf", true),
  identifiers: field("strings", "identifiers", true),
  admittedPurpose: field("iri", "admittedPurpose", true),
  supersededBy: field("iri", "supersededBy", true),
  disputedWith: field("strings", "disputedWith", true),
  admittingDelivery: field("open", "admittingDelivery", true),
  original: link("node", "original", "OriginalStatement", true),
  statement: field("open", "statement", true),
};
storeModel("MemoryItem", {
  ...factFields,
  digest: field("text", "digest"),
  kind: enumeration("itemKind", "item-kind", [
    "statement",
    "memory",
    "message",
    "reading",
    "content",
  ]),
  accepted: field("boolean", "accepted", true),
  admissionOrder: field("integer", "admissionOrder", true),
});
storeModel("PrecedenceHold", factFields, "MemoryItem");

storeModel("MemoryScope", {});
storeModel("ItemTerms", {
  minimumGroup: field("integer", "minimumGroup", true),
  deleteWithinDays: field("value", "deleteWithinDays", true),
  recipientMustBe: field("open", "recipientMustBe", true),
});
storeModel("InheritedItemTerms", { target: field("iri", "protectedObject") });
storeModel("RelianceHold", {
  task: field("value", "memoryTask"),
  statement: field("open", "statement"),
  digest: field("text", "digest"),
  reason: field("text", "relianceReason"),
});
storeModel("KnownIdentifiers", { value: field("strings", "identifiers") });
storeModel("StatementRefusal", { value: field("text", "refusedStatement") });
storeModel("RelianceBinding", { value: field("text", "relianceBinding") });
storeModel("DescriptionAddress", { value: field("iri", "descriptionAddress") });

type PolicyReader = (id: string) => NativePolicy;
type PolicyWriter = (policy: NativePolicy) => string;
export const writePolicy = (dataset: Store): PolicyWriter => {
  const ids = new Map<string, string>();
  return (policy) => {
    // Policy graphs retain native field order. Cache exact JSON within this entry.
    const key = JSON.stringify(policy);
    const cached = ids.get(key);
    if (cached !== undefined) return cached;
    const graph = policyDataset(policy, "memory");
    for (const quad of graph) dataset.addQuad(quad);
    const id = graph.getGraphs(null, null, null)[0]!.value;
    ids.set(key, id);
    return id;
  };
};
export const readPolicy = (dataset: Store): PolicyReader => {
  const cached = new Map<string, NativePolicy>();
  return (id) => {
    if (!cached.has(id)) cached.set(id, policyFromStore(dataset, id));
    return cached.get(id)!;
  };
};

function named(node: StoreNode, term: string): string | undefined {
  const value = node.term(term);
  if (value === undefined) return undefined;
  if (value.termType !== "NamedNode") throw new TypeError("Expected a named memory link");
  return value.value;
}

function ownedTermsId(node: StoreNode): string | undefined {
  const id = named(node, termsLink);
  if (id !== undefined && id !== scopedId(node.id, "terms"))
    throw new TypeError("Invalid scoped item terms");
  return id;
}

class InheritedTermsBudget {
  private remaining = MAX_INHERITED_REFERENCES;

  consume(count: number): void {
    this.remaining -= count;
    if (this.remaining < 0)
      throw new TypeError("Inherited item terms exceed the expanded reference limit");
  }
}

function readTerms(
  id: string,
  local: Store,
  policy: PolicyReader,
  budget: InheritedTermsBudget,
  depth = 1,
): ItemTerms {
  checkTermsDepth(depth);
  const node = new StoreNode<Omit<ItemTerms, "policy" | "inherited">>(id, local, "ItemTerms");
  const policyId = named(node, policyLink);
  if (!policyId) throw new TypeError("Missing item-terms policy");
  const fields = { ...node.read(), policy: policy(policyId) as ItemTerms["policy"] };
  const list = named(node, inheritedLink);
  if (list === undefined) return fields;
  if (list !== scopedId(id, inheritedLink)) throw new TypeError("Invalid inherited item terms");
  const values = new NamedValuesNode(list, local);
  if (values.isObject || !values.types.has(SCHEMA + "ItemList"))
    throw new TypeError("Invalid inherited item terms");
  // Read reference IRIs directly. Generic value decoding would recurse into
  // arbitrary named-value subgraphs before checking that the list holds IDs.
  budget.consume(
    local.countQuads(namedNode(list), namedNode(SCHEMA + "itemListElement"), null, null),
  );
  return {
    ...fields,
    inherited: values.entries.map((entry, index) => {
      const value = entry.domainValue;
      if (value.termType !== "NamedNode" || value.value !== scopedId(id, "inherited:" + index))
        throw new TypeError("Invalid scoped inherited item reference");
      const ref = new StoreNode<{ target: string }>(value, local, "InheritedItemTerms");
      const termsId = ownedTermsId(ref);
      return {
        ...ref.read(),
        terms: termsId === undefined ? null : readTerms(termsId, local, policy, budget, depth + 1),
      };
    }),
  };
}

function checkTermsDepth(depth: number): void {
  if (depth > MAX_TERMS_DEPTH)
    throw new TypeError(`Inherited item terms exceed the maximum depth of ${MAX_TERMS_DEPTH}`);
}

function writeTerms(
  id: string,
  local: Store,
  terms: ItemTerms,
  write: PolicyWriter,
  budget: InheritedTermsBudget,
  depth = 1,
): void {
  checkTermsDepth(depth);
  const { policy, inherited, ...fields } = terms;
  const node = makeNode("ItemTerms", fields, id, local) as StoreNode;
  node.put(policyLink, namedNode(write(policy)));
  if (inherited !== undefined) {
    budget.consume(inherited.length);
    node.putValue(
      inheritedLink,
      inherited.map(({ target, terms }, index) => {
        const child = scopedId(id, "inherited:" + index);
        const reference = makeNode("InheritedItemTerms", { target }, child, local) as StoreNode;
        if (terms) {
          const termsId = scopedId(child, "terms");
          reference.put(termsLink, namedNode(termsId));
          writeTerms(termsId, local, terms, write, budget, depth + 1);
        }
        return child;
      }) as Json,
    );
  }
}

export function writeMemoryFact(
  value: AdmittedFact,
  name: "MemoryItem" | "PrecedenceHold",
  id: string,
  local: Store,
  policy: PolicyWriter,
): void {
  const { terms, dataUseGrant, ...fields } = value;
  const node = makeNode(name, fields, id, local) as StoreNode;
  if (terms) {
    const termsId = scopedId(id, "terms");
    node.put(termsLink, namedNode(termsId));
    writeTerms(termsId, local, terms, policy, new InheritedTermsBudget());
  }
  if (dataUseGrant) {
    const grantId = policy(dataUseGrant);
    node.put(grantLink, namedNode(grantId));
    node.add(policyLink, grantId);
  }
}

export function readMemoryFact<T extends AdmittedFact>(
  node: StoreNode<T>,
  policy: PolicyReader,
): T {
  const terms = ownedTermsId(node);
  const grant = named(node, grantLink);
  return {
    ...node.read(),
    ...(terms && { terms: readTerms(terms, node.dataset, policy, new InheritedTermsBudget()) }),
    ...(grant && { dataUseGrant: policy(grant) }),
  } as T;
}
