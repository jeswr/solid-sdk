// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, IconButton, toast } from "@jeswr/suite-ui";
import { Send, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "../lib/client";
import { useChatActions, useDraft } from "../state/chat-context";
export function Composer({
  url,
  send,
  editing,
  onEdit,
  lastOwn,
  disabledReason,
}: {
  url: string;
  send: (text: string) => void;
  editing: Message | undefined;
  onEdit: (message: Message | undefined) => void;
  lastOwn: Message | undefined;
  disabledReason?: string | undefined;
}) {
  const actions = useChatActions();
  const [storedDraft, setStoredDraft] = useDraft(url);
  const [editDraft, setEditDraft] = useState("");
  const draft = editing ? editDraft : storedDraft;
  const setDraft = editing ? setEditDraft : setStoredDraft;
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(() => {
    setEditDraft(editing?.content ?? "");
    if (editing) field.current?.focus();
  }, [editing]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resizing follows the draft text
  useLayoutEffect(() => {
    const node = field.current;
    if (node) {
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, 192)}px`;
    }
  }, [draft]);
  const submit = async () => {
    if (!draft.trim() || disabledReason || saving) return;
    if (editing) {
      setSaving(true);
      try {
        await actions.edit(url, editing.id, draft);
        onEdit(undefined);
        setDraft("");
      } catch {
        toast.error("Couldn't save your edit. Your draft is still here.");
      } finally {
        setSaving(false);
      }
    } else {
      send(draft);
      setDraft("");
      field.current?.focus();
    }
  };
  return (
    <form
      className="chat-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {editing && (
        <div className="chat-editing">
          <span>Editing message</span>
          <IconButton label="Cancel edit" variant="ghost" onClick={() => onEdit(undefined)}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      <label className="sr-only" htmlFor={id}>
        {editing ? "Edit message" : "Message"}
      </label>
      <div className="chat-compose-row">
        <textarea
          id={id}
          ref={field}
          rows={2}
          placeholder="Write a message…"
          value={draft}
          disabled={!!disabledReason || saving}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape" && editing) {
              event.preventDefault();
              onEdit(undefined);
            }
            if (event.key === "ArrowUp" && !draft && lastOwn && !editing) {
              event.preventDefault();
              onEdit(lastOwn);
            }
          }}
        />
        <Button
          type="submit"
          aria-label={editing ? "Save edit" : "Send message"}
          disabled={!draft.trim() || !!disabledReason || saving}
        >
          <Send aria-hidden="true" size={18} />
          <span className="chat-send-label">{editing ? "Save" : "Send"}</span>
        </Button>
      </div>
      <p className="chat-hint" id={`${id}-hint`}>
        {disabledReason || <>*bold* _italic_ `code` · Enter to send · Shift+Enter for a new line</>}
      </p>
    </form>
  );
}
