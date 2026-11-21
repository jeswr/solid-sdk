// AUTHORED-BY Codex GPT-6.2 Sol
import { DataFactory, type Store } from "n3";
import type { TrustStoreData } from "../../mechanisms/trust.js";
import { AWP } from "../../profile/vocabulary.js";
import { makeNode } from "../core-node.js";
import { IndexedStore } from "../indexed-store.js";
import {
  assertSameGraph,
  enumeration,
  exact,
  field,
  graphContents,
  inGraph,
  link,
  RDF_TYPE,
  SEC,
  StoreNode,
  storeModel,
} from "./common.js";

const string = (term: string, optional = false) => field("text", term, optional);
const iri = (term: string, optional = false) => field("iri", term, optional);
const list = (term: string, optional = false) => field("strings", term, optional);
const keyFields = {
  kid: string("kid"),
  alg: string("alg"),
  publicJwk: link("node", "publicKey", "JsonWebKey"),
};

storeModel("JsonWebKey", {
  kty: string("kty"),
  crv: string("crv", true),
  x: string("x", true),
  y: string("y", true),
});
storeModel("PinnedKey", {
  role: enumeration("keyRole", "key-role", ["actor", "party", "issuer"]),
  subject: iri("keySubject"),
  party: iri("party", true),
  endpoints: list("endpoint", true),
  note: string("note", true),
  ...keyFields,
});
storeModel("SourceAuthorityRule", {
  id: iri("recordIdentifier"),
  version: string("version"),
  source: iri("source"),
  claimTypes: list("claimType"),
  subjects: field("value", "subjects"),
  validFrom: field("time", "effectiveFrom", true),
  validUntil: field("time", "effectiveUntil", true),
  framework: field("value", "framework", true),
});
storeModel("TrustRecordPublicKey", keyFields, "PinnedRecordKey");
storeModel("RecordKeyDelegation", {
  identity: iri("identity"),
  key: link("node", "recordPublicKey", "TrustRecordPublicKey"),
  delegation: exact("delegation", "delegationDigest"),
});
storeModel("TrustController", {
  identity: iri("identity"),
  controller: iri(SEC + "controller"),
});
storeModel("TrustStore", {
  version: field("integer", "storeVersion"),
  owner: iri("owner"),
  keys: link("nodes", "pinnedKey", "PinnedKey"),
  sourceAuthority: link("nodes", "sourceAuthorityRule", "SourceAuthorityRule"),
  controllers: link("nodes", "trustController", "TrustController", true),
  recordKeys: link("nodes", "recordKeyDelegation", "RecordKeyDelegation", true),
});

type Rule = TrustStoreData["sourceAuthority"][number];
type StoredRule = Omit<Rule, "subjects"> & { subjects: string | readonly string[] };
type Controller = { identity: string; controller: string };
type StoredTrust = Omit<TrustStoreData, "sourceAuthority" | "controllers"> & {
  sourceAuthority: StoredRule[];
  controllers?: Controller[];
};
const anySubject = AWP + "anySubject";

function graphName(owner: string): string {
  return "urn:awp:trust:" + encodeURIComponent(owner);
}

function trustDefaultGraph(data: TrustStoreData): IndexedStore {
  const store = new IndexedStore();
  const { sourceAuthority, controllers, ...rest } = data;
  const input: StoredTrust = {
    ...rest,
    sourceAuthority: sourceAuthority.map(({ subjects, ...rule }) => ({
      ...rule,
      subjects: subjects === "any" ? anySubject : subjects,
    })),
    ...(controllers !== undefined && {
      controllers: Object.entries(controllers).map(([identity, controller]) => ({
        identity,
        controller,
      })),
    }),
  };
  makeNode("TrustStore", input, graphName(data.owner), store);
  return store;
}

export function trustDataset(data: TrustStoreData): IndexedStore {
  return inGraph(trustDefaultGraph(data), graphName(data.owner));
}

export function trustTurtleGraph(data: TrustStoreData): IndexedStore {
  return trustDefaultGraph(data);
}

export function trustFromRdf(dataset: Store): TrustStoreData {
  const type = DataFactory.namedNode(AWP + "TrustStore");
  const subjects = dataset.getSubjects(DataFactory.namedNode(RDF_TYPE), type, null);
  if (subjects.length !== 1 || subjects[0]?.termType !== "NamedNode")
    throw new TypeError("Expected exactly one named trust store");
  const root = subjects[0].value;
  const graphs = dataset.getGraphs(subjects[0], DataFactory.namedNode(RDF_TYPE), type);
  if (graphs.length !== 1 || (graphs[0]?.termType !== "DefaultGraph" && graphs[0]?.value !== root))
    throw new TypeError("Invalid trust store graph");
  const named = graphs[0].termType === "NamedNode";
  const local = named ? graphContents(dataset, root) : dataset;
  const { sourceAuthority, controllers, ...rest } = new StoreNode<StoredTrust>(
    root,
    local,
    "TrustStore",
  ).read();
  if (rest.version !== 1 || graphName(rest.owner) !== root)
    throw new TypeError("Invalid trust store identity or version");
  const data: TrustStoreData = {
    ...rest,
    sourceAuthority: sourceAuthority.map(({ subjects, ...rule }) => {
      if (subjects === anySubject) return { ...rule, subjects: "any" };
      if (Array.isArray(subjects) && subjects.every((subject) => typeof subject === "string"))
        return { ...rule, subjects };
      throw new TypeError("Invalid source-authority subjects");
    }),
    ...(controllers !== undefined && {
      controllers: Object.fromEntries(
        controllers.map(({ identity, controller }) => [identity, controller]),
      ),
    }),
  };
  assertSameGraph(dataset, named ? trustDataset(data) : trustDefaultGraph(data));
  return data;
}

storeModel("OwnListEntry", {
  party: iri("party"),
  tasks: list("trustTasks"),
  block: field("boolean", "trustBlocked", true),
  note: string("note", true),
  expiresAt: field("time", "effectiveUntil", true),
});
storeModel("RegisterEntry", {
  id: iri("recordIdentifier"),
  party: iri("party"),
  authorizedFor: list("authorizedFor"),
  claimTypes: list("claimType", true),
  status: string("trustStatus"),
  expiresAt: field("time", "effectiveUntil", true),
});
storeModel("Register", {
  id: field("id", "recordIdentifier"),
  name: string("http://www.w3.org/2000/01/rdf-schema#label"),
  answersFor: string("answersFor"),
  entries: link("nodes", "registerEntry", "RegisterEntry"),
  answerTtlMs: field("integer", "answerTtlMs"),
});
storeModel("TrustRoot", {
  id: field("id", "recordIdentifier"),
  name: string("http://www.w3.org/2000/01/rdf-schema#label"),
  delegates: link("nodes", "trustRegister", "Register"),
});
