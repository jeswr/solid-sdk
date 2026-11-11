// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { type ConversationTurn, toRdf } from "@jeswr/agent-model";
import { serialize } from "@jeswr/rdf-serialize";
import { type AgentClient, ConflictError } from "./client";
import { guardSlug } from "./paths";

// agent-model's shared text schema is private (records.ts); keep its exact bound here.
export const TURN_TEXT_LIMIT = 16_384;

export function isConversationUnread(
  last: { role: string; createdAt: string } | undefined,
  lastRead: number,
): boolean {
  return last?.role === "agent" && Date.parse(last.createdAt) > lastRead;
}
export function nextTurnNumber(urls: readonly string[], conversation: string): number {
  let max = -1;
  for (const url of urls) {
    if (!url.startsWith(conversation)) throw new Error("Turn outside conversation");
    const match = /^(0|[1-9]\d*)\.ttl$/.exec(url.slice(conversation.length));
    if (!match) throw new Error("Unrecognised conversation record");
    const n = Number(match[1]);
    if (!Number.isSafeInteger(n) || n >= Number.MAX_SAFE_INTEGER)
      throw new Error("Turn number exceeds bound");
    max = Math.max(max, n);
  }
  return max + 1;
}
/** All writers reserve a numbered immutable resource; a conflict always re-lists. */
export async function appendOwnerTurn(
  client: AgentClient,
  id: string,
  owner: string,
  text: string,
  now = () => new Date(),
): Promise<ConversationTurn> {
  if (!text.trim() || text.length > TURN_TEXT_LIMIT)
    throw new Error("Write a message of at most 16,384 characters");
  const conversation = client.paths.resolveSlug("conversations", id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const members = await client.list(conversation);
    const n = nextTurnNumber(
      members.filter((m) => !m.container).map((m) => m.url),
      conversation,
    );
    const turn: ConversationTurn = {
      type: "conversation-turn",
      id: `${conversation}${n}.ttl`,
      conversation,
      attributedTo: owner,
      role: "owner",
      text,
      createdAt: now().toISOString(),
      refersToProposal: [],
    };
    const graph = toRdf(turn);
    const body = await serialize([...graph], { format: "text/turtle" });
    try {
      await client.create(turn.id, body);
      return turn;
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }
  }
  throw new Error("Conversation is busy. Try again.");
}
export async function newConversation(
  client: AgentClient,
  uuid = crypto.randomUUID(),
): Promise<string> {
  const id = guardSlug(uuid);
  try {
    await client.createContainer(client.paths.conversations);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
  }
  await client.createContainer(client.paths.resolveSlug("conversations", id));
  return id;
}
