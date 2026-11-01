// AUTHORED-BY Codex
"use client";
import { Input } from "@jeswr/suite-ui";
import { type RefObject, useEffect, useRef, useState } from "react";

/** Keep an uncommitted rename local so Escape never creates a pod mutation. */
export function InlineTitle({
  title,
  readOnly,
  inputRef,
  commit,
  done,
  cancel,
}: {
  title: string;
  readOnly: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  commit: (title: string) => void;
  done: () => void;
  cancel: () => void;
}) {
  const [draft, setDraft] = useState(title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(title);
  }, [title]);
  const finish = () => {
    if (!editing.current) return;
    editing.current = false;
    const value = draft.trim() || "Untitled document";
    setDraft(value);
    if (value !== title) commit(value);
  };
  return (
    <Input
      ref={inputRef}
      aria-label="Document title"
      title={draft || "Untitled document"}
      placeholder="Untitled document"
      maxLength={200}
      readOnly={readOnly}
      className="docs-title-input"
      value={draft}
      onFocus={() => {
        editing.current = !readOnly;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish();
          done();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          editing.current = false;
          setDraft(title);
          cancel();
        }
      }}
    />
  );
}
