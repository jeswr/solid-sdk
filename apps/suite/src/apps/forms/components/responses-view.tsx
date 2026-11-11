// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  toast,
} from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { answerText, responsesCsv } from "../lib/csv";
import type { FormResponse } from "../lib/data/store";
import type { FormModel } from "../lib/runtime";
import { useForms } from "../state/forms-context";

export function ResponsesView({ form, close }: { form: FormModel; close: () => void }) {
  const { controller } = useForms();
  const [responses, setResponses] = useState<FormResponse[]>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<FormResponse>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the read
  useEffect(() => {
    let live = true;
    setError(false);
    setResponses(undefined);
    void controller.store.listResponses(form).then(
      (items) => {
        if (live) setResponses(items);
      },
      () => {
        if (live) setError(true);
      },
    );
    return () => {
      live = false;
    };
  }, [controller, form, attempt]);
  return (
    <section className="fm-stack">
      <div className="fm-toolbar">
        <div>
          <h2>{form.label} · Responses</h2>
          <p className="fm-muted">
            Answers remain in respondents' pods. Automatic inbox delivery is coming later.
          </p>
        </div>
        <div className="fm-actions">
          <Button variant="outline" onClick={close}>
            Back to forms
          </Button>
          <Button
            disabled={!responses?.length}
            onClick={async () => {
              if (!responses) return;
              const blob = new Blob([responsesCsv(form, responses)], {
                type: "text/csv;charset=utf-8",
              });
              try {
                if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native") {
                  const { saveNatively } = await import("@/lib/native/save-file");
                  await saveNatively(blob, "form-responses.csv", "text/csv");
                } else {
                  const url = URL.createObjectURL(blob);
                  try {
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "form-responses.csv";
                    link.click();
                  } finally {
                    setTimeout(() => URL.revokeObjectURL(url), 30_000);
                  }
                }
              } catch {
                toast.error("Couldn't export your responses. Try again.");
              }
            }}
          >
            Export CSV
          </Button>
        </div>
      </div>
      {error ? (
        <ErrorState
          error="unreachable"
          actions={{ retry: () => setAttempt((value) => value + 1) }}
        />
      ) : !responses ? (
        <LoadingSkeleton preset="table" label="Loading responses…" />
      ) : !responses.length ? (
        <EmptyState
          title="No received responses yet"
          body="Responses are saved in each respondent's pod. Inbox delivery and access to those answers need the upcoming sharing integration."
        />
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard access to horizontal table scrolling
        <section className="fm-table" aria-label="Responses table" tabIndex={0}>
          <table>
            <caption>{responses.length} responses</caption>
            <thead>
              <tr>
                <th scope="col">Response</th>
                {form.fields.map((field) => (
                  <th scope="col" key={field.key}>
                    {field.label ?? field.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {responses.map((response, index) => (
                <tr key={response.subject}>
                  <th scope="row">
                    <Button variant="ghost" onClick={() => setDetail(response)}>
                      Response {index + 1}
                    </Button>
                  </th>
                  {form.fields.map((field) => (
                    <td key={field.key}>{answerText(response.values[field.key]) || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Response details</DialogTitle>
            <DialogDescription>Saved in the respondent's pod.</DialogDescription>
          </DialogHeader>
          {detail && (
            <>
              <p className="fm-url">{detail.subject}</p>
              <dl className="fm-stack">
                {form.fields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label ?? field.key}</dt>
                    <dd>{answerText(detail.values[field.key]) || "No answer"}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
