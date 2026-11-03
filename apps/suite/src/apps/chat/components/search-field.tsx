// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export function ChatSearchField({ query = "", page = false }: { query?: string; page?: boolean }) {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(query);
  useEffect(() => setValue(query), [query]);
  useEffect(() => {
    if (page) input.current?.focus();
  }, [page]);
  return (
    <search aria-label={page ? "Message search" : "Search conversations"}>
      <form
        className="chat-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(`/chat/search?q=${encodeURIComponent(value.trim())}`);
        }}
      >
        <Label htmlFor={id}>Search messages</Label>
        <div className="chat-search-controls">
          <Input
            ref={input}
            id={id}
            type="search"
            value={value}
            data-chat-search={page ? "page" : "sidebar"}
            aria-describedby={page ? `${id}-hint` : undefined}
            onChange={(event) => setValue(event.target.value)}
          />
          {page && <Button type="submit">Search</Button>}
        </div>
        {page && (
          <p id={`${id}-hint`} className="chat-hint">
            from:name in:room on:YYYY-MM-DD has:link
          </p>
        )}
      </form>
    </search>
  );
}
