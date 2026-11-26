// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import type { HealthFact } from "@jeswr/pkg-health";
import type { Fact, TemporalValue } from "@jeswr/pkg-memory";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@jeswr/suite-ui";
import { safeHref } from "@jeswr/suite-ui/sign-in";
import { type FormEvent, useRef, useState } from "react";
import {
  beliefLabel,
  correctionBlocker,
  formatKnowledgeDate,
  kindLabel,
  preserveTemporal,
  timelineCoordinate,
  uncertaintyNote,
} from "../lib/knowledge/view-model";
import { useKnowledge } from "../state/knowledge-context";
import { useSheetSide } from "./measurement-sheet";

const fieldLabel = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const VALIDITY: Record<string, string> = {
  Current: "Current",
  Contradicted: "Conflicting",
  Superseded: "Replaced",
  Retracted: "Forgotten",
};
/** An explicit allow-list per kind: no epoch milliseconds, internal flags or raw category IRIs. */
function detailRows(fact: HealthFact): [string, string][] {
  const rows: [string, string | undefined][] = [
    ["Kind", kindLabel(fact.kind)],
    ["Belief", beliefLabel(fact.belief)],
    ["Status", VALIDITY[fact.validity] ?? fact.validity],
    ["Wording", fact.hedge],
    ["Start", fact.period.start ? formatKnowledgeDate(fact.period.start) : undefined],
    ["End", fact.period.end ? formatKnowledgeDate(fact.period.end) : undefined],
    ["Code", [fact.code?.value, fact.code?.system].filter(Boolean).join(" · ") || undefined],
  ];
  switch (fact.kind) {
    case "allergy":
      rows.push(["Substance", fact.substance]);
      break;
    case "medication":
      rows.push(
        ["Product", fact.product.name],
        ["ATC code", fact.product.atcCode],
        [
          "Dose",
          fact.dose
            ? [`${fact.dose.value} ${fact.dose.unit}`, fact.dose.frequency]
                .filter(Boolean)
                .join(" · ")
            : undefined,
        ],
        ["Schedule", fact.doseSchedule],
      );
      break;
    case "observation":
      rows.push(
        ["Result", `${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`],
        ["Recorded interpretation", fact.interpretation],
        ["Date", fact.effectiveTime ? formatKnowledgeDate(fact.effectiveTime) : undefined],
      );
      break;
    case "immunization":
      rows.push(["Product", fact.product], ["Date", fact.date && formatKnowledgeDate(fact.date)]);
      break;
    case "encounter":
      rows.push(
        ["Date", fact.date && formatKnowledgeDate(fact.date)],
        ["Recorded by", fact.recordedBy],
      );
      break;
    case "note":
      rows.push([fieldLabel(fact.property), fact.value]);
      break;
    case "document":
      rows.push(["Date created", fact.dateCreated && formatKnowledgeDate(fact.dateCreated)]);
      break;
    default:
      break;
  }
  return rows.flatMap(([label, value]) => (value ? [[label, value] as [string, string]] : []));
}
function EvidenceTimestamp({ value }: { value: string | undefined }) {
  const time = timelineCoordinate(value);
  if (time === undefined || !value?.includes("T")) return null;
  return (
    <time dateTime={value}>
      {" · "}
      {new Date(time).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
      })}{" "}
      UTC
    </time>
  );
}
function temporal(value: string): TemporalValue | undefined {
  if (!value.trim()) return undefined;
  if (
    !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value) ||
    (formatKnowledgeDate(value) === value && value.length !== 4)
  )
    throw new Error("invalid-date");
  return {
    value,
    datatype: value.length === 4 ? "gYear" : value.length === 7 ? "gYearMonth" : "date",
  };
}
function CorrectionForm({ fact, onDone }: { fact: HealthFact; onDone(): void }) {
  const { correct, busy } = useKnowledge();
  const [name, setName] = useState(fact.label);
  const [start, setStart] = useState(fact.period.start ?? "");
  const [end, setEnd] = useState(fact.period.end ?? "");
  const [dose, setDose] = useState(fact.kind === "medication" ? (fact.dose?.value ?? "") : "");
  const [unit, setUnit] = useState(fact.kind === "medication" ? (fact.dose?.unit ?? "") : "");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    let replacement: Fact;
    try {
      // A date the user did not touch keeps its recorded literal; only edited dates are re-validated.
      const keep = (value: string, original: string | undefined) => {
        if (value.trim() !== (original ?? "")) return temporal(value.trim());
        const kept = preserveTemporal(original);
        if (kept === "unsupported") throw new Error("invalid-date");
        return kept;
      };
      const validFrom = keep(start, fact.period.start),
        validThrough = keep(end, fact.period.end);
      if (!name.trim() || (start && end && start.trim() > end.trim()))
        throw new Error("invalid-form");
      const period = {
        ...(validFrom ? { validFrom } : {}),
        ...(validThrough ? { validThrough } : {}),
      };
      if (fact.kind === "medication") {
        if (!!dose.trim() !== !!unit.trim() || (dose && !/^\d+(?:\.\d+)?$/.test(dose.trim())))
          throw new Error("invalid-dose");
        replacement = {
          template: "medication",
          value: {
            id: fact.subject,
            ...period,
            medication: {
              id: new URL("#product", fact.subject).href,
              name: name.trim(),
              ...(fact.product.atcCode ? { atcCode: fact.product.atcCode } : {}),
            },
            ...(dose
              ? {
                  dose: {
                    value: dose.trim(),
                    unit: unit.trim(),
                    ...(fact.dose?.frequency ? { frequency: fact.dose.frequency } : {}),
                  },
                }
              : {}),
          },
        };
      } else if (fact.kind === "condition" || fact.kind === "allergy") {
        replacement = {
          template: fact.kind,
          value: {
            id: fact.subject,
            name: name.trim(),
            ...period,
            ...(fact.kind === "condition" && fact.code?.iri && fact.code.value
              ? { code: { id: fact.code.iri, value: fact.code.value } }
              : {}),
          },
        };
      } else return;
    } catch {
      setError(
        "Enter a name, valid dates in year, year-month or year-month-day order, and a numeric dose with a unit when used. The end must be on or after the start.",
      );
      return;
    }
    try {
      if (await correct(fact, replacement)) onDone();
      else setError("This fact changed or can no longer be edited. Close it and open it again.");
    } catch {
      setError("Couldn't save the correction. Try again.");
    }
  }
  return (
    <form
      className="hlt-form"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h3>Correct this fact</h3>
      <label htmlFor="hlt-correction-name">Name</label>
      <Input
        id="hlt-correction-name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      <label htmlFor="hlt-correction-start">Start date</label>
      <Input
        id="hlt-correction-start"
        value={start}
        placeholder="2025-03-03"
        onChange={(e) => setStart(e.target.value)}
        disabled={busy}
        aria-describedby="hlt-correction-dates"
      />
      <label htmlFor="hlt-correction-end">End date</label>
      <Input
        id="hlt-correction-end"
        value={end}
        placeholder="2025-03-03"
        onChange={(e) => setEnd(e.target.value)}
        disabled={busy}
        aria-describedby="hlt-correction-dates"
      />
      <p id="hlt-correction-dates" className="hlt-small hlt-muted">
        Dates are optional. Use YYYY, YYYY-MM or YYYY-MM-DD to preserve the precision you know.
      </p>
      {fact.kind === "medication" && (
        <>
          <label htmlFor="hlt-correction-dose">Dose</label>
          <Input
            id="hlt-correction-dose"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            disabled={busy}
            inputMode="decimal"
          />
          <label htmlFor="hlt-correction-unit">Dose unit</label>
          <Input
            id="hlt-correction-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            disabled={busy}
          />
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="hlt-form-actions">
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Cancel correction
        </Button>
        <Button type="submit" disabled={busy}>
          Save correction
        </Button>
      </div>
    </form>
  );
}
export function KnowledgeDetail({
  fact,
  onClose,
  onSelect,
}: {
  fact: HealthFact | null;
  onClose(): void;
  onSelect(fact: HealthFact): void;
}) {
  const { data, busy, forget } = useKnowledge();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLElement | null>(null);
  const side = useSheetSide();
  const readOnly = data?.source === "file" ? "Open it from your pod to make changes" : "";
  const historical =
    fact && (fact.belief === "past" || fact.validity !== "Current")
      ? "Only Current facts can be changed. The history is kept."
      : "";
  const unsupported =
    fact && !["condition", "allergy", "medication"].includes(fact.kind)
      ? "Corrections are available for conditions, allergies and medications only."
      : fact
        ? correctionBlocker(fact)
        : "";
  return (
    <Sheet
      open={!!fact}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent
        side={side}
        className="hlt-sheet hlt-knowledge-detail"
        onOpenAutoFocus={() => {
          trigger.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = trigger.current;
          (target?.isConnected ? target : document.getElementById("main-content"))?.focus();
        }}
      >
        <SheetTitle>{fact?.label ?? "Health fact"}</SheetTitle>
        <SheetDescription>The claim, its evidence and your controls.</SheetDescription>
        {fact && (
          <>
            <span className="hlt-knowledge-badge">{beliefLabel(fact.belief)}</span>
            {uncertaintyNote(fact) && (
              <p className="hlt-info-note" role="note">
                {uncertaintyNote(fact)} It may be out of date.
              </p>
            )}
            <dl className="hlt-knowledge-fields">
              {detailRows(fact).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <section className="hlt-knowledge-stack">
              <h3>Replaced by</h3>
              {fact.replacedBy.length ? (
                fact.replacedBy.map((id) => {
                  const next = data?.view.facts.find((f) => f.id === id);
                  return next ? (
                    <Button key={id} variant="outline" onClick={() => onSelect(next)}>
                      View replacement: {next.label}
                    </Button>
                  ) : (
                    <p key={id}>{id}</p>
                  );
                })
              ) : (
                <p>No replacement recorded.</p>
              )}
            </section>
            <section className="hlt-knowledge-stack" aria-label="Fact provenance">
              <h3>Provenance</h3>
              <p>Created {formatKnowledgeDate(fact.provenance.generatedAt)}</p>
              <p>Generating agent: {fact.provenance.agent.label ?? "Label not recorded"}</p>
              <p className="hlt-small">{fact.provenance.agent.iri}</p>
              <p>Batch: {fact.provenance.batch}</p>
              <p>Attributed to: {fact.provenance.attributedTo.join(" · ") || "Not recorded"}</p>
              <h4>Sources</h4>
              {fact.provenance.sources.map((source) => (
                <article className="hlt-panel" key={source.iri}>
                  <h5>{source.title ?? "Untitled source"}</h5>
                  <p>{source.kind ?? "Kind not recorded"}</p>
                  <p>Model: {source.model ?? "Not recorded"}</p>
                  <p>Created {formatKnowledgeDate(source.created)}</p>
                  {source.url && safeHref(source.url) && (
                    <a
                      href={safeHref(source.url)}
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      Open source: {source.title ?? "document"}
                    </a>
                  )}
                  <details>
                    <summary>Source identifiers</summary>
                    <p>{source.iri}</p>
                    <p>Thread: {source.threadId ?? "Not recorded"}</p>
                  </details>
                </article>
              ))}
              {!fact.provenance.sources.length && <p>Source not recorded.</p>}
              <h4>Evidence</h4>
              {fact.provenance.evidence.map((evidence, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: A fact's evidence is immutable and keeps its recorded order.
                <figure className="hlt-knowledge-evidence" key={index}>
                  {evidence.quote ? (
                    <blockquote>{evidence.quote}</blockquote>
                  ) : (
                    <p>No quote recorded.</p>
                  )}
                  <figcaption>
                    {evidence.speaker ?? "Speaker not recorded"} ·{" "}
                    {formatKnowledgeDate(evidence.timestamp)}
                    <EvidenceTimestamp value={evidence.timestamp} />
                  </figcaption>
                  <details>
                    <summary>Evidence reference</summary>
                    <p>{evidence.source}</p>
                    {evidence.locator && <p>{evidence.locator}</p>}
                  </details>
                </figure>
              ))}
              {!fact.provenance.evidence.length && <p>No evidence recorded.</p>}
            </section>
            <details>
              <summary>Fact identifiers</summary>
              <dl className="hlt-knowledge-fields">
                {["id", "assertionId", "subject"].map((key) => (
                  <div key={key}>
                    <dt>{fieldLabel(key)}</dt>
                    <dd>{fact[key as "id" | "assertionId" | "subject"]}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <div className="hlt-form-actions">
              <Button
                variant="outline"
                disabled={busy || !!readOnly || !!historical || !!unsupported}
                aria-describedby="hlt-knowledge-change-reason"
                onClick={() => setEditing(true)}
              >
                Correct
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!readOnly || !!historical}
                aria-describedby="hlt-knowledge-change-reason"
                onClick={() => setConfirm(true)}
              >
                Forget
              </Button>
            </div>
            <p id="hlt-knowledge-change-reason" className="hlt-muted hlt-small">
              {[readOnly, historical, unsupported].filter(Boolean).join(" ") ||
                "Your changes keep the original claim in history."}
            </p>
            {editing && <CorrectionForm fact={fact} onDone={() => setEditing(false)} />}
            <AlertDialog
              open={confirm}
              onOpenChange={(open) => {
                if (!busy) setConfirm(open);
              }}
            >
              <AlertDialogContent>
                <AlertDialogTitle>Forget this fact?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your assistant will stop using this. The history is kept.
                </AlertDialogDescription>
                {error && <p role="alert">{error}</p>}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy}
                    onClick={(event) => {
                      event.preventDefault();
                      setError("");
                      void forget(fact)
                        .then((ok) => {
                          if (ok) setConfirm(false);
                          else
                            setError(
                              "This fact changed or can no longer be forgotten. Close it and open it again.",
                            );
                        })
                        .catch(() => setError("Couldn't forget this fact. Try again."));
                    }}
                  >
                    Forget fact
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
