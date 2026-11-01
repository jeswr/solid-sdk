// AUTHORED-BY Codex GPT-6.1-Sol

import { type Approval, readApprovalClaims } from "@jeswr/agent-mandate/approval";
import { type ControlStatementClaims, readControlClaims } from "@jeswr/agent-mandate/control";
import type { ConversationTurn, InboundMessage, PodRecord, RecordType } from "@jeswr/agent-model";
import { type AgentClient, AgentReadError, isLoaded, type Loaded, type Row } from "./client";
import { AGENT, guardSlug, metadataNode, PROV, RDF, resourceSlug } from "./paths";
import type { AgentVerifier, Verification } from "./verify";

function timestamp(value: unknown): number {
  const record = value as Record<string, unknown>;
  for (const key of [
    "createdAt",
    "receivedAt",
    "startedAt",
    "at",
    "validFrom",
    "lastIngest",
    "updatedAt",
  ]) {
    if (typeof record[key] === "string") return Date.parse(record[key]);
  }
  return 0;
}
export function newest<T>(rows: Row<T>[]): Row<T>[] {
  return rows.sort(
    (a, b) =>
      (isLoaded(b) ? timestamp(b.record) : 0) - (isLoaded(a) ? timestamp(a.record) : 0) ||
      a.url.localeCompare(b.url),
  );
}
async function attempt<T>(url: string, load: () => Promise<Loaded<T>>): Promise<Row<T>> {
  try {
    return await load();
  } catch (error) {
    return { url, error };
  }
}
async function records<T extends RecordType>(
  client: AgentClient,
  container: string,
  type: T,
  skip: string[] = [],
) {
  const members = await client.list(container);
  return newest(
    await Promise.all(
      members
        .filter((m) => !m.container && !skip.includes(m.url))
        .map((m) => attempt(m.url, () => client.read(m.url, type))),
    ),
  );
}
async function optional<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof AgentReadError && error.status === 404) return undefined;
    throw error;
  }
}
export const readAccounts = (client: AgentClient) =>
  records(client, client.paths.accounts, "account");
export const readDescriptors = (client: AgentClient) =>
  records(client, client.paths.descriptors, "channel-capability");
export const readProposals = (client: AgentClient) =>
  records(client, client.paths.proposals, "action-proposal");
export type DisplayApproval = Approval & { createdAt: string; verification: Verification };
export type DisplayControl = ControlStatementClaims & { verification: Verification };
export async function readApprovals(
  client: AgentClient,
  verifier?: AgentVerifier,
): Promise<Row<DisplayApproval>[]> {
  return newest(
    await Promise.all(
      (await client.list(client.paths.approvals))
        .filter((m) => !m.container)
        .map((m) =>
          attempt(m.url, async () => {
            const doc = await client.graph(m.url);
            const claims = await readApprovalClaims(doc.text, m.url);
            if (!claims) throw new Error("Unreadable approval");
            // dct:created is part of the signed proof, not an agent-model approval field.
            const proofGraph = [...doc.dataset].find(
              (q) =>
                q.subject.value === m.url &&
                q.predicate.value === "https://w3id.org/security#proof" &&
                q.graph.termType === "DefaultGraph",
            )?.object;
            const proofDate = [...doc.dataset].find(
              (q) =>
                proofGraph !== undefined &&
                q.graph.equals(proofGraph) &&
                q.predicate.value === "http://purl.org/dc/terms/created" &&
                q.object.termType === "Literal",
            )?.object.value;
            const createdAt =
              proofDate ??
              metadataNode(doc.dataset, m.url).text("http://purl.org/dc/terms/created") ??
              "";
            const verification = verifier
              ? await verifier.verifyApproval(doc.text, claims)
              : "unchecked";
            return {
              url: m.url,
              etag: doc.etag,
              verified: verification,
              record: { ...claims, createdAt, verification },
            };
          }),
        ),
    ),
  );
}
export const readMandates = (client: AgentClient) =>
  records(client, client.paths.mandates, "mandate-reference", [
    client.paths.mandatesCurrent,
    client.paths.mandatesStatus,
  ]);
export async function readControl(
  client: AgentClient,
  verifier?: AgentVerifier,
): Promise<Row<DisplayControl>[]> {
  return newest(
    await Promise.all(
      (await client.list(client.paths.control))
        .filter((m) => !m.container && m.url !== client.paths.heartbeat)
        .map((m) =>
          attempt(m.url, async () => {
            const doc = await client.graph(m.url);
            const claims = await readControlClaims(doc.text, m.url);
            if (!claims) throw new Error("Unreadable control");
            const verification = verifier
              ? await verifier.verifyControl(doc.text, m.url)
              : "unchecked";
            return {
              url: m.url,
              etag: doc.etag,
              verified: verification,
              record: { ...claims, verification },
            };
          }),
        ),
    ),
  );
}
export const readOutbox = (client: AgentClient) =>
  records(client, client.paths.outbox, "transmission");
export async function readMandateCurrent(client: AgentClient) {
  const row = await optional(() => client.read(client.paths.mandatesCurrent, "mandate-reference"));
  return row ? [row] : [];
}
export interface Heartbeat {
  id: string;
  at: string;
}
export async function readHeartbeat(client: AgentClient): Promise<Row<Heartbeat>[]> {
  const doc = await optional(() => client.graph(client.paths.heartbeat));
  if (!doc) return [];
  const node = metadataNode(doc.dataset, client.paths.heartbeat);
  const at = node.text(`${PROV}generatedAtTime`);
  if (!node.iris(`${RDF}type`).has(`${AGENT}Heartbeat`) || !at || !Number.isFinite(Date.parse(at)))
    throw new Error("Invalid agent heartbeat");
  return [
    {
      url: client.paths.heartbeat,
      etag: doc.etag,
      record: { id: client.paths.heartbeat, at },
      verified: "unchecked",
    },
  ];
}
export interface Triage {
  primary: string | undefined;
  urgency: string | undefined;
  confidence: number | undefined;
}
export type InboxMessage = InboundMessage & { triage?: Triage | undefined; triageError?: unknown };
export async function readInbox(
  client: AgentClient,
  binding: string,
): Promise<Row<InboxMessage>[]> {
  const root = `${client.paths.inbox}${guardSlug(binding)}/`;
  const accounts = await client.list(root);
  const groups = await Promise.all(
    accounts.map(async (member) => {
      if (!member.container) return [];
      try {
        const messages = await client.list(member.url);
        return Promise.all(
          messages
            .filter((m) => !m.container && !m.url.endsWith(".triage.ttl"))
            .map((m) =>
              attempt<InboxMessage>(m.url, async () => {
                const loaded = await client.read(m.url, "inbound-message");
                let triage: Triage | undefined;
                let triageError: unknown;
                try {
                  const url = m.url.replace(/\.ttl$/, ".triage.ttl");
                  const doc = await optional(() => client.graph(url));
                  if (doc) {
                    const node = metadataNode(doc.dataset, url);
                    if (
                      !node.iris(`${RDF}type`).has(`${AGENT}TriageAssessment`) ||
                      node.iri(`${PROV}wasDerivedFrom`) !== m.url
                    )
                      throw new Error("Invalid triage assessment");
                    const confidence = node.text(`${AGENT}confidence`);
                    triage = {
                      primary: node.text(`${AGENT}primaryClass`),
                      urgency: node.text(`${AGENT}urgency`),
                      confidence: confidence === undefined ? undefined : Number(confidence),
                    };
                  }
                } catch (error) {
                  triageError = error;
                }
                return { ...loaded, record: { ...loaded.record, triage, triageError } };
              }),
            ),
        );
      } catch (error) {
        return [{ url: member.url, error }];
      }
    }),
  );
  return newest(groups.flat());
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  unread: boolean;
}
export const readTurns = (client: AgentClient, conversationId: string) =>
  records(client, client.paths.resolveSlug("conversations", conversationId), "conversation-turn");
export async function readConversations(client: AgentClient): Promise<Row<Conversation>[]> {
  const containers = (await client.list(client.paths.conversations)).filter((m) => m.container);
  return newest(
    await Promise.all(
      containers.map((m) =>
        attempt(m.url, async () => {
          const id = resourceSlug(m.url);
          if (!id) throw new Error("Invalid conversation identifier");
          const turns = await readTurns(client, id);
          const error = turns.find((t) => !isLoaded(t));
          if (error && !isLoaded(error)) throw error.error;
          const loaded = turns.filter(isLoaded<ConversationTurn>);
          const last = loaded[0]?.record;
          const first = loaded.at(-1)?.record;
          return {
            url: m.url,
            etag: null,
            verified: "unchecked",
            record: {
              id: m.url,
              title: first?.text ?? id,
              updatedAt: last?.createdAt ?? "",
              unread: last?.role === "agent",
            },
          };
        }),
      ),
    ),
  );
}
export async function readAudit(
  client: AgentClient,
  options: { limit?: number; before?: number } = {},
) {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0))
    throw new Error("Invalid audit limit");
  const members = (await client.list(client.paths.audit))
    .filter((m) => !m.container && m.url !== client.paths.auditChain)
    .map((member) => {
      const slug = resourceSlug(member.url);
      const seq = slug && /^\d+$/.test(slug) ? Number(slug) : NaN;
      return { ...member, seq: Number.isSafeInteger(seq) ? seq : -1 };
    })
    .filter((m) => options.before === undefined || m.seq < options.before)
    .sort((a, b) => b.seq - a.seq || a.url.localeCompare(b.url))
    .slice(0, options.limit);
  const rows: Row<Extract<PodRecord, { type: "audit-entry" }>>[] = [];
  const work = members.entries();
  await Promise.all(
    Array.from({ length: Math.min(6, members.length) }, async () => {
      for (const [index, member] of work) {
        rows[index] = await attempt(member.url, async () => {
          if (member.seq < 0) throw new Error("Invalid audit sequence");
          const loaded = await client.read(member.url, "audit-entry");
          if (loaded.record.seq !== member.seq) throw new Error("Audit sequence mismatch");
          return loaded;
        });
      }
    }),
  );
  return rows;
}
export const loadedRecords = <T>(rows: Row<T>[]) =>
  rows.filter(isLoaded<T>).map((row) => row.record);
export type { PodRecord };
