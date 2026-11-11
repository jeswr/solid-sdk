// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Badge,
  Button,
  ProvenanceBadge,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { collection, metadataOf } from "../lib/collections";
import { archiveKey, deviceState } from "../lib/device-state";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { archiveView, triageLabel } from "../lib/inbox";
import { resourceSlug } from "../lib/paths";
import {
  type InboxMessage,
  loadedRecords,
  readAccounts,
  readControl,
  readInbox,
} from "../lib/readers";
import { createAgentSigner } from "../lib/sign";
import { createAgentVerifier } from "../lib/verify";
import { useApprovalDevice } from "./approval-key-setup-sheet";
import { useMobileSheet } from "./responsive-sheet";
import { QueryRows, Screen } from "./states";

function MessageDetail({ message }: { message: InboxMessage }) {
  return (
    <>
      <p>
        <Badge variant="outline">Unverified sender</Badge>
      </p>
      <p className="agent-plaintext">{message.text}</p>
      {message.cards.map((part, index) => (
        <article className="agent-card" key={index.toString()}>
          <h3>{part.kind === "calendar" ? "Calendar event" : "Linked data"}</h3>
          <p>{part.title}</p>
          {part.kind === "calendar" ? (
            <dl>
              <dt>Time</dt>
              <dd>
                {part.start ? new Date(part.start).toLocaleString() : "Not recorded"}
                {part.end ? ` – ${new Date(part.end).toLocaleString()}` : ""}
              </dd>
              <dt>Location</dt>
              <dd>{part.location ?? "Not recorded"}</dd>
            </dl>
          ) : (
            <dl>
              <dt>Type</dt>
              <dd>{part.type}</dd>
              <dt>Name</dt>
              <dd>{part.title}</dd>
            </dl>
          )}
          <ProvenanceBadge
            source={part.model ? "Suggested by the model" : "Read from the message by the agent"}
          />
          {!part.model && <small>Deterministic extraction</small>}
        </article>
      ))}
    </>
  );
}
export function InboxScreen({ binding }: { binding?: string }) {
  const { client, session } = useAgentWorkspace();
  const mobile = useMobileSheet();
  const device = useApprovalDevice();
  const [selected, setSelected] = useState<InboxMessage>();
  const selectedSlug = selected && resourceSlug(selected.id);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [archiveError, setArchiveError] = useState(false);
  const openerId = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const accounts = useAgentQuery(client.paths.accounts, readAccounts);
  const readable =
    accounts.status === "ready"
      ? loadedRecords(accounts.data).filter((a) => a.restrictions.read === true)
      : [];
  const allowed = readable.some((a) => a.provider === binding);
  const allowedIds = new Set(
    readable.filter((a) => a.provider === binding).map((a) => resourceSlug(a.id)),
  );
  const messages = useAgentQuery(
    `${client.paths.inbox}${binding ?? ""}/${allowed ? "" : "#unreadable"}`,
    (c) => (allowed && binding ? readInbox(c, binding) : Promise.resolve(collection<never>([]))),
  );
  // Archive is a signed owner control, so it holds on every device and for the agent.
  const archived = useAgentQuery(client.paths.archive, (c) =>
    readControl(c, createAgentVerifier(session), client.paths.archive),
  );
  // Messages archived on this device before signed archiving stay hidden here.
  useEffect(() => {
    if (messages.status === "ready")
      setHidden(
        new Set(
          loadedRecords(messages.data)
            .filter((m) => deviceState(archiveKey(session.webId, m.id)) === "true")
            .map((m) => m.id),
        ),
      );
  }, [messages, session.webId]);
  const archiveState = archiveView(archived, session.webId, Date.now());
  const signedArchive = "targets" in archiveState ? archiveState.targets : new Set<string>();
  useEffect(() => {
    if (!allowed) setSelected(undefined);
  }, [allowed]);
  const archive = (message: InboxMessage) =>
    void device.requireKey(async () => {
      setArchiveError(false);
      try {
        await createAgentSigner(session, client).signControl("Archive", { target: message.id });
        setHidden((current) => new Set([...current, message.id]));
        setSelected(undefined);
      } catch {
        setArchiveError(true);
      }
    });
  const rowsQuery =
    // Until the archive is known, showing messages would briefly resurface archived ones.
    archiveState.status === "loading" && messages.status === "ready"
      ? ({ status: "loading", reload: messages.reload } as const)
      : messages.status === "ready"
        ? {
            ...messages,
            data: collection(
              messages.data.filter(
                (row) =>
                  !("record" in row) ||
                  (!hidden.has(row.record.id) &&
                    !signedArchive.has(row.record.id) &&
                    allowedIds.has(new URL(row.record.id).pathname.split("/").at(-2) ?? "")),
              ),
              metadataOf(messages.data),
            ),
          }
        : messages;
  return (
    <Screen title="Inbox">
      <QueryRows query={accounts} empty="No readable accounts yet">
        {() => {
          const bindings = [...new Set(readable.map((row) => row.provider))];
          return bindings.length ? (
            <nav aria-label="Message channels" className="agent-row">
              {bindings.map((value) => (
                <Link
                  key={value}
                  href={`/agent/inbox/${encodeURIComponent(value)}`}
                  aria-current={value === binding ? "page" : undefined}
                  className="agent-channel-link"
                  onClick={() => setSelected(undefined)}
                >
                  {value === "gmail" ? "Gmail" : value === "graph-mail" ? "Work mail" : "Messages"}
                </Link>
              ))}
            </nav>
          ) : (
            <p>No accounts have Read enabled.</p>
          );
        }}
      </QueryRows>
      {archiveError && <p role="status">Couldn't archive this message. Try again.</p>}
      {archiveState.status === "error" && (
        <p role="alert" className="agent-banner">
          Couldn't load your archived messages, so some may show here.{" "}
          <Button variant="outline" size="sm" onClick={archived.reload}>
            Retry
          </Button>
        </p>
      )}
      {archiveState.status === "partial" && (
        <p role="status" className="agent-banner">
          Some archived messages couldn't be checked, so they may show here.{" "}
          <Button variant="outline" size="sm" onClick={archived.reload}>
            Retry
          </Button>
        </p>
      )}
      <div ref={list}>
        <h2 ref={heading} tabIndex={-1}>
          Messages
        </h2>
        <QueryRows query={rowsQuery} empty={binding ? "No messages yet" : "Choose an inbox"}>
          {(rows) => (
            <ul className="agent-list">
              {rows.map((message) => {
                const sender =
                  readable.find((a) => a.channelHandleHash === message.channelHandleHash)?.label ??
                  "Unknown sender";
                return (
                  <li className="agent-card" key={message.id}>
                    <Button
                      variant="ghost"
                      data-agent-message-id={message.id}
                      onClick={() => {
                        openerId.current = message.id;
                        setSelected(message);
                      }}
                    >
                      {message.subject ?? "Message"}
                    </Button>
                    <p>{message.text.slice(0, 120)}</p>
                    <p>{sender}</p>
                    <div className="agent-row">
                      <Badge variant="outline">Unverified sender</Badge>
                      {message.cards.length > 0 && (
                        <Badge variant="secondary">Structured envelope</Badge>
                      )}
                      {message.triage && (
                        <Badge variant="secondary">{triageLabel(message.triage.primary)}</Badge>
                      )}
                      {message.triageError ? <span>Assessment couldn't be read</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryRows>
      </div>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <SheetContent
          side={mobile ? "bottom" : "right"}
          className="agent-app agent-detail-sheet"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = [
              ...(list.current?.querySelectorAll<HTMLButtonElement>("[data-agent-message-id]") ??
                []),
            ].find((button) => button.dataset.agentMessageId === openerId.current);
            (opener ?? heading.current)?.focus();
          }}
        >
          <SheetTitle>{selected?.subject ?? "Message"}</SheetTitle>
          <SheetDescription>Plain text message and extracted structured data.</SheetDescription>
          {selected && (
            <>
              <MessageDetail message={selected} />
              <div className="agent-row">
                {selectedSlug && (
                  <Link href={`/agent/chat?about=${encodeURIComponent(selectedSlug)}`}>
                    Ask the agent to reply
                  </Link>
                )}
                <Button variant="outline" onClick={() => archive(selected)}>
                  Archive
                </Button>
              </div>
              <p>Archive hides this message on all your devices. The message is kept.</p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Screen>
  );
}
