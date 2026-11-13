// AUTHORED-BY Codex GPT-6
import type { Term } from "@jeswr/fetch-rdf";
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { objectTerms } from "@jeswr/rdf-serialize/wrapper";
import { CredentialNode } from "@jeswr/solid-vc";
import { TermAs } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { digestBytes } from "../core/canonical.js";
import { DEFAULT_LIMITS } from "../core/limits.js";
import type { EvidenceItem, JsonObject } from "../core/types.js";
import { AWP } from "../profile/vocabulary.js";
import { inspectEvidenceEnvelope, inspectEvidenceJws } from "../wire/evidence-jws.js";
import { type PublicKeyRecord, verifyCompact } from "../wire/jws-compact.js";
import { CoreNode, type ModelSpec, makeNode, registerModel } from "./core-node.js";
import { NamedValuesNode, scopedId } from "./named-values.js";
import { RdfNode } from "./nodes.js";

const VC = "https://www.w3.org/2018/credentials#";
const SEC = "https://w3id.org/security#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const roles = [
  "representation",
  "approval",
  "credential",
  "grant",
  "membership",
  "authorisation",
] as const;
export const evidenceItemSpec: ModelSpec = {
  type: AWP + "EvidenceItem",
  fields: {
    role: { term: AWP + "role", kind: "enum", prefix: AWP + "evidence-role/", values: roles },
    format: { term: AWP + "format", kind: "text" },
    value: { term: VC + "verifiableCredential", kind: "node", model: "EmbeddedCredential" },
  },
};

export class EmbeddedCredentialNode extends RdfNode {
  get credential(): CredentialNode {
    return new CredentialNode(TermAs.term(this), this.dataset, DataFactory);
  }
  get originalJws(): string {
    const envelope = this.text(AWP + "envelopeBytes");
    if (envelope !== undefined) return envelope;
    const graph = this.one(SEC + "proof");
    if (!graph || graph.termType !== "NamedNode")
      throw new TypeError("Missing original proof graph");
    const proofs = this.dataset.getQuads(null, DataFactory.namedNode(AWP + "jws"), null, graph);
    if (
      proofs.length !== 1 ||
      proofs[0]?.object.termType !== "Literal" ||
      proofs[0].object.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
    )
      throw new TypeError("Ambiguous original JWS proof");
    if (
      !this.dataset.countQuads(
        proofs[0].subject,
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(AWP + "CompactJwsProof"),
        graph,
      )
    )
      throw new TypeError("Wrong embedded proof type");
    return proofs[0].object.value;
  }
  static fromJws(jws: string, id: string, dataset: Store): EmbeddedCredentialNode {
    const { payload } = inspectEvidenceJws(jws);
    const node = new EmbeddedCredentialNode(id, dataset);
    node.types.add(VC + "VerifiableCredential");
    const issuer = payload.issuer ?? payload.party;
    if (typeof issuer !== "string" || !isSafeAbsoluteIri(issuer))
      throw new TypeError("JWS statement does not identify its issuer");
    node.setIri(VC + "issuer", issuer);
    for (const [field, term] of [
      ["validFrom", VC + "validFrom"],
      ["validUntil", VC + "validUntil"],
      ["issuedAt", "http://www.w3.org/ns/prov#generatedAtTime"],
    ] as const) {
      const value = payload[field];
      if (typeof value === "string") {
        dataset.addQuad(
          node as never,
          DataFactory.namedNode(term),
          DataFactory.literal(
            value,
            DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#dateTime"),
          ),
        );
      }
    }
    const subject = new EmbeddedSubjectNode(scopedId(id, "subject"), dataset);
    subject.types.add(AWP + "LegacyCredentialSubject");
    subject.payload = NamedValuesNode.from(payload, scopedId(id, "payload"), dataset);
    node.setNode(VC + "credentialSubject", subject);
    const graph = DataFactory.namedNode(scopedId(id, "proof"));
    const proof = DataFactory.namedNode(scopedId(id, "proof-statement"));
    node.setIri(SEC + "proof", graph.value);
    dataset.addQuad(
      DataFactory.quad(
        proof,
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(AWP + "CompactJwsProof"),
        graph,
      ),
    );
    dataset.addQuad(
      DataFactory.quad(proof, DataFactory.namedNode(AWP + "jws"), DataFactory.literal(jws), graph),
    );
    return node;
  }
  static fromEvidence(
    value: string,
    format: string,
    id: string,
    dataset: Store,
  ): EmbeddedCredentialNode {
    if (!value.startsWith("{") && !value.startsWith("["))
      return EmbeddedCredentialNode.fromJws(value, id, dataset);
    const envelope = inspectEvidenceEnvelope(value, format);
    const node = new EmbeddedCredentialNode(id, dataset);
    node.types.add(VC + "VerifiablePresentation");
    node.setText(AWP + "envelopeBytes", value);
    node.setNode(
      AWP + "statementPayload",
      NamedValuesNode.from(envelope.payload, scopedId(id, "payload"), dataset),
    );
    for (const [index, jws] of envelope.credentials.entries()) {
      const credential = EmbeddedCredentialNode.fromJws(
        jws,
        scopedId(id, "credential:" + index),
        dataset,
      );
      dataset.addQuad(
        node as never,
        DataFactory.namedNode(VC + "verifiableCredential"),
        credential as never,
      );
    }
    return node;
  }
  get credentials(): readonly EmbeddedCredentialNode[] {
    return [...objectTerms(this, VC + "verifiableCredential")].map(
      (term) => new EmbeddedCredentialNode(TermAs.term(term), this.dataset),
    );
  }
  get payload(): JsonObject {
    const subject = this.child(VC + "credentialSubject", EmbeddedSubjectNode);
    if (!subject) throw new TypeError("Missing embedded subject");
    return subject.payload.toObject();
  }
  /** Verify the original bytes, then require exactly their deterministic RDF projection. */
  async verifyOriginal(options: {
    typ: string;
    resolve: (kid: string) => PublicKeyRecord | undefined;
  }): Promise<boolean> {
    try {
      const jws = this.originalJws;
      const result = await verifyCompact(jws, {
        ...options,
        allowedAlgs: ["EdDSA", "ES256"],
        limits: DEFAULT_LIMITS,
      });
      if (result.outcome !== "valid") return false;
      const expected = EmbeddedCredentialNode.fromJws(jws, this.id, new Store());
      // Exact term equality includes the proof graph; no unsigned projection field can drift.
      const actual = credentialClosure(this);
      return (
        actual.size === expected.dataset.size &&
        [...expected.dataset].every((quad) => actual.has(quad))
      );
    } catch {
      return false;
    }
  }
}
class EmbeddedSubjectNode extends RdfNode {
  get payload(): NamedValuesNode {
    return this.child(AWP + "statementPayload", NamedValuesNode) ?? missing();
  }
  set payload(value: NamedValuesNode) {
    this.setNode(AWP + "statementPayload", value);
  }
}
function credentialClosure(node: EmbeddedCredentialNode): Store {
  const output = new Store();
  const pending: Term[] = [TermAs.term(node)];
  const seen = new Set<string>();
  while (pending.length) {
    const term = pending.pop()!;
    if (seen.has(term.value)) continue;
    seen.add(term.value);
    for (const quad of node.dataset.getQuads(term as never, null, null, null)) {
      output.addQuad(quad);
      if (quad.predicate.value === SEC + "proof")
        for (const proofQuad of node.dataset.getQuads(null, null, null, quad.object as never))
          output.addQuad(proofQuad);
      else if (
        quad.object.termType === "NamedNode" &&
        node.dataset.countQuads(quad.object, null, null, null)
      )
        pending.push(quad.object);
    }
  }
  return output;
}
export class EvidenceItemNode extends CoreNode<EvidenceItem> {
  readonly modelName = "EvidenceItem";
  get role(): EvidenceItem["role"] {
    return this.getField("role") as EvidenceItem["role"];
  }
  set role(value: EvidenceItem["role"]) {
    this.setField("role", value);
  }
  get format(): string {
    return this.getField("format") as string;
  }
  set format(value: string) {
    this.setField("format", value);
  }
  get credential(): EmbeddedCredentialNode | undefined {
    return this.child(VC + "verifiableCredential", EmbeddedCredentialNode);
  }
  get credentialDigest(): string | undefined {
    return this.text(AWP + "credentialDigest");
  }
  get statement(): string {
    return this.credential?.originalJws ?? missing();
  }
  set statement(value: string) {
    this.setNode(
      VC + "verifiableCredential",
      EmbeddedCredentialNode.fromEvidence(
        value,
        this.format,
        scopedId(this.id, "credential"),
        this.dataset,
      ),
    );
  }
  override setField(name: string, value: unknown): void {
    if (name === "value") {
      this.statement = value as string;
      return;
    }
    super.setField(name, value);
  }
  override getField(name: string): unknown {
    return name === "value" ? this.statement : super.getField(name);
  }
  override toObject(): EvidenceItem {
    return { role: this.role, format: this.format, value: this.statement };
  }
  static toNode(object: EvidenceItem, id?: string, dataset?: Store): EvidenceItemNode {
    return makeNode("EvidenceItem", object, id, dataset) as EvidenceItemNode;
  }
  static fromNode(
    node: EvidenceItemNode,
    resolve?: (digest: string) => string | undefined,
  ): EvidenceItem {
    if (node.credential) return node.toObject();
    return {
      role: node.role,
      format: node.format,
      value: node.resolvePrior(resolve ?? (() => undefined)),
    };
  }
  static byDigest(
    object: { role: EvidenceItem["role"]; format: string; digest: string },
    id: string,
    dataset = new Store(),
  ): EvidenceItemNode {
    if (!/^sha-256:[a-f0-9]{64}$/.test(object.digest))
      throw new TypeError("Invalid credential digest");
    const node = new EvidenceItemNode(id, dataset);
    node.types.add(AWP + "EvidenceItem");
    node.role = object.role;
    node.format = object.format;
    node.setText(AWP + "credentialDigest", object.digest);
    return node;
  }
  resolvePrior(resolve: (digest: string) => string | undefined): string {
    const digest = this.credentialDigest;
    if (!digest || this.credential) throw new TypeError("Expected exclusive credential reference");
    const jws = resolve(digest);
    if (!jws || digestBytes(jws) !== digest)
      throw new TypeError("Prior credential missing or digest mismatch");
    return jws;
  }
}
registerModel("EvidenceItem", evidenceItemSpec, EvidenceItemNode);
export const toNode = EvidenceItemNode.toNode;
export const fromNode = EvidenceItemNode.fromNode;
function missing(): never {
  throw new TypeError("Missing embedded credential value");
}
