// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * RDF instantiation of runtime evidence (OPTIONAL serialisation; the abstract model and the
 * runtime never require RDF).
 *
 * Maps evidence-ledger entries and implementation descriptions to triples using the terms
 * declared in `docs/vocab.ttl` plus reused PROV-O, ODRL 2.2, DCTERMS, schema.org and
 * DPV 2.1 terms. Every field that is mapped becomes a triple; fields without a reviewed
 * mapping are OMITTED and counted in `unmappedFields` — no record is wrapped as a JSON
 * literal. The output contains no blank nodes: sub-nodes get IRIs derived from the entry
 * hash, so two conversions of the same ledger are identical.
 *
 * Identifiers are emitted EXACTLY as recorded — the wire, ledger and RDF views share one
 * identity. A recorded identifier that is not a valid IRI (e.g. `<actor-with-fragment>#x`
 * minted before profile 0.1.1) is never rewritten: the triples that would use it are omitted
 * and the identifier is listed in `invalidIdentifiers` (a record whose own id is invalid is
 * reduced to its entry skeleton).
 */
import { DataFactory, type Quad, Store, type Term } from "n3";
import { derivedUrn, isIri } from "../core/canonical.js";
import { AWP, DCT, DPV, ODRL, PROV, SCHEMA } from "../profile/vocabulary.js";
import type { LedgerEntry } from "../records.js";
import { TERM_DEFINITIONS } from "../vocab.js";
import { RdfResource } from "./resource.js";

const { namedNode, literal } = DataFactory;

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";

/** Prefixes used when writing Turtle / compacting JSON-LD. */
export const PREFIXES: Readonly<Record<string, string>> = {
  agent: AWP,
  agentc: `${AWP}conclusion/`,
  agenta: `${AWP}authorisation/`,
  agentv: `${AWP}verification/`,
  agents: `${AWP}assessment/`,
  agentm: `${AWP}method/`,
  agentb: `${AWP}basis/`,
  agentk: `${AWP}kind/`,
  agentg: `${AWP}grant/`,
  prov: PROV,
  odrl: ODRL,
  dct: DCT,
  dpv: DPV,
  schema: SCHEMA,
  rdf: RDF,
  rdfs: RDFS,
  xsd: XSD,
};

/** ODRL 2.2 actions the pilot subset uses; anything else is not mapped to an ODRL IRI. */
const ODRL_ACTIONS = new Set(["use", "read", "distribute", "compensate", "transfer"]);

export interface ConversionReport {
  readonly entries: number;
  readonly mapped: Record<string, number>;
  /** Record types with no detailed mapping: only the entry skeleton + recordType is emitted. */
  readonly skeletonOnly: Record<string, number>;
  /** `type.field` names present in records but not represented as triples. */
  readonly unmappedFields: Record<string, number>;
  /** Recorded identifiers that are not valid IRIs; their triples were omitted, not rewritten. */
  readonly invalidIdentifiers: readonly string[];
}

class Builder {
  private readonly store = new Store();
  get quads(): Quad[] {
    return this.store.getQuads(null, null, null, null);
  }
  readonly invalid = new Set<string>();
  readonly unmapped: Record<string, number> = {};

  /** The identifier as a node, or undefined (and reported) if it is not a valid IRI. */
  iri(value: string): Term | undefined {
    if (!isIri(value)) {
      this.invalid.add(value);
      return undefined;
    }
    return namedNode(value);
  }

  add(s: Term | undefined, p: string, o: Term | undefined): void {
    if (s && o) new RdfResource(s, this.store, DataFactory).addTerm(p, o);
  }
  type(s: Term | undefined, cls: string): void {
    this.add(s, `${RDF}type`, namedNode(cls));
  }
  ref(s: Term | undefined, p: string, v: unknown): void {
    if (typeof v === "string" && v) this.add(s, p, this.iri(v));
  }
  str(s: Term | undefined, p: string, v: unknown): void {
    if (typeof v === "string") this.add(s, p, literal(v));
  }
  time(s: Term | undefined, p: string, v: unknown): void {
    if (typeof v === "string" && !Number.isNaN(Date.parse(v)))
      this.add(s, p, literal(new Date(v).toISOString(), namedNode(`${XSD}dateTime`)));
  }
  concept(s: Term | undefined, p: string, base: string, v: unknown): void {
    if (
      typeof v === "string" &&
      /^[a-z][a-z-]*$/.test(v) &&
      Object.hasOwn(TERM_DEFINITIONS, `${base}${v}`.slice(AWP.length))
    ) {
      this.add(s, p, namedNode(`${base}${v}`));
    }
  }
  /** Mark the record fields that were not represented. */
  rest(type: string, record: Record<string, unknown>, used: readonly string[]): void {
    for (const k of Object.keys(record))
      if (k !== "type" && !used.includes(k))
        this.unmapped[`${type}.${k}`] = (this.unmapped[`${type}.${k}`] ?? 0) + 1;
  }
}

function hex(hash: string): string {
  return hash.replace(/^sha-256:/, "");
}

type Rec = Record<string, unknown>;

/** Convert the entries of one agent's evidence ledger. `ledger` names the ledger (an IRI). */
export function ledgerToRdf(
  entries: readonly LedgerEntry[],
  ledger: string,
): { quads: Quad[]; report: ConversionReport } {
  const b = new Builder();
  const mapped: Record<string, number> = {};
  const skeleton: Record<string, number> = {};
  const L = b.iri(ledger);
  b.type(L, `${AWP}EvidenceLedger`);
  for (const e of entries) {
    const r = e.record as Rec & { type: string };
    const entry = namedNode(`urn:agent:ledger-entry:${hex(e.hash)}`);
    const node = namedNode(`urn:agent:record:${hex(e.hash)}`);
    b.type(entry, `${AWP}LedgerEntry`);
    b.add(entry, `${AWP}inLedger`, L);
    b.add(entry, `${AWP}sequence`, literal(String(e.seq), namedNode(`${XSD}integer`)));
    b.str(entry, `${AWP}entryHash`, e.hash);
    b.str(entry, `${AWP}previousHash`, e.prev);
    b.time(entry, `${PROV}generatedAtTime`, e.at);
    const handled = mapRecord(b, r, node);
    if (handled) {
      b.add(entry, `${AWP}recordsStatement`, handled.subject);
      b.rest(r.type, r, handled.used);
      mapped[r.type] = (mapped[r.type] ?? 0) + 1;
    } else {
      b.str(entry, `${AWP}recordType`, r.type);
      b.ref(entry, `${AWP}conversation`, r.conversation);
      if (typeof r.reason === "string" && /^[a-z-]+$/.test(r.reason))
        b.str(entry, `${AWP}reasonCode`, r.reason);
      skeleton[r.type] = (skeleton[r.type] ?? 0) + 1;
    }
  }
  return {
    quads: b.quads,
    report: {
      entries: entries.length,
      mapped,
      skeletonOnly: skeleton,
      unmappedFields: b.unmapped,
      invalidIdentifiers: [...b.invalid].sort(),
    },
  };
}

function mapRecord(
  b: Builder,
  r: Rec & { type: string },
  node: Term,
): { subject: Term; used: string[] } | undefined {
  switch (r.type) {
    case "verification": {
      b.type(node, `${AWP}VerificationResult`);
      b.str(node, `${AWP}protectedObjectDigest`, r.protectedObject);
      b.str(node, `${AWP}mechanism`, r.mechanism);
      b.str(node, `${AWP}verificationMaterial`, r.verificationMaterial);
      b.ref(node, `${AWP}attributedKeyHolder`, r.attributedTo);
      b.ref(node, `${PROV}wasAttributedTo`, r.verifier);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      b.concept(node, `${AWP}verificationOutcome`, `${AWP}verification/`, r.outcome);
      for (const l of (r.limitations as string[] | undefined) ?? [])
        b.str(node, `${AWP}limitation`, l);
      // `property` is fixed by the class definition (integrity and key attribution only).
      return {
        subject: node,
        used: [
          "protectedObject",
          "mechanism",
          "verificationMaterial",
          "attributedTo",
          "verifier",
          "at",
          "outcome",
          "limitations",
          "property",
        ],
      };
    }
    case "representation-assessment": {
      b.type(node, `${AWP}RepresentationAssessment`);
      b.ref(node, `${PROV}wasAttributedTo`, r.evaluator);
      b.ref(node, `${AWP}evaluatedActor`, r.actor);
      b.ref(node, `${AWP}representedParty`, r.party);
      b.ref(node, `${AWP}operation`, r.operation);
      b.ref(node, `${AWP}statement`, r.statement);
      b.concept(node, `${AWP}assessmentOutcome`, `${AWP}assessment/`, r.outcome);
      b.str(node, `${AWP}reasonCode`, r.reason);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return {
        subject: node,
        used: ["evaluator", "actor", "party", "operation", "statement", "outcome", "reason", "at"],
      };
    }
    case "source-authority": {
      b.type(node, `${AWP}SourceAuthorityAssessment`);
      b.ref(node, `${PROV}wasAttributedTo`, r.evaluator);
      b.ref(node, `${AWP}source`, r.source);
      b.str(node, `${AWP}claimType`, r.claimType);
      b.ref(node, `${AWP}claimSubject`, r.subject);
      const rule = r.rule as { id?: string; version?: string } | undefined;
      b.ref(node, `${AWP}sourceRule`, rule?.id);
      b.str(node, `${AWP}sourceRuleVersion`, rule?.version);
      b.concept(node, `${AWP}assessmentOutcome`, `${AWP}assessment/`, r.outcome);
      b.str(node, `${RDFS}comment`, r.reason);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return {
        subject: node,
        used: ["evaluator", "source", "claimType", "subject", "rule", "outcome", "reason", "at"],
      };
    }
    case "authorisation-decision": {
      b.type(node, `${AWP}AuthorisationDecision`);
      b.ref(node, `${PROV}wasAttributedTo`, r.decider);
      b.str(node, `${AWP}actionDigest`, r.actionDigest);
      const a = r.action as Rec | undefined;
      if (a) {
        const intent = namedNode(`${(node as { value: string }).value}#intent`);
        b.add(node, `${AWP}action`, intent);
        b.type(intent, `${AWP}ActionIntent`);
        if (typeof a.action === "string" && ODRL_ACTIONS.has(a.action))
          b.add(intent, `${AWP}requestedAction`, namedNode(`${ODRL}${a.action}`));
        b.ref(intent, `${AWP}target`, a.target);
        b.ref(intent, `${AWP}operation`, a.operation);
        b.ref(intent, `${DPV}hasPurpose`, a.purpose);
        b.str(intent, `${AWP}binding`, a.binding);
        b.str(intent, `${AWP}recipientHash`, a.recipientHash);
        b.str(intent, `${AWP}operationVersion`, a.operationVersion);
        b.str(intent, `${AWP}termsDigest`, a.termsDigest);
        const amount = a.amount as { value?: number; currency?: string } | undefined;
        if (
          typeof amount?.value === "number" &&
          Number.isFinite(amount.value) &&
          amount.value >= 0
        ) {
          const amountNode = namedNode(derivedUrn("amount", intent.value));
          b.add(intent, `${AWP}amount`, amountNode);
          b.add(
            amountNode,
            `${SCHEMA}value`,
            literal(String(amount.value), namedNode(`${XSD}double`)),
          );
          b.str(amountNode, `${SCHEMA}currency`, amount.currency);
        }
        b.ref(intent, `${AWP}conversation`, a.conversation);
        const params = (a.parameters ?? {}) as Rec;
        for (const k of Object.keys(params)) {
          b.unmapped[`authorisation-decision.action.parameters.${k}`] =
            (b.unmapped[`authorisation-decision.action.parameters.${k}`] ?? 0) + 1;
        }
      }
      const policy = r.policy as { id?: string; digest?: string; evaluator?: string } | undefined;
      b.ref(node, `${AWP}evaluatedPolicy`, policy?.id);
      b.str(node, `${AWP}policyDigest`, policy?.digest);
      b.str(node, `${AWP}evaluatorImplementation`, policy?.evaluator);
      b.concept(node, `${AWP}authorisationOutcome`, `${AWP}authorisation/`, r.outcome);
      b.concept(node, `${AWP}decisionBasis`, `${AWP}basis/`, r.basis);
      b.ref(node, `${AWP}approval`, r.approval);
      b.ref(node, `${AWP}matchedRule`, r.matchedRule);
      b.str(node, `${RDFS}comment`, r.reason);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return {
        subject: node,
        used: [
          "decider",
          "actionDigest",
          "action",
          "policy",
          "outcome",
          "basis",
          "approval",
          "matchedRule",
          "reason",
          "at",
        ],
      };
    }
    case "grant": {
      const g = b.iri(String(r.id));
      if (!g) return undefined;
      b.type(g, r.kind === "owner-mandate" ? `${AWP}OwnerMandate` : `${AWP}Grant`);
      b.concept(g, `${AWP}grantKind`, `${AWP}grant/`, r.kind);
      b.ref(g, `${PROV}wasAttributedTo`, r.grantor);
      b.ref(g, `${AWP}grantee`, r.grantee);
      b.str(g, `${AWP}digest`, r.digest);
      b.time(g, `${AWP}validUntil`, r.validUntil);
      b.ref(g, `${PROV}wasDerivedFrom`, r.derivedFrom);
      return {
        subject: g,
        used: ["id", "kind", "grantor", "grantee", "digest", "validUntil", "derivedFrom", "at"],
      };
    }
    case "agreement": {
      const g = b.iri(String(r.id));
      if (!g) return undefined;
      b.type(g, `${AWP}AgreementRecord`);
      b.ref(g, `${AWP}conversation`, r.conversation);
      const op = r.operation as { id?: string; version?: string } | undefined;
      b.ref(g, `${AWP}operation`, op?.id);
      b.str(g, `${AWP}operationVersion`, op?.version);
      b.ref(g, `${AWP}offer`, r.offer);
      b.ref(g, `${AWP}acceptance`, r.acceptance);
      b.str(g, `${AWP}termsDigest`, r.termsDigest);
      b.ref(g, `${AWP}offeror`, (r.offeror as Rec | undefined)?.actor);
      b.ref(g, `${AWP}acceptor`, (r.acceptor as Rec | undefined)?.actor);
      b.time(g, `${DCT}created`, r.formedAt);
      const used = [
        "id",
        "conversation",
        "operation",
        "offer",
        "acceptance",
        "termsDigest",
        "offeror",
        "acceptor",
        "formedAt",
      ];
      const slot = ((r.selection as Rec | undefined)?.slot ?? undefined) as
        | { start?: string; end?: string }
        | undefined;
      if (slot?.start && slot.end) {
        const ev = namedNode(derivedUrn("event", g.value));
        b.add(g, `${AWP}agreedEvent`, ev);
        b.type(ev, `${SCHEMA}Event`);
        b.time(ev, `${SCHEMA}startDate`, slot.start);
        b.time(ev, `${SCHEMA}endDate`, slot.end);
        b.str(ev, `${SCHEMA}name`, (r.terms as Rec | undefined)?.title);
        used.push("selection");
      }
      // The full terms are identified by termsDigest; their content is not re-expressed here.
      return { subject: g, used };
    }
    case "activity": {
      const act = b.iri(String(r.id));
      if (!act) return undefined;
      b.type(act, `${PROV}Activity`);
      b.ref(act, `${AWP}activityType`, r.activityType);
      b.ref(act, `${AWP}basis`, r.basis);
      b.str(act, `${AWP}effectKey`, r.effectKey);
      b.ref(act, `${PROV}wasAssociatedWith`, r.actor);
      b.time(act, `${PROV}startedAtTime`, r.startedAt);
      b.time(act, `${PROV}endedAtTime`, r.endedAt);
      if (typeof r.actor === "string" && typeof r.onBehalfOf === "string") {
        // The recording agent's OWN activity on behalf of its own party (from its mandate),
        // expressed as a PROV delegation scoped to this activity.
        const actor = b.iri(r.actor);
        const del = namedNode(derivedUrn("delegation", act.value));
        b.add(actor, `${PROV}actedOnBehalfOf`, b.iri(r.onBehalfOf));
        b.add(actor, `${PROV}qualifiedDelegation`, del);
        b.type(del, `${PROV}Delegation`);
        b.ref(del, `${PROV}agent`, r.onBehalfOf);
        b.add(del, `${PROV}hadActivity`, act);
      }
      // `status` is the planning status at write time; conclusions are separate records.
      return {
        subject: act,
        used: [
          "id",
          "activityType",
          "basis",
          "effectKey",
          "actor",
          "onBehalfOf",
          "startedAt",
          "endedAt",
          "status",
        ],
      };
    }
    case "outcome": {
      b.type(node, `${AWP}OutcomeRecord`);
      b.ref(node, `${AWP}concerns`, r.activity);
      b.concept(node, `${AWP}conclusion`, `${AWP}conclusion/`, r.conclusion);
      b.concept(node, `${AWP}method`, `${AWP}method/`, r.method);
      b.str(node, `${RDFS}comment`, r.reason);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return { subject: node, used: ["activity", "conclusion", "method", "reason", "at"] };
    }
    case "reconciliation": {
      // A reconciliation finding is an outcome observation by the reconciliation method.
      b.type(node, `${AWP}OutcomeRecord`);
      b.ref(node, `${AWP}concerns`, r.activity);
      b.concept(node, `${AWP}conclusion`, `${AWP}conclusion/`, r.finding);
      b.add(node, `${AWP}method`, namedNode(`${AWP}method/reconciliation`));
      b.str(node, `${AWP}effectKey`, r.effectKey);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return { subject: node, used: ["activity", "finding", "effectKey", "at"] };
    }
    case "peer-outcome-report": {
      b.type(node, `${AWP}PeerOutcomeReport`);
      b.ref(node, `${PROV}wasAttributedTo`, r.reporter);
      b.ref(node, `${AWP}concerns`, r.activity);
      b.ref(node, `${AWP}conversation`, r.conversation);
      b.concept(node, `${AWP}conclusion`, `${AWP}conclusion/`, r.conclusion);
      if (typeof r.final === "boolean")
        b.add(node, `${AWP}finalReport`, literal(String(r.final), namedNode(`${XSD}boolean`)));
      b.str(node, `${RDFS}comment`, r.note);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return {
        subject: node,
        used: ["reporter", "activity", "conversation", "conclusion", "final", "note", "at"],
      };
    }
    case "message-in":
    case "message-out": {
      b.type(node, `${AWP}MessageRecord`);
      b.str(node, `${AWP}direction`, r.type === "message-in" ? "in" : "out");
      b.ref(node, `${AWP}message`, r.id);
      b.concept(node, `${AWP}messageKind`, `${AWP}kind/`, r.kind);
      b.ref(node, `${AWP}conversation`, r.conversation);
      b.str(node, `${AWP}digest`, r.digest);
      b.ref(node, `${AWP}claimedSender`, r.from);
      b.ref(node, `${AWP}claimedOnBehalfOf`, r.onBehalfOfClaim);
      b.str(node, `${AWP}binding`, r.binding);
      b.time(node, `${PROV}generatedAtTime`, r.at);
      return {
        subject: node,
        used: ["id", "kind", "conversation", "digest", "from", "onBehalfOfClaim", "binding", "at"],
      };
    }
    default:
      return undefined;
  }
}

/** Convert an implementation description (as returned by `AgentRuntime.description()`). */
export function descriptionToRdf(description: Rec, id: string): Quad[] {
  const b = new Builder();
  const d = b.iri(id);
  b.type(d, `${AWP}ImplementationDescription`);
  b.ref(d, `${AWP}describes`, description.describes);
  b.ref(d, `${AWP}claimedParty`, description.onBehalfOf);
  b.ref(d, `${AWP}operator`, description.operator);
  b.ref(d, `${DCT}conformsTo`, (description.profile as Rec | undefined)?.id);
  const conf = (description.configurations ?? {}) as {
    implemented?: string[];
    accepted?: string[];
  };
  for (const c of conf.implemented ?? []) {
    b.add(d, `${AWP}implementsConfiguration`, b.iri(c));
    b.type(b.iri(c), `${AWP}Configuration`);
  }
  for (const c of conf.accepted ?? []) b.add(d, `${AWP}acceptsConfiguration`, b.iri(c));
  for (const op of (description.operations as Rec[] | undefined) ?? []) {
    const o = b.iri(op.id as string);
    b.add(d, `${AWP}supportsOperation`, o);
    b.type(o, `${AWP}Operation`);
    b.str(o, `${AWP}operationVersion`, op.version);
    b.str(o, `${RDFS}label`, op.label);
    b.str(o, `${AWP}interactionPattern`, op.pattern);
    b.str(o, `${AWP}accessMode`, op.access);
    for (const p of (op.purposes as string[] | undefined) ?? []) b.ref(o, `${DPV}hasPurpose`, p);
    for (const l of (op.limitations as string[] | undefined) ?? []) b.str(o, `${AWP}limitation`, l);
  }
  for (const bind of (description.bindings as Rec[] | undefined) ?? []) {
    b.str(d, `${AWP}binding`, bind.id);
    if (typeof bind.endpoint === "string") b.ref(d, `${AWP}bindingEndpoint`, bind.endpoint);
  }
  // The selected policy module: the shared policy PROFILE (semantics) and the EVALUATOR that
  // implements it here, kept as separate nodes (peers need not share the evaluator).
  const pm = description.policyModule as Rec | undefined;
  if (pm && typeof pm.policyProfile === "string") {
    const ev = (pm.evaluator ?? {}) as Rec;
    const m = b.iri(derivedUrn("policy-module", { description: id, evaluator: ev }));
    b.add(d, `${AWP}policyModule`, m);
    b.type(m, `${AWP}PolicyModule`);
    b.ref(m, `${AWP}policyProfile`, pm.policyProfile);
    b.type(b.iri(pm.policyProfile), `${AWP}PolicyProfile`);
    b.str(m, `${SCHEMA}name`, ev.name);
    b.str(m, `${SCHEMA}softwareVersion`, ev.version);
    b.str(m, `${AWP}moduleInterface`, ev.interface);
    b.str(m, `${AWP}moduleStatus`, pm.status);
  }
  b.str(d, `${RDFS}comment`, description.notice);
  return b.quads;
}
