// AUTHORED-BY Codex GPT-6.1-Sol
// Retargeted mechanical walk from accountable-agent-runtime/src/trace/reader.ts.

import type { VcMandateOptions } from "@jeswr/agent-mandate";
import {
  createVcMandateVerifier,
  evaluateIntent,
  parseMandateCredential,
  verifyApproval,
} from "@jeswr/agent-mandate";
import { canonicalJson, digestOf } from "@jeswr/agent-model";
import { redactUserinfo } from "@jeswr/guarded-fetch";
import {
  type CredentialStatusCheck,
  createBitstringStatusResolver,
  createWebIdKeyResolver,
} from "@jeswr/solid-vc";
import { CHAIN_SCOPE, type LedgerCheck, verifyLedger } from "./ledger.js";
import { AGENT, assertSameGraph, entryGraph, headGraph, node, parseTurtle } from "./rdf.js";
import {
  type AuditRecord,
  digestSchema,
  entrySchema,
  instantSchema,
  type LedgerEntry,
} from "./records.js";
import {
  type AuditFetch,
  auditBase,
  documentUrl,
  readDocument,
  request,
  storageRoot,
} from "./transport.js";

export interface AuditHead {
  readonly seq: number;
  readonly hash: string;
  readonly etag: string | null;
}
export async function readHead(io: AuditFetch, base: string): Promise<AuditHead | undefined> {
  const url = new URL("chain.ttl", base).href;
  const res = await readDocument(io, url);
  if (!res) return undefined;
  const graph = await parseTurtle(res.body, url);
  const n = node(graph, url);
  const seqText = n.text(`${AGENT}seq`);
  const seq = Number(seqText);
  if (!/^[1-9]\d*$/.test(seqText) || !Number.isSafeInteger(seq) || seq > 200000)
    throw new Error("Audit range exceeds bound");
  const hash = digestSchema.parse(n.text(`${AGENT}ledgerHash`));
  assertSameGraph(graph, headGraph(url, seq, hash));
  return { seq, hash, etag: res.etag };
}
export interface LoadedTrace {
  readonly entries: readonly LedgerEntry[];
  readonly chain: LedgerCheck;
}
/** Fetch exactly the published prefix; don't follow arbitrary PROV links or list an unbounded container. */
export async function loadTrace(io: AuditFetch, root: string): Promise<LoadedTrace> {
  const base = auditBase(root);
  const head = await readHead(io, base);
  if (!head) throw new Error("missing-prov: no audit head");
  const entries: LedgerEntry[] = [];
  for (let seq = 1; seq <= head.seq; seq++) {
    const url = new URL(`${seq}.ttl`, base).href;
    const res = await readDocument(io, url);
    if (!res) throw new Error("missing-prov: audit entry absent");
    const graph = await parseTurtle(res.body, url);
    const n = node(graph, url);
    const entry = entrySchema.parse({
      seq,
      at: n.text("http://www.w3.org/ns/prov#startedAtTime"),
      prev: n.text(`${AGENT}prevHash`),
      hash: n.text(`${AGENT}ledgerHash`),
      record: JSON.parse(n.text(`${AGENT}record`)),
    });
    assertSameGraph(graph, entryGraph(url, entry));
    entries.push(entry);
  }
  const chain = verifyLedger(entries);
  if (!chain.ok || entries.at(-1)?.hash !== head.hash)
    throw new Error("chain-integrity: hash chain or head mismatch");
  return { entries, chain };
}
export interface AuditOptions {
  readonly fetch: AuditFetch;
  readonly root: string;
  readonly proposal: string;
  readonly at?: string;
  /** Optional independent owner pin; absent, the report identifies the cryptographically verified issuer. */
  readonly ownerWebId?: string;
  readonly webIdKeyResolver?: VcMandateOptions["webIdKeyResolver"];
  /** Must provide status evidence valid at the supplied instant. Unknown history fails closed. */
  readonly statusResolver?: (at: Date) => VcMandateOptions["resolveStatus"];
}
export interface AuditReport {
  readonly proposal: string;
  readonly ok: boolean;
  readonly chain?: LedgerCheck;
  readonly authorityChain: readonly string[];
  readonly breaches: readonly string[];
  readonly scope: string;
}
/** Cryptographic re-run, never trust the recorded permit or a parsed credential alone. */
export async function auditArtifact(options: AuditOptions): Promise<AuditReport> {
  const breaches: string[] = [];
  const authority: string[] = [];
  let chain: LedgerCheck | undefined;
  try {
    const root = storageRoot(options.root);
    documentUrl(root, options.proposal);
    if (options.at !== undefined) instantSchema.parse(options.at);
    const trace = await loadTrace(options.fetch, root);
    chain = trace.chain;
    const events = trace.entries.filter(
      (e): e is LedgerEntry & { record: AuditRecord } => e.record.type !== "ledger-checkpoint",
    );
    const proposals = events.filter(
      (e) => e.record.type === "proposal" && e.record.id === options.proposal,
    );
    if (proposals.length !== 1) throw new Error("missing-prov: expected one proposal");
    const proposal = proposals[0] as LedgerEntry & { record: AuditRecord };
    const p = proposal.record;
    if (!p.terms || p.termsDigest !== digestOf(p.terms))
      throw new Error("terms-mismatch: invalid proposal digest");
    if (options.ownerWebId !== undefined && options.ownerWebId !== p.owner)
      throw new Error("owner-mismatch");
    const transmissions = events.filter(
      (e) => e.record.type === "transmission" && e.record.proposal === p.id,
    );
    if (transmissions.length === 0) throw new Error("missing-prov: no transmission");
    const ids = new Set<string>();
    for (const e of events) {
      if (ids.has(e.record.id)) throw new Error("missing-prov: ambiguous event identity");
      ids.add(e.record.id);
    }
    // Zero-credential adapters for key/status documents too, including injected transports.
    const publicIo: AuditFetch = (input, init) =>
      request(options.fetch, String(input), {
        ...init,
        headers: { Accept: "text/turtle,application/trig,application/ld+json,application/json" },
      });
    const keys = options.webIdKeyResolver ?? createWebIdKeyResolver({ fetch: publicIo });
    for (const tx of transmissions) {
      const t = tx.record;
      const now = new Date(options.at ?? tx.at);
      const d = events.find(
        (e) => e.record.type === "decision" && e.record.id === t.decisionRecord,
      );
      if (
        !d ||
        !t.mandate ||
        d.seq <= proposal.seq ||
        d.seq >= tx.seq ||
        Date.parse(d.at) > Date.parse(tx.at) ||
        Date.parse(proposal.at) > Date.parse(d.at)
      ) {
        breaches.push("missing-prov");
        continue;
      }
      const sameTerms = [t, d.record].every(
        (r) =>
          r.proposal === p.id &&
          r.owner === p.owner &&
          r.agent === p.agent &&
          r.mandate === t.mandate &&
          r.termsDigest === p.termsDigest &&
          canonicalJson(r.terms ?? null) === canonicalJson(p.terms),
      );
      if (!sameTerms) {
        breaches.push("terms-mismatch");
        continue;
      }
      authority.push(
        `owner ${p.owner}`,
        `mandate ${t.mandate}`,
        `agent ${p.agent}`,
        `proposal ${p.id}`,
        `decision ${d.record.id}`,
      );
      const doc = await readDocument(
        options.fetch,
        documentUrl(root, t.mandate),
        "application/trig",
      );
      const vc = doc && (await parseMandateCredential(doc.body));
      const resolve = options.statusResolver
        ? options.statusResolver(now)
        : createBitstringStatusResolver({
            fetch: publicIo,
            resolveKey: keys.resolveKey.bind(keys),
            isControlledBy: keys.isControlledBy.bind(keys),
            now,
          });
      let status: CredentialStatusCheck | undefined;
      const mandate = await createVcMandateVerifier({
        read: async () => vc || undefined,
        ownerWebId: p.owner,
        agentWebId: p.agent,
        statusListCredential: new URL("agent/mandates/status.ttl", root).href,
        webIdKeyResolver: keys,
        resolveStatus: async (credential) => {
          // The mandate verifier checks the signed status location before dereferencing.
          status = await resolve(credential);
          return status || { status: "unreachable", reason: "Missing mandate status" };
        },
        now: () => now,
      }).load();
      if (!mandate || mandate.id !== t.mandate) {
        breaches.push(
          status && status.status === "revoked" ? "revoked-at-time" : "mandate-invalid",
        );
        continue;
      }
      const terms = p.terms;
      // isAnyOf is existential: verify each recipient separately to prevent a mixed set
      // containing one allowed recipient from laundering an unauthorized recipient.
      const evaluateRecipients = (recipientSet: string | readonly string[]) =>
        evaluateIntent(mandate, {
          agent: p.agent,
          action: terms.action,
          target: terms.target,
          at: now.toISOString(),
          attributes: {
            [`${AGENT}binding`]: terms.binding,
            [`${AGENT}recipientSet`]: recipientSet,
            ...(terms.purpose ? { purpose: terms.purpose } : {}),
          },
        });
      const wholeSet = await evaluateRecipients(terms.recipientHashes);
      const decisions = await Promise.all(terms.recipientHashes.map(evaluateRecipients));
      // Set-wide prohibitions (e.g. isAllOf) must also win. Scope still requires
      // each recipient to pass; scalar permissions need not match an entire set.
      if (wholeSet.decision === "prohibited") decisions.push(wholeSet);
      if (
        decisions.some(
          (decision) => decision.decision !== "permit" && decision.reason !== "owner-approval",
        )
      )
        breaches.push("out-of-scope");
      const combined =
        decisions.find((decision) => decision.decision === "prohibited") ??
        decisions.find((decision) => decision.decision !== "permit");
      if (d.record.decision !== (combined?.decision ?? "permit"))
        breaches.push("decision-divergence");
      if (mandate.limits.length > 0) breaches.push("accounting-unverified");
      // v1 requires fresh approval for every send, even for an autonomous policy match.
      if (!t.approval) {
        breaches.push("missing-approval");
        continue;
      }
      const seen = events.find(
        (e) =>
          e.record.type === "approval-seen" &&
          e.record.approval === t.approval &&
          e.record.proposal === p.id &&
          e.record.agent === p.agent &&
          e.record.owner === p.owner &&
          e.seq < tx.seq &&
          e.seq > proposal.seq &&
          Date.parse(e.at) <= Date.parse(tx.at),
      );
      if (!seen) {
        breaches.push("missing-approval");
        continue;
      }
      const approvalDoc = await readDocument(
        options.fetch,
        documentUrl(root, t.approval),
        "application/trig",
      );
      const approval =
        approvalDoc &&
        (await verifyApproval(approvalDoc.body, {
          id: t.approval,
          ownerWebId: p.owner,
          proposal: p.id,
          termsDigest: p.termsDigest as string,
          webIdKeyResolver: keys,
          now: () => now,
        }));
      if (!approval?.valid || approval.approval.decision !== "approve")
        breaches.push("forged-approval");
      if (transmissions.filter((e) => e.record.approval === t.approval).length !== 1)
        breaches.push("approval-reused");
      authority.push(`approval ${t.approval}`, `transmission ${t.id}`);
      const receipts = events.filter(
        (e) =>
          e.record.type === "receipt" &&
          e.record.transmission === t.id &&
          e.record.proposal === p.id &&
          e.record.owner === p.owner &&
          e.record.agent === p.agent &&
          e.seq > tx.seq &&
          Date.parse(e.at) >= Date.parse(tx.at),
      );
      if (t.status !== "sent" || receipts.length !== 1) breaches.push("missing-receipt");
      for (const r of receipts) authority.push(`receipt ${r.record.id}`);
    }
  } catch (error) {
    // Only known breach codes reach output. Never echo a server body, secret URL or parser input.
    const code = error instanceof Error ? error.message.split(":")[0] : "unwalkable";
    breaches.push(
      ["missing-prov", "chain-integrity", "terms-mismatch", "owner-mismatch"].includes(
        code as string,
      )
        ? (code as string)
        : "unwalkable",
    );
  }
  return {
    proposal: redactUserinfo(options.proposal),
    ok: breaches.length === 0,
    chain,
    authorityChain: [...new Set(authority)],
    breaches: [...new Set(breaches)],
    scope: CHAIN_SCOPE,
  };
}
