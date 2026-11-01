// AUTHORED-BY Codex GPT-6
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Textarea,
} from "@jeswr/suite-ui";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  type ClinicalKind,
  type ClinicalRecord,
  nextDose,
  type RecordDraft,
} from "../lib/data/records";
import { useHealth, useRecords } from "../state/health-context";
import { useSheetSide } from "./measurement-sheet";

const TITLES = {
  medications: "Medications",
  conditions: "Conditions",
  immunisations: "Immunisations",
};
const SINGULAR = {
  medications: "medication",
  conditions: "condition",
  immunisations: "immunisation",
};
const recordSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(200),
  note: z.string().max(2000),
  dose: z.string().max(200),
  date: z
    .string()
    .regex(/^20\d{2}-\d{2}-\d{2}$/, "Choose a date between 2000 and 2099")
    .refine((date) => {
      const parsed = new Date(`${date}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    }, "Choose a valid date"),
  frequency: z.enum(["daily", "weekly", "none"]),
  time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time"),
  timeZone: z.string().min(1),
});
function scheduleText(record: ClinicalRecord) {
  return record.frequency === "none"
    ? "As needed / no schedule"
    : `${record.frequency === "daily" ? "Daily" : "Weekly"} at ${record.time} (${record.timeZone})`;
}
export function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const media = matchMedia("(min-width: 768px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}
export function RecordsView({ kind }: { kind: ClinicalKind }) {
  const state = useRecords(kind);
  const { invalidate } = useHealth();
  const wide = useWide();
  const [editor, setEditor] = useState<ClinicalRecord | "new" | null>(null);
  const title = TITLES[kind],
    singular = SINGULAR[kind];
  const open = (record: ClinicalRecord) => {
    if (record.etag) setEditor(record);
  };
  const columns = [
    {
      id: "name",
      header: kind === "immunisations" ? "Vaccine" : "Name",
      accessor: (record: ClinicalRecord) => record.name,
      render: (record: ClinicalRecord) => (
        <button
          type="button"
          className="hlt-text-button"
          disabled={!record.etag}
          title={!record.etag ? "Waiting for the saved record" : undefined}
          onClick={() => open(record)}
        >
          {record.name}
        </button>
      ),
      minSize: 160,
      size: 200,
    },
    ...(kind === "medications"
      ? [
          {
            id: "dose",
            header: "Dose",
            accessor: (record: ClinicalRecord) => record.dose,
            size: 120,
          },
          { id: "schedule", header: "Schedule", accessor: scheduleText, size: 190 },
          {
            id: "next",
            header: "Next dose",
            accessor: (record: ClinicalRecord) =>
              nextDose(record, new Date())?.toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: record.timeZone,
              }) ?? "No scheduled dose",
            size: 200,
          },
        ]
      : [
          {
            id: "date",
            header: kind === "immunisations" ? "Date received" : "Date recorded",
            accessor: (record: ClinicalRecord) => record.date || "Not recorded",
            size: 150,
          },
          {
            id: "note",
            header: "Notes",
            accessor: (record: ClinicalRecord) => record.note,
            size: 220,
          },
        ]),
  ];
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">YOUR RECORDS</p>
          <h1>{title}</h1>
          <p className="hlt-muted">
            {kind === "medications"
              ? "Keep your doses and reminders together."
              : kind === "conditions"
                ? "A personal record of your health history."
                : "Keep track of vaccines you have received."}
          </p>
        </div>
        <Button onClick={() => setEditor("new")}>Add {singular}</Button>
      </header>
      {kind === "medications" && (
        <p className="hlt-info-note">
          Reminders follow the schedule you enter. Dose logging is not yet available. These are your
          personal records, not dosage advice.
        </p>
      )}
      {state.status === "loading" ? (
        <LoadingSkeleton preset="table" label={`Loading ${title.toLowerCase()}`} />
      ) : state.status === "error" ? (
        <ErrorState error="unreachable" actions={{ retry: invalidate }} />
      ) : state.status === "empty" ? (
        <EmptyState
          title={`No ${title.toLowerCase()} yet`}
          body={`Add a ${singular} to keep it in your private records.`}
          primaryAction={<Button onClick={() => setEditor("new")}>Add {singular}</Button>}
        />
      ) : wide ? (
        <div className="hlt-panel hlt-record-table">
          <DataTable
            items={state.data}
            columns={columns}
            getKey={(record) => record.iri}
            getLabel={(record) => record.name}
            label={title}
            onOpen={open}
            height={440}
          />
        </div>
      ) : (
        <div className="hlt-record-cards">
          {state.data.map((record) => (
            <article className="hlt-panel" key={record.iri}>
              <h2>{record.name}</h2>
              <p>{kind === "medications" ? record.dose : record.date || "Date not recorded"}</p>
              {kind === "medications" && (
                <>
                  <p>{scheduleText(record)}</p>
                  <p className="hlt-muted">
                    Next:{" "}
                    {nextDose(record, new Date())?.toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: record.timeZone,
                    }) ?? "No scheduled dose"}
                  </p>
                </>
              )}
              {record.note && <p className="hlt-muted">{record.note}</p>}
              <Button
                variant="outline"
                size="sm"
                disabled={!record.etag}
                title={!record.etag ? "Waiting for the saved record" : undefined}
                onClick={() => open(record)}
              >
                Edit {record.name}
              </Button>
            </article>
          ))}
        </div>
      )}
      <RecordSheet kind={kind} record={editor} onClose={() => setEditor(null)} />
    </div>
  );
}
function RecordSheet({
  kind,
  record,
  onClose,
}: {
  kind: ClinicalKind;
  record: ClinicalRecord | "new" | null;
  onClose(): void;
}) {
  const { save } = useHealth();
  const side = useSheetSide();
  const trigger = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const [error, setError] = useState("");
  const form = useForm<RecordDraft>({ resolver: zodResolver(recordSchema) });
  const { reset } = form;
  useEffect(() => {
    generation.current++;
    if (record) {
      reset(
        record === "new"
          ? {
              name: "",
              dose: "",
              date: new Date().toISOString().slice(0, 10),
              frequency: kind === "medications" ? "daily" : "none",
              time: "08:00",
              timeZone: "UTC",
              note: "",
            }
          : record,
      );
      setError("");
    }
  }, [record, kind, reset]);
  const frequency = form.watch("frequency");
  const fieldError = (name: keyof RecordDraft) => form.formState.errors[name]?.message;
  return (
    <Sheet
      open={record !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="hlt-sheet"
        side={side}
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
        <SheetTitle>
          {record === "new" ? "Add" : "Edit"} {SINGULAR[kind]}
        </SheetTitle>
        <SheetDescription>Only you can see these records.</SheetDescription>
        <form
          className="hlt-form"
          onSubmit={form.handleSubmit(async (values) => {
            const request = generation.current;
            setError("");
            try {
              await save(kind, values, record && record !== "new" ? record : undefined);
              if (request === generation.current) onClose();
            } catch {
              if (request !== generation.current) return;
              setError(
                "Couldn't save this record. It may have changed elsewhere. Close this form and reopen the refreshed record before trying again.",
              );
            }
          })}
        >
          <label htmlFor="hlt-record-name">{kind === "immunisations" ? "Vaccine" : "Name"}</label>
          <Input
            id="hlt-record-name"
            {...form.register("name")}
            aria-invalid={!!fieldError("name")}
            aria-describedby="hlt-record-name-error"
          />
          <p id="hlt-record-name-error" role="alert">
            {fieldError("name")}
          </p>
          <label htmlFor="hlt-record-date">
            {kind === "medications"
              ? "Schedule start date"
              : kind === "immunisations"
                ? "Date received"
                : "Date recorded"}
          </label>
          <Input
            id="hlt-record-date"
            type="date"
            {...form.register("date")}
            aria-invalid={!!fieldError("date")}
            aria-describedby="hlt-record-date-error"
          />
          <p id="hlt-record-date-error" role="alert">
            {fieldError("date")}
          </p>
          {kind === "medications" && (
            <>
              <label htmlFor="hlt-dose">Dose</label>
              <Input
                id="hlt-dose"
                {...form.register("dose")}
                placeholder="As recorded on your prescription"
                aria-invalid={!!fieldError("dose")}
                aria-describedby="hlt-dose-error"
              />
              <p id="hlt-dose-error" role="alert">
                {fieldError("dose")}
              </p>
              <label htmlFor="hlt-frequency">Schedule</label>
              <select id="hlt-frequency" {...form.register("frequency")}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (every 7 days)</option>
                <option value="none">As needed</option>
              </select>
              {frequency !== "none" && (
                <>
                  <label htmlFor="hlt-time">Reminder time (UTC)</label>
                  <Input
                    id="hlt-time"
                    type="time"
                    {...form.register("time")}
                    aria-invalid={!!fieldError("time")}
                    aria-describedby="hlt-time-error"
                  />
                  <p id="hlt-time-error" role="alert">
                    {fieldError("time")}
                  </p>
                </>
              )}
              <p className="hlt-muted hlt-small">
                Times use UTC. Weekly reminders repeat from your start date.
              </p>
            </>
          )}
          <label htmlFor="hlt-record-note">Notes (optional)</label>
          <Textarea
            id="hlt-record-note"
            {...form.register("note")}
            aria-describedby="hlt-record-note-error"
          />
          <p id="hlt-record-note-error" role="alert">
            {fieldError("note")}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="hlt-form-actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving…" : "Save record"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
