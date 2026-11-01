// AUTHORED-BY Codex GPT-6.1-Sol

import { type Approval, readApprovalClaims } from "@jeswr/agent-mandate/approval";
import { type ControlStatementClaims, readControlClaims } from "@jeswr/agent-mandate/control";
import type { ConversationTurn, InboundMessage, PodRecord, RecordType } from "@jeswr/agent-model";
import { type AgentClient, AgentReadError, isLoaded, type Loaded, type Row } from "./client";
import {
  type Collection,
  collection,
  mapBounded,
  selectMembers,
  selectTrustMembers,
} from "./collections";
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
  category: "display" | "trust" | "turns" = "display",
  skip: string[] = [],
) {
  const all = (await client.list(container)).filter((m) => !m.container && !skip.includes(m.url));
  const selected =
    category === "trust"
      ? selectTrustMembers(all)
      : selectMembers(
          all,
          undefined,
          category === "turns"
            ? (a, b) => b.url.localeCompare(a.url, "en", { numeric: true })
            : undefined,
        );
  return collection(
    newest(
      await mapBounded(selected.members, (m) => attempt(m.url, () => client.read(m.url, type))),
    ),
    {
      ...selected,
      incompleteMessage: `Too many ${type === "transmission" ? "outbox" : "mandate"} records to check`,
    },
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
): Promise<Collection<DisplayApproval>> {
  const selected = selectTrustMembers(
    (await client.list(client.paths.approvals)).filter((m) => !m.container),
  );
  return collection(
    newest(
      await mapBounded(selected.members, (m) =>
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
    { ...selected, incompleteMessage: "Too many approval records to check" },
  );
}
export const readMandates = (client: AgentClient) =>
  records(client, client.paths.mandates, "mandate-reference", "trust", [
    client.paths.mandatesCurrent,
    client.paths.mandatesStatus,
  ]);
export async function readControl(
  client: AgentClient,
  verifier?: AgentVerifier,
): Promise<Collection<DisplayControl>> {
  const selected = selectTrustMembers(
    (await client.list(client.paths.control)).filter(
      (m) => !m.container && m.url !== client.paths.heartbeat,
    ),
  );
  return collection(
    newest(
      await mapBounded(selected.members, (m) =>
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
    { ...selected, incompleteMessage: "Too many control records to check" },
  );
}
export const readOutbox = (client: AgentClient) =>
  records(client, client.paths.outbox, "transmission", "trust");
export async function readMandateCurrent(client: AgentClient) {
  const row = await optional(() => client.read(client.paths.mandatesCurrent, "mandate-reference"));
  return collection(row ? [row] : []);
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
): Promise<Collection<InboxMessage>> {
  const root = `${client.paths.inbox}${guardSlug(binding)}/`;
  // Bound traversal as well as the final sample: at most MEMBER_LIMIT account listings, each
  // contributing at most MEMBER_LIMIT messages, so fan-out never scales with the pod's size.
  const accounts = selectMembers((await client.list(root)).filter((m) => m.container));
  const errors: Row<InboxMessage>[] = [];
  let truncated = accounts.truncated;
  let total = 0;
  // Finish the listing phase before reading messages: nested worker pools would multiply fanout.
  const groups = await mapBounded(accounts.members, async (member) => {
    try {
      const selected = selectMembers(
        (await client.list(member.url)).filter(
          (m) => !m.container && !m.url.endsWith(".triage.ttl"),
        ),
      );
      truncated ||= selected.truncated;
      total += selected.total;
      return selected.members;
    } catch (error) {
      errors.push({ url: member.url, error });
      return [];
    }
  });
  const messages = selectMembers(groups.flat());
  const rows = await mapBounded(messages.members, (m) =>
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
  );
  return collection(newest([...errors, ...rows]), {
    ...messages,
    total,
    truncated: truncated || messages.truncated,
    newest: false,
  });
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  unread: boolean;
}
export const readTurns = (client: AgentClient, conversationId: string) =>
  records(
    client,
    client.paths.resolveSlug("conversations", conversationId),
    "conversation-turn",
    "turns",
  );
export async function readConversations(client: AgentClient): Promise<Collection<Conversation>> {
  const containers = selectMembers(
    (await client.list(client.paths.conversations)).filter((m) => m.container),
  );
  const rows: Row<Conversation>[] = [];
  // Each turn collection uses the same six-worker helper. Walk conversations in
  // sequence so their nested pools never multiply the number of in-flight GETs.
  for (const m of containers.members) {
    rows.push(
      await attempt(m.url, async () => {
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
    );
  }
  return collection(newest(rows), containers);
}
export async function readAudit(
  client: AgentClient,
  options: { limit?: number; before?: number } = {},
) {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 0))
    throw new Error("Invalid audit limit");
  const selected = selectMembers(
    (await client.list(client.paths.audit))
      .filter((m) => !m.container && m.url !== client.paths.auditChain)
      .map((member) => {
        const slug = resourceSlug(member.url);
        const seq = slug && /^\d+$/.test(slug) ? Number(slug) : NaN;
        return { ...member, seq: Number.isSafeInteger(seq) ? seq : -1 };
      })
      .filter((m) => options.before === undefined || m.seq < options.before),
    options.limit,
    (a, b) => b.seq - a.seq || a.url.localeCompare(b.url),
  );
  const rows = await mapBounded(selected.members, (member) =>
    attempt(member.url, async () => {
      if (member.seq < 0) throw new Error("Invalid audit sequence");
      const loaded = await client.read(member.url, "audit-entry");
      if (loaded.record.seq !== member.seq) throw new Error("Audit sequence mismatch");
      return loaded;
    }),
  );
  return collection(rows, selected);
}
export const loadedRecords = <T>(rows: Row<T>[]) =>
  rows.filter(isLoaded<T>).map((row) => row.record);
export type { PodRecord };
