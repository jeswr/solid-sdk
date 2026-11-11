// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, EmptyState, ErrorState, LoadingSkeleton, toast } from "@jeswr/suite-ui";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { type FormResponse, ResponseSaveUncertainError } from "../lib/data/store";
import { formUrl } from "../lib/form-url";
import type { FormModel } from "../lib/runtime";
import { useForms } from "../state/forms-context";
import { AnswerForm } from "./answer-form";

export function FillView() {
  const shape = useSearchParams().get("form");
  const { controller } = useForms();
  let address: URL | undefined;
  try {
    if (shape) address = formUrl(shape);
  } catch {
    /* Refused below, before any store read. */
  }
  const valid = !!address;
  const [form, setForm] = useState<FormModel>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<FormResponse>();
  const [saveError, setSaveError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the read
  useEffect(() => {
    let live = true;
    setForm(undefined);
    setError(false);
    setSaved(undefined);
    setSaveError(undefined);
    if (shape && valid)
      void controller.store.loadForm(shape).then(
        (result) => {
          if (live) setForm(result);
        },
        () => {
          if (live) setError(true);
        },
      );
    return () => {
      live = false;
    };
  }, [shape, valid, controller, attempt]);
  if (!shape)
    return (
      <EmptyState
        title="This form link is incomplete"
        body="Ask the author for a fill link that includes a form address."
        secondaryAction={<a href="/forms">Return to your forms</a>}
      />
    );
  if (!address)
    return (
      <EmptyState
        title="This form address isn't safe to open"
        body="Ask the author for a complete HTTPS form link without a username or password."
        secondaryAction={<a href="/forms">Return to your forms</a>}
      />
    );
  if (error)
    return (
      <ErrorState error="unreachable" actions={{ retry: () => setAttempt((value) => value + 1) }}>
        <p>The form may be private, unavailable or outside this demo. Ask its author for access.</p>
      </ErrorState>
    );
  if (!form) return <LoadingSkeleton preset="document" label="Opening form…" />;
  if (saved)
    return (
      <div className="fm-card fm-stack">
        <h2>Your response is saved</h2>
        <p>
          It lives in your own pod under forms/responses/. Sending a link to the author's inbox is
          not connected yet.
        </p>
        <p className="fm-url">{saved.subject}</p>
        <p>You can copy this address, but the author will also need permission to read it.</p>
        <Button variant="outline" onClick={() => setSaved(undefined)}>
          Send another response
        </Button>
        <a href="/forms">Return to your forms</a>
      </div>
    );
  return (
    <section className="fm-fill">
      {controller.store.isForeign(shape) && (
        <p className="fm-notice">
          This form is hosted at {address.origin}. It was opened without your pod credentials.
        </p>
      )}
      <p className="fm-notice">
        Your answers belong to you. Saving creates a response in your pod; it doesn't send your
        answers to the author yet.
      </p>
      <div aria-busy={saving}>
        <AnswerForm
          key={shape}
          form={form}
          validate={controller.store.validate}
          onSubmit={(values) => {
            if (saving) return;
            setSaving(true);
            setSaveError(undefined);
            void controller.store
              .submit(form, values)
              .then(
                (response) => {
                  setSaved(response);
                },
                (error: unknown) => {
                  const message =
                    error instanceof ResponseSaveUncertainError
                      ? error.message
                      : "Couldn't save your response. Your answers are still here; try again when connected.";
                  setSaveError(message);
                  toast.error(message);
                },
              )
              .finally(() => setSaving(false));
          }}
        />
      </div>
      {saveError && <p role="alert">{saveError}</p>}
      {saving && (
        <div role="status" className="fm-card">
          <h2>Saving your response…</h2>
          <p>Your answers are being saved in your pod.</p>
        </div>
      )}
    </section>
  );
}
