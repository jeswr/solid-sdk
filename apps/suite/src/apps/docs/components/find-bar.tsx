// AUTHORED-BY Codex
"use client";
import { Button, IconButton, Input, toast } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { type Ref, useEffect, useId, useState } from "react";
import { findKey } from "../editor/find-plugin";
import { focusDocument } from "../editor/focus";
import { findText, replaceAll, replaceOne } from "../lib/find";
export function FindBar({
  editor,
  revision,
  close,
  inputRef,
}: {
  editor: Editor;
  revision: number;
  close: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  // A fresh object also reveals the current result when navigation wraps to itself.
  const [active, setActive] = useState({ index: 0 });
  const id = useId();
  let matches: ReturnType<typeof findText> = [];
  try {
    matches = findText(editor.getJSON(), query, { caseSensitive: matchCase });
  } catch {
    /* Bounded searches can be empty. */
  }
  const selected = Math.min(active.index, Math.max(0, matches.length - 1));
  const match = matches[selected];
  const from = match?.from;
  const to = match?.to;
  // revision is the transaction event: the editor object itself stays stable.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision triggers a fresh search
  useEffect(() => {
    editor.view.dispatch(
      editor.state.tr.setMeta(findKey, { query, caseSensitive: matchCase, active: selected }),
    );
  }, [editor, query, matchCase, selected, revision]);
  // Only an explicit search or navigation may move the caret. Document edits
  // refresh matches/decorations above without redirecting subsequent typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: match positions alone must never select text
  useEffect(() => {
    if (from !== undefined && to !== undefined)
      editor.chain().setTextSelection({ from, to }).scrollIntoView().run();
  }, [editor, query, matchCase, active]);
  useEffect(
    () => () => {
      if (!editor.isDestroyed)
        editor.view.dispatch(
          editor.state.tr.setMeta(findKey, { query: "", caseSensitive: false, active: 0 }),
        );
    },
    [editor],
  );
  const navigate = (direction: number) => {
    const index = (selected + direction + matches.length) % matches.length;
    if (matches[index]) setActive({ index });
  };
  const replace = (all: boolean) => {
    if (!editor.isEditable || !matches.length) return;
    try {
      const result = all
        ? replaceAll(editor.getJSON(), query, replacement, { caseSensitive: matchCase })
        : replaceOne(editor.getJSON(), query, replacement, selected, { caseSensitive: matchCase });
      const tr = editor.state.tr;
      for (const match of [...result.changeSet.matches].reverse())
        tr.insertText(replacement, match.from, match.to);
      editor.view.dispatch(tr);
    } catch {
      toast.error("This replacement is too large. Try a smaller selection.");
    }
  };
  return (
    <section
      className="docs-find-bar"
      aria-label="Find and replace"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
          focusDocument(editor);
        }
      }}
    >
      <label htmlFor={`${id}-find`}>Find</label>
      <Input
        ref={inputRef}
        id={`${id}-find`}
        autoFocus
        value={query}
        maxLength={512}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive({ index: 0 });
        }}
      />
      <span role="status" className="docs-find-count">
        {matches.length ? `${selected + 1} of ${matches.length}` : "0 of 0"}
      </span>
      <IconButton label="Previous match" variant="ghost" onClick={() => navigate(-1)}>
        <ChevronUp aria-hidden="true" />
      </IconButton>
      <IconButton label="Next match" variant="ghost" onClick={() => navigate(1)}>
        <ChevronDown aria-hidden="true" />
      </IconButton>
      <label className="docs-checkbox">
        <input
          type="checkbox"
          checked={matchCase}
          onChange={(event) => setMatchCase(event.target.checked)}
        />
        Match case
      </label>
      {editor.isEditable && (
        <>
          <label htmlFor={`${id}-replace`}>Replace</label>
          <Input
            id={`${id}-replace`}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <Button variant="outline" onClick={() => replace(false)}>
            Replace
          </Button>
          <Button variant="outline" onClick={() => replace(true)}>
            Replace all
          </Button>
        </>
      )}
      <IconButton
        label="Close find"
        variant="ghost"
        onClick={() => {
          close();
          focusDocument(editor);
        }}
      >
        <X aria-hidden="true" />
      </IconButton>
    </section>
  );
}
