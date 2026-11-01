// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, Input } from "@jeswr/suite-ui";
import { FileJson, LockKeyhole } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  civilToday,
  type ExportCounts,
  type ExportSkips,
  exportHealth,
  exportRange,
} from "../lib/data/export";
import { FhirExportError } from "../lib/fhir";
import { useHealth } from "../state/health-context";

function yearBefore(today: string) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
const RANGE_ERROR = "range";
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ExportView() {
  const { store, clock, pending } = useHealth();
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const today = civilToday(clock, zone);
  const [from, setFrom] = useState(() => yearBefore(today));
  const [to, setTo] = useState(today);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [result, setResult] = useState<{ counts: ExportCounts; skipped: ExportSkips }>();
  // `attempt` remounts the alert so a repeated message is announced again.
  const [error, setError] = useState<{ text: string; kind: string; attempt: number }>();
  const fromId = useId();
  const toId = useId();
  const errorId = useId();
  const fail = (text: string, kind = "export") => {
    setError((current) => ({ text, kind, attempt: (current?.attempt ?? 0) + 1 }));
    setPhase("error");
  };
  const run = async () => {
    if (phase === "working") return;
    setResult(undefined);
    let range: ReturnType<typeof exportRange>;
    try {
      range = exportRange(from, to, zone);
    } catch (cause) {
      fail((cause as Error).message, RANGE_ERROR);
      return;
    }
    setError(undefined);
    setPhase("working");
    try {
      const exported = await exportHealth(store, range, {
        clock: () => new Date(),
        uuid: () => crypto.randomUUID(),
        unsaved: pending,
      });
      const url = URL.createObjectURL(new Blob([exported.json], { type: "application/fhir+json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `health-${from}-to-${to}.fhir.json`;
      document.body.append(link);
      link.click();
      link.remove();
      // Safari can cancel a download whose URL is revoked straight away.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setResult({ counts: exported.counts, skipped: exported.skipped });
      setPhase("done");
    } catch (cause) {
      if (cause instanceof FhirExportError && cause.code === "TOO_MANY_RECORDS")
        fail("That's too many readings for one file. Choose a shorter date range.", RANGE_ERROR);
      else if (cause instanceof FhirExportError)
        fail(
          "Some of your health data couldn't be converted to FHIR, so no file was made. Try a different date range.",
        );
      else fail("Couldn't export your health data. Check your connection and try again.");
    }
  };
  const skips = result
    ? [
        result.skipped.sleep &&
          `${plural(result.skipped.sleep, "sleep reading")} (not supported yet)`,
        result.skipped.unpairedBloodPressure &&
          `${plural(result.skipped.unpairedBloodPressure, "blood pressure reading")} without a matching systolic or diastolic value`,
        result.skipped.undatedRecords &&
          `${plural(result.skipped.undatedRecords, "medication or condition")} without a start date`,
      ].filter((value): value is string => Boolean(value))
    : [];
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">TAKE IT WITH YOU</p>
          <h1>Export</h1>
          <p className="hlt-muted">
            Download your readings, medications and conditions as a FHIR file for a doctor or
            another health app.
          </p>
        </div>
      </header>
      <section className="hlt-panel hlt-import-card hlt-export-card" aria-labelledby="hlt-fhir">
        <div className="hlt-import-icon">
          <FileJson size={24} aria-hidden="true" />
        </div>
        <h2 id="hlt-fhir">FHIR R4 file</h2>
        <p className="hlt-muted">
          Readings from the dates you choose: steps, heart rate, weight and blood pressure. Every
          medication and condition is included. Notes, workouts, immunisations and sleep aren't
          included yet. Dates use your device's time zone ({zone}).
        </p>
        <div className="hlt-export-dates">
          <div>
            <label htmlFor={fromId}>From</label>
            <Input
              id={fromId}
              type="date"
              value={from}
              min="2000-01-01"
              max={to}
              aria-invalid={error?.kind === RANGE_ERROR || undefined}
              aria-describedby={error?.kind === RANGE_ERROR ? errorId : undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={toId}>To</label>
            <Input
              id={toId}
              type="date"
              value={to}
              min={from}
              max={today}
              aria-invalid={error?.kind === RANGE_ERROR || undefined}
              aria-describedby={error?.kind === RANGE_ERROR ? errorId : undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        <Button aria-disabled={phase === "working" || undefined} onClick={() => void run()}>
          {phase === "working" ? "Preparing file…" : "Download FHIR file"}
        </Button>
        <div role="status" aria-atomic="true">
          {phase === "done" && result && (
            <div className="hlt-import-preview">
              <h3>Download ready</h3>
              <dl>
                <div>
                  <dt>Readings</dt>
                  <dd>{result.counts.observations}</dd>
                </div>
                <div>
                  <dt>Medications</dt>
                  <dd>{result.counts.medications}</dd>
                </div>
                <div>
                  <dt>Conditions</dt>
                  <dd>{result.counts.conditions}</dd>
                </div>
              </dl>
              {skips.length > 0 && (
                <>
                  <p className="hlt-muted hlt-small">Left out:</p>
                  <ul className="hlt-muted hlt-small">
                    {skips.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        {error && (
          <p key={error.attempt} id={errorId} role="alert" className="hlt-export-error">
            {error.text}
          </p>
        )}
      </section>
      <p className="hlt-bottom-note">
        <LockKeyhole size={16} aria-hidden="true" />
        The file is built on this device and saved to your downloads. Nothing is sent anywhere else.
        It contains personal health information, so share it with care.
      </p>
    </div>
  );
}
