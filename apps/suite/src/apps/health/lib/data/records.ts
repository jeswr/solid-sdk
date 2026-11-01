// AUTHORED-BY Codex GPT-6
import { NS } from "@jeswr/suite-vocab";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { generateDueDoses, type MedicationSchedule } from "../medication";
import {
  addRecord,
  emptyHealthDocument,
  type Precondition,
  RecordDetails,
  type RecordKind,
  Reminder,
} from "../model";
import type { HealthStore } from "./metrics";

/** Extra textual record fields use the same typed accessors as the model. */
class RecordFields extends RecordDetails {
  text(key: string): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}${key}`, LiteralAs.string);
  }
  setText(key: string, value: string): void {
    OptionalAs.object(this, `${NS.SCHEMA}${key}`, value, LiteralFrom.string);
  }
}
export type ClinicalKind = Exclude<RecordKind, "records">;
export interface ClinicalRecord {
  id: string;
  iri: string;
  etag: string | null;
  kind: ClinicalKind;
  name: string;
  note: string;
  dose: string;
  date: string;
  frequency: "daily" | "weekly" | "none";
  time: string;
  timeZone: string;
  reminders: Date[];
}
export type RecordDraft = Pick<
  ClinicalRecord,
  "name" | "note" | "dose" | "date" | "frequency" | "time" | "timeZone"
>;
/** Gregorian record dates are independent of the medication scheduler's horizon. */
export function isRecordDate(date: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
export function scheduleFor(id: string, input: RecordDraft): MedicationSchedule {
  const base = { id, startDate: input.date };
  if (input.frequency === "none") return { ...base, kind: "as-needed" };
  if (input.frequency === "weekly")
    return { ...base, kind: "interval", everyDays: 7, times: [input.time] };
  return { ...base, kind: "daily", times: [input.time] };
}
export async function loadRecords(
  store: HealthStore,
  kind: ClinicalKind,
): Promise<ClinicalRecord[]> {
  const result: ClinicalRecord[] = [];
  for (const entry of await store.loadRecords(kind)) {
    const path = entry.value.split("#")[0] as string;
    const { document, etag } = await store.read(path);
    const fields = new RecordFields(entry.value, document, DataFactory);
    const frequency = fields.text("repeatFrequency");
    result.push({
      id: (path.split("/").at(-1) as string).replace(/\.ttl$/, ""),
      iri: entry.value,
      etag,
      kind,
      name: fields.name ?? "Unnamed record",
      note: fields.note ?? "",
      dose: fields.text("text") ?? "",
      date: fields.text("startDate") ?? "",
      frequency: frequency === "P1D" ? "daily" : frequency === "P1W" ? "weekly" : "none",
      time: fields.text("startTime") ?? "08:00",
      timeZone: fields.text("scheduleTimezone") ?? "UTC",
      reminders: [...fields.reminders]
        .map((iri) => new Reminder(iri, document, DataFactory).at)
        .filter((at): at is Date => at !== undefined),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
export async function saveRecord(
  store: HealthStore,
  owner: string,
  kind: ClinicalKind,
  id: string,
  input: RecordDraft,
  condition: Precondition,
  now: Date,
  subject?: string,
) {
  if (subject === undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
    throw new TypeError("Invalid record ID");
  if (!input.name.trim()) throw new TypeError("Enter a name");
  if (!isRecordDate(input.date)) throw new TypeError("Choose a valid date");
  const iri = subject ?? `${store.base}${kind}/${id}.ttl#it`;
  const path = iri.split("#")[0] as string;
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const due =
    kind === "medications"
      ? generateDueDoses(
          scheduleFor(iri, input),
          { start: start.getTime(), end: start.getTime() + 90 * 86400000 },
          input.timeZone,
        )
      : [];
  const document =
    "create" in condition ? emptyHealthDocument() : (await store.read(path)).document;
  addRecord(document, {
    iri,
    kind,
    patient: owner,
    name: input.name.trim(),
    reference: `${iri}-concept`,
    note: input.note,
    reminders: due.map((dose, index) => ({
      iri: `${iri}-reminder-${index}`,
      at: new Date(dose.scheduledAt),
    })),
  });
  const fields = new RecordFields(iri, document, DataFactory);
  for (const [key, value] of Object.entries({
    text: input.dose,
    startDate: input.date,
    repeatFrequency:
      input.frequency === "daily" ? "P1D" : input.frequency === "weekly" ? "P1W" : "",
    startTime: input.time,
    scheduleTimezone: input.timeZone,
  }))
    fields.setText(key, value);
  await store.initialize();
  await store.write(path, document, condition);
  return iri;
}
/** Recur from the schedule, so reminders remain correct beyond the saved 90-day horizon. */
export function dueMedications(records: readonly ClinicalRecord[], now: Date) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return records
    .flatMap((record) => {
      if (!record.date)
        return record.reminders
          .filter((at) => at >= start && at <= now)
          .map((at) => ({ record, at }));
      return generateDueDoses(
        scheduleFor(record.iri, record),
        { start: start.getTime(), end: Math.floor(now.getTime() / 1000) * 1000 + 1000 },
        record.timeZone,
      ).map((dose) => ({ record, at: new Date(dose.scheduledAt) }));
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
export function nextDose(record: ClinicalRecord, now: Date): Date | null {
  if (!record.date) return record.reminders.find((at) => at >= now) ?? null;
  const start = Math.floor(now.getTime() / 1000) * 1000;
  const dose = generateDueDoses(
    scheduleFor(record.iri, record),
    { start, end: start + 8 * 86400000 },
    record.timeZone,
  )[0];
  return dose ? new Date(dose.scheduledAt) : null;
}
