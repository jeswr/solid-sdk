// AUTHORED-BY Codex GPT-6.1-Sol
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
import { useState } from "react";
import { useAgentQuery, useAgentWorkspace } from "../lib/hooks";
import { type InboxMessage, readAccounts, readInbox } from "../lib/readers";
import { QueryRows, Screen } from "./states";

function MessageDetail({ message }: { message: InboxMessage }) {
  return (
    <>
      <p>
        <Badge variant="outline">Unverified sender</Badge>
      </p>
      <p className="agent-plaintext">{message.text}</p>
      {message.structuredPart.map((part, index) => {
        const fields =
          part !== null && typeof part === "object" && !Array.isArray(part)
            ? part
            : { value: part };
        return (
          <article className="agent-card" key={index.toString()}>
            <h3>{String(fields.type ?? fields["@type"] ?? "Structured data")}</h3>
            <dl>
              {Object.entries(fields).map(([name, value]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                </div>
              ))}
            </dl>
            <ProvenanceBadge source="Read from the message by the agent" />
          </article>
        );
      })}
    </>
  );
}
export function InboxScreen({ binding }: { binding?: string }) {
  const { client } = useAgentWorkspace();
  const [selected, setSelected] = useState<InboxMessage>();
  const accounts = useAgentQuery(client.paths.accounts, readAccounts);
  const messages = useAgentQuery(
    binding ? `${client.paths.inbox}${binding}/` : client.paths.inbox,
    (c) => (binding ? readInbox(c, binding) : Promise.resolve([])),
  );
  return (
    <Screen title="Inbox">
      <QueryRows query={accounts} empty="No readable accounts yet">
        {(rows) => {
          const bindings = [
            ...new Set(rows.filter((row) => row.restrictions.read).map((row) => row.provider)),
          ];
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
                  {value}
                </Link>
              ))}
            </nav>
          ) : (
            <p>No accounts have Read enabled.</p>
          );
        }}
      </QueryRows>
      <QueryRows query={messages} empty={binding ? "No messages yet" : "Choose an inbox"}>
        {(rows) => (
          <ul className="agent-list">
            {rows.map((message) => (
              <li className="agent-card" key={message.id}>
                <Button variant="ghost" onClick={() => setSelected(message)}>
                  {message.subject ?? "Message"}
                </Button>
                <p>{message.text.slice(0, 120)}</p>
                <div className="agent-row">
                  <Badge variant="outline">Unverified sender</Badge>
                  {message.structuredPart.length > 0 && (
                    <Badge variant="secondary">Structured envelope</Badge>
                  )}
                  {message.triage && <Badge variant="secondary">{message.triage.primary}</Badge>}
                  {message.triageError ? <span>Assessment couldn't be read</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryRows>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <SheetContent side="bottom" className="agent-app agent-detail-sheet">
          <SheetTitle>{selected?.subject ?? "Message"}</SheetTitle>
          <SheetDescription>Plain text message and extracted structured data.</SheetDescription>
          {selected && <MessageDetail message={selected} />}
        </SheetContent>
      </Sheet>
    </Screen>
  );
}
