// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, LoadingSkeleton } from "@jeswr/suite-ui";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect } from "react";
import { encodeRef } from "@/lib/refs";
import { SearchError, type SearchSnippet } from "../lib/search";
import { useAsync, useChat } from "../state/chat-context";
import { ChatFailure, PersonName } from "./chat-app";
import { ChatSearchField } from "./search-field";

function Snippet({ snippet }: { snippet: SearchSnippet }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of snippet.ranges) {
    parts.push(snippet.text.slice(cursor, start));
    parts.push(<mark key={start}>{snippet.text.slice(start, end)}</mark>);
    cursor = end;
  }
  parts.push(snippet.text.slice(cursor));
  return <p className="chat-search-snippet">{parts}</p>;
}
export function ChatSearchPage({ query }: { query: string }) {
  const { client, setCurrentRoom } = useChat();
  const term = query.trim();
  const search = useAsync(
    useCallback(
      () =>
        term
          ? client.search(term, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
          : Promise.resolve(null),
      [client, term],
    ),
    false,
  );
  useEffect(() => setCurrentRoom(undefined), [setCurrentRoom]);
  const data = search.data;
  const queryError =
    search.error instanceof SearchError &&
    search.error.code !== "INVALID_MESSAGE" &&
    search.error.code !== "TOO_MANY_MESSAGES";
  const roomCount = new Set(data?.results.map(({ room }) => room.url)).size;
  return (
    <div className="chat-search-page">
      <h1>Search</h1>
      <ChatSearchField query={query} page />
      {!term ? (
        <p>Search messages across your joined rooms.</p>
      ) : search.status === "loading" ? (
        <LoadingSkeleton preset="list" label="Searching messages" />
      ) : search.status === "error" ? (
        queryError ? (
          <div role="alert">
            <h2>Check your search</h2>
            <p>Use the filter examples above and a valid date or time zone.</p>
          </div>
        ) : (
          <ChatFailure error={search.error} retry={search.retry} />
        )
      ) : (
        data && (
          <>
            <p role="status" aria-atomic="true">
              {data.results.length} {data.results.length === 1 ? "message" : "messages"} in{" "}
              {roomCount} {roomCount === 1 ? "room" : "rooms"}
              {data.truncated && ". Searched the last 30 days"}
            </p>
            {data.skipped.length > 0 && (
              <div className="chat-search-skipped">
                <p>
                  Couldn't search {data.skipped.length}{" "}
                  {data.skipped.length === 1 ? "room" : "rooms"}:{" "}
                  {data.skipped.map(({ name }) => name || "Untitled room").join(", ")}
                </p>
                <Button variant="outline" onClick={search.retry}>
                  Retry search
                </Button>
              </div>
            )}
            {!data.results.length ? (
              <p>No messages found. Try another word or filter.</p>
            ) : (
              <ul className="chat-search-results" aria-label="Search results">
                {data.results.map(({ room, message, snippet }) => (
                  <li key={message.id}>
                    <Link
                      className="chat-search-result"
                      href={`/chat/r/${encodeRef(room.url)}?message=${encodeRef(message.id)}`}
                    >
                      <strong>{room.name || "Untitled conversation"}</strong>
                      <span className="chat-search-meta">
                        <span>
                          <PersonName webId={message.author ?? ""} />
                        </span>
                        <time dateTime={message.published}>
                          {message.published
                            ? new Date(message.published).toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : "Unknown time"}
                        </time>
                      </span>
                      <Snippet snippet={snippet} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}
    </div>
  );
}
