// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Popover,
  PopoverAnchor,
  toast,
} from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { Check, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { focusDocument } from "../editor/focus";
import {
  resolveSuggestions,
  type Suggestion,
  suggestionAt,
  suggestionUnsupported,
} from "../lib/editor/suggestions";
import { EditorPopoverContent } from "./editor-popover-content";

export function SuggestionModeSwitch({
  suggesting,
  change,
}: {
  suggesting: boolean;
  change: (value: boolean) => void;
}) {
  return (
    <label className="docs-suggestion-mode">
      <Pencil size={16} aria-hidden="true" />
      <select
        aria-label="Editing mode"
        className="docs-block-select"
        value={suggesting ? "suggesting" : "editing"}
        onChange={(event) => change(event.target.value === "suggesting")}
      >
        <option value="editing">Editing</option>
        <option value="suggesting">Suggesting</option>
      </select>
    </label>
  );
}

function decide(editor: Editor, accept: boolean, id?: string) {
  // Permission may have changed since the popover or confirmation was opened.
  if (!editor.isEditable) return;
  editor.view.dispatch(resolveSuggestions(editor.state, accept, id));
  focusDocument(editor);
}

export function SuggestionPopover({ editor }: { editor: Editor }) {
  const [active, setActive] = useState<Suggestion | undefined>(() => suggestionAt(editor.state));
  const [dismissed, setDismissed] = useState<string | undefined>();
  const acceptButton = useRef<HTMLButtonElement>(null);
  const keyboardReview = useRef(false);
  useEffect(() => {
    const update = () => {
      const next = suggestionAt(editor.state);
      setActive(next);
      setDismissed((previous) => (previous === next?.id ? previous : undefined));
    };
    const dom = editor.view.dom;
    const click = (event: MouseEvent) => {
      if ((event.target as Element).closest("[data-suggestion-id]")) {
        setDismissed(undefined);
        setActive(suggestionAt(editor.state));
      }
    };
    const review = () => {
      const next = suggestionAt(editor.state);
      if (!next || !editor.isEditable) return;
      setActive(next);
      setDismissed(undefined);
      keyboardReview.current = acceptButton.current === null;
      acceptButton.current?.focus();
    };
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.altKey &&
        event.shiftKey &&
        event.code === "KeyA" &&
        suggestionAt(editor.state) &&
        editor.isEditable
      ) {
        event.preventDefault();
        event.stopPropagation();
        review();
      }
    };
    const unsupported = () =>
      toast.error("This change can't be suggested yet. Switch to Editing to make it.");
    dom.addEventListener(suggestionUnsupported, unsupported);
    dom.addEventListener("keydown", key, true);
    dom.addEventListener("docs-review-suggestion", review);
    editor.on("transaction", update);
    dom.addEventListener("click", click);
    return () => {
      editor.off("transaction", update);
      dom.removeEventListener("click", click);
      dom.removeEventListener(suggestionUnsupported, unsupported);
      dom.removeEventListener("keydown", key, true);
      dom.removeEventListener("docs-review-suggestion", review);
    };
  }, [editor]);
  return (
    <>
      <span role="status" aria-live="polite" className="su-sr-only">
        {active &&
          `${active.author} suggested ${active.kind === "suggestionInsert" ? "insertion" : "deletion"}`}
      </span>
      {active && active.id !== dismissed && editor.isEditable && (
        <Popover open onOpenChange={() => setDismissed(active.id)}>
          <PopoverAnchor asChild>
            <span className="docs-popover-anchor" />
          </PopoverAnchor>
          <EditorPopoverContent
            editor={editor}
            aria-label="Review suggestion"
            restoreFocus={() => {
              if (!editor.isDestroyed) editor.view.focus();
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              if (keyboardReview.current) acceptButton.current?.focus();
              keyboardReview.current = false;
            }}
          >
            <div className="docs-form">
              <strong>
                {active.kind === "suggestionInsert" ? "Suggested addition" : "Suggested deletion"}
              </strong>
              <span>{active.author}</span>
              <time dateTime={active.created}>{active.created}</time>
              <small>Ctrl/Cmd+Alt+Shift+A to review; Escape to return to the document.</small>
              <div className="docs-suggestion-actions">
                <Button ref={acceptButton} onClick={() => decide(editor, true, active.id)}>
                  <Check size={16} aria-hidden="true" /> Accept
                </Button>
                <Button variant="outline" onClick={() => decide(editor, false, active.id)}>
                  <X size={16} aria-hidden="true" /> Reject
                </Button>
              </div>
            </div>
          </EditorPopoverContent>
        </Popover>
      )}
    </>
  );
}

export function ResolveAllSuggestions({
  editor,
  accept,
  close,
}: {
  editor: Editor;
  accept: boolean;
  close: () => void;
}) {
  const action = accept ? "Accept" : "Reject";
  return (
    <Dialog open onOpenChange={close}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusDocument(editor);
        }}
      >
        <DialogTitle>{action} all suggestions?</DialogTitle>
        <DialogDescription>
          This applies to all pending suggestions in this document.
        </DialogDescription>
        <Button
          onClick={() => {
            decide(editor, accept);
            close();
          }}
        >
          {action} all
        </Button>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
