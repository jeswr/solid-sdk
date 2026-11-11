// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, IconButton, Input } from "@jeswr/suite-ui";
import { Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { requireHttp } from "../../lib/model/rdf";
import type { StoredTask } from "../../lib/model/store";
import { attachmentViews } from "../../lib/views/attachments";
import { useTasks } from "../../state/tasks-context";

export function TaskAttachments({ stored }: { stored: StoredTask }) {
  const tasks = useTasks();
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    ++revision.current;
    setAdding(false);
    setDraft("");
    setError("");
    requestAnimationFrame(() => trigger.current?.focus());
  };
  return (
    <section className="tsk-attachments" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>Attachments</h3>
      <ul>
        {attachmentViews(stored, tasks.storageUrl).map((link) => {
          const { url } = link;
          return (
            <li key={url}>
              <a
                href={link.href}
                title={url}
                aria-label={`${link.name} — ${url}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.name}
              </a>
              <IconButton
                label={`Remove attachment ${link.name}`}
                variant="ghost"
                disabled={!stored.etag}
                onClick={() => {
                  void tasks.updateTask(stored, (task) => {
                    task.attachments = task.attachments.filter((value) => value !== url);
                  });
                  requestAnimationFrame(() => (input.current ?? trigger.current)?.focus());
                }}
              >
                <X size={16} aria-hidden="true" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <form
          data-tsk-attachment-form=""
          className="tsk-detail-stack"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            let url: string;
            try {
              url = requireHttp(draft.trim());
            } catch {
              setError("Enter an http or https link.");
              input.current?.focus();
              return;
            }
            const submitted = revision.current;
            setError("");
            setBusy(true);
            void tasks
              .updateTask(stored, (task) => {
                task.attachments = [...task.attachments, url];
              })
              .then((saved) => {
                setBusy(false);
                if (saved && revision.current === submitted) close();
              });
          }}
        >
          <label htmlFor={`${id}-link`}>Attachment link</label>
          <Input
            ref={input}
            id={`${id}-link`}
            type="text"
            inputMode="url"
            autoComplete="off"
            value={draft}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              ++revision.current;
              setDraft(event.target.value);
              setError("");
            }}
          />
          {error && (
            <p id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
          <div className="tsk-detail-inline">
            <Button type="submit" size="sm" disabled={!draft.trim() || busy || !stored.etag}>
              Add attachment
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="sm"
          disabled={!stored.etag}
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => input.current?.focus());
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Add attachment
        </Button>
      )}
    </section>
  );
}
