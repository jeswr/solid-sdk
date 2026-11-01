// AUTHORED-BY Codex GPT-6.1-Sol
import type { ConversationTurn, InboundMessage, PodRecord, RecordType } from "@jeswr/agent-model";
import { type AgentClient, AgentReadError, isLoaded, type Loaded, type Row } from "./client";
import { AGENT, guardSlug, metadataNode, PROV, RDF, resourceSlug } from "./paths";

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
export const readApprovals = (client: AgentClient) =>
  records(client, client.paths.approvals, "approval");
export const readMandates = (client: AgentClient) =>
  records(client, client.paths.mandates, "mandate-reference", [
    client.paths.mandatesCurrent,
    client.paths.mandatesStatus,
  ]);
export const readControl = (client: AgentClient) =>
  records(client, client.paths.control, "control-statement", [client.paths.heartbeat]);
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
  const rows = await records(client, client.paths.audit, "audit-entry", [client.paths.auditChain]);
  return rows
    .filter(
      (row) => !isLoaded(row) || options.before === undefined || row.record.seq < options.before,
    )
    .slice(0, options.limit ?? rows.length);
}
export const loadedRecords = <T>(rows: Row<T>[]) =>
  rows.filter(isLoaded<T>).map((row) => row.record);
export type { PodRecord };
