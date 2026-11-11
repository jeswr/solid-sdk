// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { fillLink, newForm } from "../lib/designer";
import type { FormModel } from "../lib/runtime";
import { useForms, useFormsState } from "../state/forms-context";
import { Designer } from "./designer";
import { ResponsesView } from "./responses-view";
import { ShareDialog } from "./share-dialog";

export function FormsHome() {
  const { controller, session } = useForms();
  const state = useFormsState();
  const [editing, setEditing] = useState<FormModel>();
  const [responses, setResponses] = useState<FormModel>();
  const [sharing, setSharing] = useState<FormModel>();
  if (editing)
    return (
      <Designer
        key={editing.shape}
        initial={editing}
        onSaved={() => {}}
        onClose={() => setEditing(undefined)}
      />
    );
  if (responses) return <ResponsesView form={responses} close={() => setResponses(undefined)} />;
  const create = () =>
    setEditing(newForm(new URL(`forms/${crypto.randomUUID()}.ttl#form`, session.storageUrl).href));
  return (
    <section className="fm-stack">
      <header className="fm-toolbar">
        <div>
          <p className="fm-eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</p>
          <AppHeading>Your forms</AppHeading>
          <p className="fm-muted">Ask something. Make room for every answer.</p>
        </div>
        <Button onClick={create}>Create form</Button>
      </header>
      <p role="status" className="fm-muted">
        {state.pending
          ? "Saving…"
          : state.failed
            ? "A form couldn't be saved. Open its draft and try again."
            : `${state.forms.length} forms in your pod`}
      </p>
      {state.skipped.length > 0 && (
        <p className="fm-muted">
          {state.skipped.length} resources couldn't be opened as forms and were skipped.
        </p>
      )}
      {state.status === "loading" ? (
        <LoadingSkeleton preset="grid" label="Loading forms…" />
      ) : state.status === "error" ? (
        <ErrorState
          error="unreachable"
          actions={{
            retry: () => {
              void controller.load();
            },
          }}
        />
      ) : !state.forms.length ? (
        <EmptyState
          title="Good questions start here"
          body="Build your first form, then share a link for people to answer."
          primaryAction={<Button onClick={create}>Create your first form</Button>}
        />
      ) : (
        <div className="fm-grid">
          {state.forms.map((form) => (
            <article key={form.shape} className="fm-card fm-form-card">
              <p className="fm-eyebrow">{form.fields.length} QUESTIONS</p>
              <h2>{form.label}</h2>
              <p className="fm-muted">
                {form.description || "A new conversation, ready to begin."}
              </p>
              <div className="fm-actions">
                <Button aria-label={`Design form: ${form.label}`} onClick={() => setEditing(form)}>
                  Design form
                </Button>
                <Button variant="outline" onClick={() => setResponses(form)}>
                  Responses
                </Button>
                <Button variant="ghost" onClick={() => setSharing(form)}>
                  Share
                </Button>
                <a href={fillLink("", form.shape)}>Fill in form</a>
              </div>
            </article>
          ))}
        </div>
      )}
      {sharing && <ShareDialog form={sharing} close={() => setSharing(undefined)} />}
    </section>
  );
}
