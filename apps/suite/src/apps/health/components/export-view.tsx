// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button, Input } from "@jeswr/suite-ui";
import { FileJson, LockKeyhole } from "lucide-react";
import { useId, useState } from "react";
import { type ExportCounts, type ExportSkips, exportHealth, exportRange } from "../lib/data/export";
import { FhirExportError } from "../lib/fhir";
import { useHealth } from "../state/health-context";

const day = (date: Date) => date.toISOString().slice(0, 10);
function yearBefore(today: string) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  date.setUTCDate(date.getUTCDate() + 1);
  return day(date);
}
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ExportView() {
  const { store } = useHealth();
  const today = day(new Date());
  const [from, setFrom] = useState(() => yearBefore(today));
  const [to, setTo] = useState(today);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [result, setResult] = useState<{ counts: ExportCounts; skipped: ExportSkips }>();
  const [error, setError] = useState("");
  const fromId = useId();
  const toId = useId();
  const run = async () => {
    setError("");
    setResult(undefined);
    let range: ReturnType<typeof exportRange>;
    try {
      range = exportRange(from, to);
    } catch (cause) {
      setError((cause as Error).message);
      setPhase("error");
      return;
    }
    setPhase("working");
    try {
      const exported = await exportHealth(store, range, {
        clock: () => new Date(),
        uuid: () => crypto.randomUUID(),
      });
      const url = URL.createObjectURL(new Blob([exported.json], { type: "application/fhir+json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `health-${from}-to-${to}.fhir.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setResult({ counts: exported.counts, skipped: exported.skipped });
      setPhase("done");
    } catch (cause) {
      setError(
        cause instanceof FhirExportError && cause.code === "TOO_MANY_RECORDS"
          ? "That's too many readings for one file. Choose a shorter date range."
          : "Couldn't export your health data. Check your connection and try again.",
      );
      setPhase("error");
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
          medication and condition is included. Immunisations and sleep aren't included yet.
        </p>
        <div className="hlt-export-dates">
          <div>
            <label htmlFor={fromId}>From</label>
            <Input
              id={fromId}
              type="date"
              value={from}
              max={to}
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
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
        </div>
        <Button disabled={phase === "working"} onClick={() => void run()}>
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
          <p role="alert" className="hlt-export-error">
            {error}
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
