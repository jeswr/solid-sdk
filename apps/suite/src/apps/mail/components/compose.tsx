// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Input, Label, Textarea, toast } from "@jeswr/suite-ui";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { decodeRef, encodeRef } from "@/lib/refs";
import { mailErrorMessage } from "../lib/client";
import type { SavedDraft } from "../lib/model";
import { useMail } from "../state/mail-context";

/**
 * Comma, semicolon or newline separated addresses; a `Name <a@b>` form keeps the address, and
 * separators inside a quoted display name ("Example, Bob") do not split it.
 */
export function parseRecipients(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && /[,;\n]/.test(char)) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => /<([^<>]+)>\s*$/.exec(part)?.[1]?.trim() ?? part);
}
function draftRef(ref: string | null): string | null {
  try {
    return ref ? decodeRef(ref) : null;
  } catch {
    return null;
  }
}
interface Fields {
  to: string;
  cc: string;
  subject: string;
  text: string;
}
const EMPTY: Fields = { to: "", cc: "", subject: "", text: "" };

/** Remounts the form whenever the draft changes, so a new message never inherits an old one. */
export function ComposePage() {
  const requested = useSearchParams().get("draft");
  return <ComposeForm key={requested ?? "new"} requested={requested} />;
}
function ComposeForm({ requested }: { requested: string | null }) {
  const { client, account, invalidate, session } = useMail();
  const router = useRouter();
  const editing = draftRef(requested);
  const [saved, setSaved] = useState<SavedDraft | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [savedFields, setSavedFields] = useState<Fields>(EMPTY);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    editing ? "loading" : requested ? "missing" : "ready",
  );
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const ids = {
    to: useId(),
    cc: useId(),
    subject: useId(),
    text: useId(),
    note: useId(),
    error: useId(),
  };
  const described = error ? ids.error : undefined;
  useEffect(() => {
    if (!editing) return;
    let live = true;
    void client.draft(editing).then(
      (draft) => {
        if (!live) return;
        setSaved({ iri: draft.iri, etag: draft.etag });
        const next = {
          to: draft.to.join(", "),
          cc: draft.cc.join(", "),
          subject: draft.subject,
          text: draft.text,
        };
        setFields(next);
        setSavedFields(next);
        setStatus("ready");
      },
      () => live && setStatus("missing"),
    );
    return () => {
      live = false;
    };
  }, [client, editing]);
  const change = (key: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const sendAvailable =
    session.mode === "demo" &&
    status === "ready" &&
    parseRecipients(fields.to).length + parseRecipients(fields.cc).length > 0;
  const canSend = sendAvailable && !busy;
  const persist = async () => {
    const next = await client.saveDraft(
      account,
      {
        to: parseRecipients(fields.to),
        cc: parseRecipients(fields.cc),
        subject: fields.subject,
        text: fields.text,
      },
      saved ?? undefined,
    );
    setSaved(next);
    setSavedFields(fields);
    invalidate();
    return next;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || sending.current) return;
    setBusy(true);
    setError("");
    try {
      const next = await persist();
      // The new URL remounts the form, which reloads exactly what was saved.
      if (!saved) router.replace(`/mail/compose?draft=${encodeRef(next.iri)}`);
      toast("Draft saved");
    } catch (failure) {
      setError(mailErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!canSend || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const next =
        saved && JSON.stringify(fields) === JSON.stringify(savedFields) ? saved : await persist();
      const sent = await client.sendDemo(next.iri, next.etag);
      invalidate();
      toast("Saved in Sent (demo, not delivered)", {
        duration: 8000,
        action: <Link href={`/mail/t/${encodeRef(sent.thread)}`}>View</Link>,
      });
      router.push("/mail/sent");
    } catch (failure) {
      setError(mailErrorMessage(failure));
      invalidate();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const discard = async () => {
    if (busy || sending.current) return;
    if (!saved) {
      router.push("/mail/inbox");
      return;
    }
    if (!window.confirm("Discard this draft? It is deleted from your pod.")) return;
    setBusy(true);
    try {
      await client.discardDraft(saved);
      invalidate();
      toast("Draft discarded");
      router.push("/mail/drafts");
    } catch (failure) {
      setError(mailErrorMessage(failure));
      setBusy(false);
    }
  };
  if (status === "missing")
    return (
      <div className="mail-page mail-compose">
        <h1 className="mail-page-title">This draft isn't here any more</h1>
        <p className="mail-muted">It may have been discarded or sent from another device.</p>
        <a className="mail-action-link" href="/mail/compose">
          Start a new message
        </a>
      </div>
    );
  return (
    <div className="mail-page mail-compose">
      <h1 className="mail-page-title">{saved || editing ? "Edit draft" : "New message"}</h1>
      {status === "loading" ? (
        <p className="mail-muted" role="status">
          Loading draft…
        </p>
      ) : (
        <form
          className="mail-form mail-compose-form"
          onSubmit={save}
          aria-busy={busy}
          onKeyDown={(event) => {
            if (canSend && (event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              void send();
            }
          }}
        >
          <Label htmlFor={ids.to}>To</Label>
          <Input
            id={ids.to}
            readOnly={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={described}
            value={fields.to}
            onChange={(event) => change("to")(event.target.value)}
            placeholder="name@example.org, …"
            autoComplete="off"
          />
          <Label htmlFor={ids.cc}>Cc</Label>
          <Input
            id={ids.cc}
            readOnly={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={described}
            value={fields.cc}
            onChange={(event) => change("cc")(event.target.value)}
            autoComplete="off"
          />
          <Label htmlFor={ids.subject}>Subject</Label>
          <Input
            id={ids.subject}
            readOnly={busy}
            value={fields.subject}
            onChange={(event) => change("subject")(event.target.value)}
          />
          <Label htmlFor={ids.text}>Message</Label>
          <Textarea
            id={ids.text}
            readOnly={busy}
            rows={12}
            value={fields.text}
            onChange={(event) => change("text")(event.target.value)}
          />
          {error && (
            <p id={ids.error} ref={errorRef} className="mail-error" role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
          <div className="mail-compose-actions">
            <Button type="submit" aria-disabled={busy}>
              Save draft
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!sendAvailable}
              aria-disabled={busy || !sendAvailable}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              aria-describedby={ids.note}
              onClick={() => void send()}
            >
              Send
            </Button>
            <Button type="button" variant="ghost" aria-disabled={busy} onClick={discard}>
              Discard
            </Button>
          </div>
          <p id={ids.note} className="mail-muted">
            {session.mode === "demo"
              ? "Demo pod: Send files the message in Sent. Nothing leaves your browser."
              : "Sending needs a connected mail account. Drafts are saved in your pod."}
          </p>
        </form>
      )}
    </div>
  );
}
