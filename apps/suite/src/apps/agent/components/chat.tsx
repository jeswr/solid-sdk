// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import type { Account, ActionProposal } from "@jeswr/agent-model";
import { Badge, Button, toast } from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { collection } from "../lib/collections";
import {
  appendOwnerTurn,
  isConversationUnread,
  newConversation,
  TURN_TEXT_LIMIT,
} from "../lib/conversation";
import { deviceState, readMarkerKey, saveDeviceState } from "../lib/device-state";
import { useAgentClock, useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { guardSlug, resourceSlug } from "../lib/paths";
import {
  DECIDABLE_STATES,
  PROPOSAL_STATE_LABELS,
  type ProposalCardState,
  proposalCardState,
} from "../lib/proposal-state";
import {
  loadedRecords,
  readAccounts,
  readApprovals,
  readConversations,
  readOutbox,
  readProposals,
  readTurns,
} from "../lib/readers";
import { createAgentSigner } from "../lib/sign";
import { createAgentVerifier } from "../lib/verify";
import { AgentControl } from "./agent-control";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { QueryRows, Screen } from "./states";
import { OfflineBanner, useDaemonStatus } from "./status-pill";

function ProposalCard({
  proposal,
  accounts,
  state,
  busy,
  decide,
  change,
}: {
  proposal: ActionProposal;
  accounts: Account[];
  state: ProposalCardState;
  busy: boolean;
  decide(decision: "approve" | "deny"): void;
  change(): void;
}) {
  const recipient = accounts.find((a) => a.channelHandleHash === proposal.intent.recipientHash);
  const forbidden = proposal.intent.parameters.prohibited === true;
  const slug = resourceSlug(proposal.id);
  return (
    <article className="agent-card agent-inline-proposal">
      <h3>{String(proposal.intent.parameters.summary ?? "Review this proposal")}</h3>
      <dl>
        <dt>To</dt>
        <dd>
          {recipient?.label ?? "Someone else"}{" "}
          <Badge variant="outline" title={proposal.intent.recipientHash}>
            {proposal.intent.recipientHash.slice(-8)}
          </Badge>
        </dd>
        <dt>Channel</dt>
        <dd>
          {proposal.intent.binding === "gmail" || proposal.intent.binding === "graph-mail"
            ? "Email"
            : "Messages"}
        </dd>
        <dt>Cost</dt>
        <dd>
          {proposal.intent.amount.value} {proposal.intent.amount.currency}
        </dd>
      </dl>
      <pre>{proposal.renderedPreview}</pre>
      {forbidden && <p>Your permissions never allow this</p>}
      <p role="status">{PROPOSAL_STATE_LABELS[state]}</p>
      <div className="agent-row">
        <Button
          disabled={busy || forbidden || !DECIDABLE_STATES.includes(state)}
          onClick={() => decide("approve")}
        >
          Approve
        </Button>
        <Button variant="outline" disabled={busy} onClick={change}>
          Change
        </Button>
        <Button
          variant="outline"
          disabled={busy || !DECIDABLE_STATES.includes(state)}
          onClick={() => decide("deny")}
        >
          Deny
        </Button>
      </div>
      {slug ? (
        <Link className="agent-proposal-link" href={`/agent/approvals/${encodeURIComponent(slug)}`}>
          Review proposal details
        </Link>
      ) : (
        <span>{proposal.id}</span>
      )}
    </article>
  );
}
export function ChatScreen({ id }: { id?: string }) {
  const { client, session } = useAgentWorkspace();
  const now = useAgentClock();
  const router = useRouter();
  const device = useApprovalDevice();
  const status = useDaemonStatus();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [commands, setCommands] = useState(false);
  const [stopRequest, setStopRequest] = useState(0);
  const [markers, setMarkers] = useState<Record<string, number>>({});
  const [deciding, setDeciding] = useState<string>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const conversations = useAgentQuery(client.paths.conversations, readConversations, 300);
  const turns = useAgentQuery(
    id ? `${client.paths.conversations}${id}/` : `${client.paths.conversations}#none`,
    (c) => (id ? readTurns(c, id) : Promise.resolve(collection<never>([]))),
    300,
  );
  const proposals = useAgentQuery(client.paths.proposals, readProposals, 300);
  const approvals = useAgentQuery(
    client.paths.approvals,
    (c) => readApprovals(c, createAgentVerifier(session)),
    300,
  );
  const outbox = useAgentQuery(client.paths.outbox, readOutbox, 300);
  const accounts = useAgentQuery(client.paths.accounts, readAccounts, 300);
  useEffect(() => {
    const about = new URLSearchParams(window.location.search).get("about");
    if (about) {
      try {
        setText(`Please help me reply to message ${guardSlug(about)}. `);
        composer.current?.focus();
      } catch {
        setError(true);
      }
    }
  }, []);
  useEffect(() => {
    if (conversations.status !== "ready") return;
    const next: Record<string, number> = {};
    for (const c of loadedRecords(conversations.data))
      next[c.id] = Number(deviceState(readMarkerKey(session.webId, c.id))) || 0;
    setMarkers(next);
  }, [conversations, session.webId]);
  useEffect(() => {
    if (!id || turns.status !== "ready") return;
    const url = client.paths.resolveSlug("conversations", id);
    const latest = loadedRecords(turns.data)[0];
    const mark = () => {
      if (document.visibilityState !== "visible" || !latest) return;
      const at = Date.parse(latest.createdAt);
      const key = readMarkerKey(session.webId, url);
      const value = Math.max(Number(deviceState(key)) || 0, at);
      saveDeviceState(key, String(value));
      setMarkers((current) => ({ ...current, [url]: value }));
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [turns, id, client, session.webId]);
  const create = async () => {
    setBusy(true);
    setError(false);
    try {
      const next = await newConversation(client);
      router.push(`/agent/chat/c/${next}`);
      setText("");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (busy || !text.trim()) return;
    if (text.trim() === "/stop") {
      setStopRequest((n) => n + 1);
      setText("");
      setCommands(false);
      return;
    }
    setBusy(true);
    setError(false);
    try {
      const target = id ?? (await newConversation(client));
      await appendOwnerTurn(client, target, session.webId, text);
      // Move focus before the cleared text disables Send, so keyboard users keep their place,
      // unless they have already moved on to something else during a slow save.
      const active = document.activeElement;
      if (!active || active === document.body || composer.current?.form?.contains(active))
        composer.current?.focus();
      setText("");
      setCommands(false);
      if (!id) router.push(`/agent/chat/c/${target}`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const decide = (proposal: ActionProposal, decision: "approve" | "deny") =>
    void device.requireKey(() => {
      setDeciding(proposal.id);
      void createAgentSigner(session, client)
        .signApproval(proposal, decision)
        .then(
          () => approvals.reload(),
          () => toast.error("Couldn't save your decision. Try again."),
        )
        .finally(() => setDeciding(undefined));
    });
  const latest = turns.status === "ready" ? loadedRecords(turns.data)[0] : undefined;
  return (
    <Screen title="Chat">
      <OfflineBanner status={status} />
      <div className="agent-chat">
        <aside aria-label="Conversations">
          <h2>Conversations</h2>
          <Button variant="outline" disabled={busy} onClick={() => void create()}>
            New conversation
          </Button>
          <QueryRows query={conversations} empty="Say hello to your agent">
            {(rows) => (
              <ul className="agent-list">
                {rows.map((row) => {
                  const slug = resourceSlug(row.id);
                  const title = row.updatedAt ? row.title : "New conversation";
                  return (
                    <li key={row.id}>
                      {slug ? (
                        <Link
                          href={`/agent/chat/c/${encodeURIComponent(slug)}`}
                          aria-current={slug === id ? "page" : undefined}
                        >
                          {title}
                        </Link>
                      ) : (
                        <span>{title}</span>
                      )}
                      {isConversationUnread(
                        { role: row.unread ? "agent" : "owner", createdAt: row.updatedAt },
                        markers[row.id] ?? 0,
                      ) && (
                        <span className="agent-unread" role="img" aria-label="Unread conversation">
                          ●
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </QueryRows>
        </aside>
        <div>
          <h2>{id ? "Conversation" : "Your conversations"}</h2>
          <QueryRows query={turns} empty="Say hello to your agent">
            {(rows) => (
              <ol className="agent-list agent-turns">
                {rows.toReversed().map((turn) => (
                  <li key={turn.id} data-role={turn.role}>
                    <strong>{turn.role === "owner" ? "You" : "Agent"}</strong>
                    <p className="agent-plaintext">{turn.text}</p>
                    {[...new Set(turn.refersToProposal)].map((ref) => {
                      const slug = resourceSlug(ref);
                      if (!slug) return <span key={ref}>{ref}</span>;
                      if (turn.role !== "agent")
                        return (
                          <Link key={ref} href={`/agent/approvals/${encodeURIComponent(slug)}`}>
                            Review proposal · {slug}
                          </Link>
                        );
                      const proposal =
                        proposals.status === "ready"
                          ? loadedRecords(proposals.data).find((p) => p.id === ref)
                          : undefined;
                      if (!proposal || approvals.status !== "ready" || outbox.status !== "ready")
                        return <p key={ref}>Proposal details are unavailable.</p>;
                      const state = proposalCardState(
                        proposal,
                        loadedRecords(approvals.data),
                        loadedRecords(outbox.data),
                        now,
                      );
                      return (
                        <ProposalCard
                          key={ref}
                          proposal={proposal}
                          accounts={accounts.status === "ready" ? loadedRecords(accounts.data) : []}
                          state={state}
                          busy={busy || deciding !== undefined}
                          decide={(decision) => decide(proposal, decision)}
                          change={() => {
                            setText("Change: ");
                            composer.current?.focus();
                          }}
                        />
                      );
                    })}
                  </li>
                ))}
              </ol>
            )}
          </QueryRows>
          {latest?.role === "owner" && status.state === "running" && (
            <p role="status" aria-label="Agent is typing" className="agent-typing">
              Agent is thinking<span aria-hidden="true">…</span>
            </p>
          )}
          <form
            className="agent-composer"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="agent-message">Message your agent</label>
            <textarea
              ref={composer}
              id="agent-message"
              value={text}
              // Read-only rather than disabled while saving: disabling the focused
              // control would drop focus to the page.
              readOnly={busy}
              aria-disabled={busy}
              maxLength={TURN_TEXT_LIMIT}
              aria-describedby={
                text.length >= TURN_TEXT_LIMIT - 1000 ? "agent-message-count" : undefined
              }
              onChange={(event) => {
                setText(event.target.value);
                setCommands(event.target.value.startsWith("/"));
              }}
              placeholder="Message your agent"
              onKeyDown={(event) => {
                if (event.key === "Escape") setCommands(false);
              }}
            />
            {text.length >= TURN_TEXT_LIMIT - 1000 && (
              <small id="agent-message-count" role="status">
                {text.length.toLocaleString()} / {TURN_TEXT_LIMIT.toLocaleString()} characters
              </small>
            )}
            {commands && (
              <section className="agent-command-menu" aria-label="Agent commands">
                <Button
                  type="button"
                  disabled={busy}
                  variant="ghost"
                  onClick={() => {
                    setText("/propose ");
                    setCommands(false);
                    composer.current?.focus();
                  }}
                >
                  /propose
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  variant="ghost"
                  onClick={() => {
                    setText("/remember ");
                    setCommands(false);
                    composer.current?.focus();
                  }}
                >
                  /remember
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  variant="ghost"
                  onClick={() => {
                    setText("");
                    setCommands(false);
                    setStopRequest((n) => n + 1);
                  }}
                >
                  /stop
                </Button>
              </section>
            )}
            {error && (
              <p role="alert">Couldn't save this message. Check your connection and try again.</p>
            )}
            <Button type="submit" disabled={!text.trim()} aria-disabled={busy}>
              {busy ? "Saving…" : "Send message"}
            </Button>
          </form>
          <div className="agent-command-control">
            <AgentControl stopped={false} request={stopRequest} />
          </div>
        </div>
      </div>
    </Screen>
  );
}
