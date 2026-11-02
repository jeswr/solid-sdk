// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, Input, Label, Textarea, toast } from "@jeswr/suite-ui";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";
import { decodeRef, encodeRef } from "@/lib/refs";
import { mailErrorMessage } from "../lib/client";
import { useMail } from "../state/mail-context";

/** Comma, semicolon or newline separated addresses; a "Name <a@b>" form keeps the address. */
export function parseRecipients(value: string): string[] {
  return value
    .split(/[,;\n]+/)
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

export function ComposePage() {
  const { client, account, invalidate } = useMail();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("draft");
  const editing = draftRef(requested);
  const [iri, setIri] = useState<string | null>(editing);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">(
    editing ? "loading" : requested ? "missing" : "ready",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = { to: useId(), cc: useId(), subject: useId(), text: useId(), note: useId() };
  useEffect(() => {
    if (!editing) return;
    let live = true;
    client.draft(editing).then(
      (draft) => {
        if (!live) return;
        setFields({
          to: draft.to.join(", "),
          cc: draft.cc.join(", "),
          subject: draft.subject,
          text: draft.text,
        });
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
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await client.saveDraft(
        account,
        {
          to: parseRecipients(fields.to),
          cc: parseRecipients(fields.cc),
          subject: fields.subject,
          text: fields.text,
        },
        iri ?? undefined,
      );
      if (!iri) {
        setIri(saved);
        router.replace(`/mail/compose?draft=${encodeRef(saved)}`);
      }
      invalidate();
      toast("Draft saved");
    } catch (failure) {
      setError(mailErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (!iri) {
      router.push("/mail/inbox");
      return;
    }
    setBusy(true);
    try {
      await client.discardDraft(iri);
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
      <h1 className="mail-page-title">{iri ? "Edit draft" : "New message"}</h1>
      {status === "loading" ? (
        <p className="mail-muted" role="status">
          Loading draft…
        </p>
      ) : (
        <form className="mail-form mail-compose-form" onSubmit={save} aria-busy={busy}>
          <Label htmlFor={ids.to}>To</Label>
          <Input
            id={ids.to}
            value={fields.to}
            onChange={(event) => change("to")(event.target.value)}
            placeholder="name@example.org, …"
            autoComplete="off"
          />
          <Label htmlFor={ids.cc}>Cc</Label>
          <Input
            id={ids.cc}
            value={fields.cc}
            onChange={(event) => change("cc")(event.target.value)}
            autoComplete="off"
          />
          <Label htmlFor={ids.subject}>Subject</Label>
          <Input
            id={ids.subject}
            value={fields.subject}
            onChange={(event) => change("subject")(event.target.value)}
          />
          <Label htmlFor={ids.text}>Message</Label>
          <Textarea
            id={ids.text}
            rows={12}
            value={fields.text}
            onChange={(event) => change("text")(event.target.value)}
          />
          {error && (
            <p className="mail-error" role="alert">
              {error}
            </p>
          )}
          <div className="mail-compose-actions">
            <Button type="submit" disabled={busy}>
              Save draft
            </Button>
            <Button type="button" variant="outline" disabled aria-describedby={ids.note}>
              Send
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={discard}>
              Discard
            </Button>
          </div>
          <p id={ids.note} className="mail-muted">
            Sending needs a connected mail account. Drafts are saved in your pod.
          </p>
        </form>
      )}
    </div>
  );
}
