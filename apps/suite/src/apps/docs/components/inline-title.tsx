// AUTHORED-BY Codex
// AUTHORED-BY Claude Opus 5.5
"use client";
import { Input } from "@jeswr/suite-ui";
import { type RefObject, useRef } from "react";

/**
 * A thin binding over the runtime's title state: every keystroke is staged so
 * typing is crash-safe and the runtime can detect remote renames while the
 * title is focused. Blur or Enter commits; Escape restores the title from before
 * this focus session's first keystroke, then lets the blur commit that restored
 * value. An untouched field keeps following remote renames.
 */
export function InlineTitle({
  title,
  readOnly,
  inputRef,
  stage,
  commit,
  done,
  cancel,
}: {
  title: string;
  readOnly: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  stage: (title: string) => void;
  commit: (title: string) => void;
  done: () => void;
  cancel: () => void;
}) {
  // Whether a focus session is editing, the title before its first keystroke,
  // and the latest value, read by handlers that run before React re-renders.
  const editing = useRef(false);
  const before = useRef<string | null>(null);
  const latest = useRef(title);
  latest.current = title;
  const change = (value: string) => {
    before.current ??= latest.current;
    latest.current = value;
    stage(value);
  };
  const finish = () => {
    if (!editing.current) return;
    editing.current = false;
    before.current = null;
    commit(latest.current);
  };
  return (
    <Input
      ref={inputRef}
      aria-label="Document title"
      title={title || "Untitled document"}
      placeholder="Untitled document"
      maxLength={200}
      readOnly={readOnly}
      className="docs-title-input"
      value={title}
      onFocus={() => {
        editing.current = !readOnly;
      }}
      onChange={(event) => change(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish();
          done();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (before.current !== null && before.current !== latest.current) change(before.current);
          before.current = null;
          cancel();
        }
      }}
    />
  );
}
