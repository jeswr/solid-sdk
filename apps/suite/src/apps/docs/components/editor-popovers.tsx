// AUTHORED-BY Codex
"use client";
import { Button, Input, Popover, PopoverAnchor, PopoverContent, toast } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { useId, useState } from "react";
import { validLink, wordCount } from "../lib/editor/logic";
export function LinkPopover({ editor, close }: { editor: Editor; close: () => void }) {
  const [url, setUrl] = useState(String(editor.getAttributes("link").href ?? ""));
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const id = useId();
  const empty = editor.state.selection.empty;
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <span className="docs-popover-anchor" />
      </PopoverAnchor>
      <PopoverContent
        aria-label="Insert link"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        <form
          className="docs-form"
          onSubmit={(event) => {
            event.preventDefault();
            const href = validLink(url);
            if (!href) {
              setError(true);
              return;
            }
            if (empty && text)
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "text",
                  text,
                  marks: [{ type: "link", attrs: { href, rel: "noopener noreferrer" } }],
                })
                .run();
            else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
            close();
          }}
        >
          <label htmlFor={`${id}-url`}>Link address</label>
          <Input
            id={`${id}-url`}
            type="url"
            autoFocus
            value={url}
            aria-invalid={error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(false);
            }}
            placeholder="https://example.org"
          />
          {error && (
            <p id={`${id}-error`} role="alert">
              Enter an http, https or mailto link.
            </p>
          )}
          {empty && (
            <>
              <label htmlFor={`${id}-text`}>Text to display</label>
              <Input
                id={`${id}-text`}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </>
          )}
          <Button type="submit">Apply link</Button>
          {validLink(url) && (
            <Button variant="outline" onClick={() => setConfirm(true)}>
              Open link
            </Button>
          )}
          {confirm && validLink(url) && (
            <div className="docs-form">
              <p>Open {new URL(url).hostname || "your mail app"}?</p>
              <Button asChild>
                <a href={validLink(url) as string} target="_blank" rel="noopener noreferrer">
                  Open link in new tab
                </a>
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          )}
          {editor.isActive("link") && (
            <Button
              variant="ghost"
              onClick={() => {
                editor.chain().focus().unsetLink().run();
                close();
              }}
            >
              Remove link
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  );
}
export function CountPopover({
  editor,
  close,
  pinned,
  setPinned,
}: {
  editor: Editor;
  close: () => void;
  pinned: boolean;
  setPinned: (value: boolean) => void;
}) {
  let stats: ReturnType<typeof wordCount>;
  try {
    stats = wordCount(editor.getJSON());
  } catch {
    toast.error("This document is too large to count.");
    return null;
  }
  return (
    <Popover open onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <span className="docs-popover-anchor" />
      </PopoverAnchor>
      <PopoverContent aria-label="Word count">
        <h2>Word count</h2>
        <dl className="docs-statistics">
          <dt>Words</dt>
          <dd>{stats.words}</dd>
          <dt>Characters</dt>
          <dd>{stats.characters}</dd>
          <dt>Without spaces</dt>
          <dd>{stats.charactersWithoutSpaces}</dd>
          <dt>Reading time</dt>
          <dd>{Math.ceil(stats.readingTimeMinutes)} min</dd>
        </dl>
        <label className="docs-checkbox">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => setPinned(event.target.checked)}
          />
          Show while typing
        </label>
      </PopoverContent>
    </Popover>
  );
}
