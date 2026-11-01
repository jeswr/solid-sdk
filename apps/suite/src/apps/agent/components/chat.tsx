// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Badge } from "@jeswr/suite-ui";
import Link from "next/link";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { resourceSlug } from "../lib/paths";
import { readConversations, readTurns } from "../lib/readers";
import { DisabledAction, QueryRows, Screen } from "./states";
import { OfflineBanner, useDaemonStatus } from "./status-pill";
export function ChatScreen({ id }: { id?: string }) {
  const { client } = useAgentWorkspace();
  const status = useDaemonStatus();
  const conversations = useAgentQuery(client.paths.conversations, readConversations);
  const turns = useAgentQuery(
    id ? `${client.paths.conversations}${id}/` : client.paths.conversations,
    (c) => (id ? readTurns(c, id) : Promise.resolve([])),
  );
  return (
    <Screen title="Chat">
      <OfflineBanner status={status} />
      <div className="agent-chat">
        <aside aria-label="Conversations">
          <h2>Conversations</h2>
          <QueryRows query={conversations} empty="Say hello to your agent">
            {(rows) => (
              <ul className="agent-list">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link href={`/agent/chat/c/${encodeURIComponent(resourceSlug(row.id) ?? "")}`}>
                      {row.title}
                    </Link>
                    {row.unread && <Badge variant="secondary">Unread</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </QueryRows>
        </aside>
        <div>
          <h2>{id ? "Conversation" : "Your conversations"}</h2>
          <QueryRows query={turns} empty={id ? "Say hello to your agent" : "Choose a conversation"}>
            {(rows) => (
              <ol className="agent-list agent-turns">
                {rows.toReversed().map((turn) => (
                  <li key={turn.id} data-role={turn.role}>
                    <strong>{turn.role === "owner" ? "You" : "Agent"}</strong>
                    <p className="agent-plaintext">{turn.text}</p>
                    {[...new Set(turn.refersToProposal)].map((proposal) => {
                      const slug = resourceSlug(proposal);
                      return slug ? (
                        <Link
                          className="agent-proposal-link"
                          key={proposal}
                          href={`/agent/approvals/${encodeURIComponent(slug)}`}
                        >
                          Review proposal · {slug}
                        </Link>
                      ) : (
                        <span key={proposal}>{proposal}</span>
                      );
                    })}
                  </li>
                ))}
              </ol>
            )}
          </QueryRows>
          <div className="agent-composer">
            <label htmlFor="agent-message">Message your agent</label>
            <textarea
              id="agent-message"
              disabled
              placeholder="Message your agent"
              title="Coming soon"
            />
            <DisabledAction tip="Coming soon">Send</DisabledAction>
          </div>
        </div>
      </div>
    </Screen>
  );
}
