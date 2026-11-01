// AUTHORED-BY Codex GPT-6
"use client";
import { Button, EmptyState, LoadingSkeleton } from "@jeswr/suite-ui";
import { FileCode2, Footprints, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { fileChunks, fingerprintAppleRecord } from "../lib/browser/chunks";
import { type ImportProgress, importHealth, PartialImportError } from "../lib/data/import";
import { importGpx, PartialGpxImportError, previewGpx } from "../lib/data/workouts";
import { useHealth } from "../state/health-context";

const LABELS: Record<string, string> = {
  steps: "Steps",
  heartRate: "Heart rate",
  weight: "Weight",
  sleep: "Sleep",
  systolic: "Systolic blood pressure",
  diastolic: "Diastolic blood pressure",
};
export function ImportView() {
  return (
    <div className="hlt-page">
      <header className="hlt-page-header">
        <div>
          <p className="hlt-eyebrow">BRING YOUR HISTORY</p>
          <h1>Import</h1>
          <p className="hlt-muted">Add readings and routes from files on your device.</p>
        </div>
      </header>
      <div className="hlt-import-grid">
        <AppleImport />
        <GpxImport />
      </div>
      <p className="hlt-bottom-note">
        <LockKeyhole size={16} aria-hidden="true" />
        Files are processed on this device. Only derived measurements are saved from Apple Health;
        the raw XML stays on your device. GPX route files are saved privately with your workouts.
      </p>
    </div>
  );
}
function AppleImport() {
  const { store, session, mutate } = useHealth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportProgress | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "previewing" | "preview" | "importing" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const busy = phase === "previewing" || phase === "importing";
  const choose = async (next: File | undefined) => {
    if (!next) return;
    const request = ++generation.current;
    setFile(next);
    setPreview(null);
    setProgress(null);
    setError("");
    if (/\.zip$/i.test(next.name)) {
      setError(
        "Unzip your Apple Health export and choose export.xml. ZIP files aren't supported here.",
      );
      setPhase("error");
      return;
    }
    if (!/\.xml$/i.test(next.name)) {
      setError("Choose an Apple Health XML file, usually named export.xml.");
      setPhase("error");
      return;
    }
    setPhase("previewing");
    try {
      const result = await importHealth(store, session.webId, fileChunks(next), {
        preview: true,
        fingerprint: fingerprintAppleRecord,
      });
      if (generation.current === request) {
        setPreview(result);
        setPhase("preview");
      }
    } catch {
      if (generation.current === request) {
        setError(
          "Couldn't preview this XML. No data was saved. Check that it is a complete Apple Health export.",
        );
        setPhase("error");
      }
    }
  };
  return (
    <section className="hlt-panel hlt-import-card">
      <div className="hlt-import-icon">
        <FileCode2 size={24} aria-hidden="true" />
      </div>
      <h2>Apple Health</h2>
      <p className="hlt-muted">
        Import your steps, heart rate, sleep, weight and blood pressure from export.xml.
      </p>
      <label htmlFor="hlt-apple-file" className="hlt-file-label">
        Choose or drop an XML file
      </label>
      <input
        id="hlt-apple-file"
        type="file"
        accept=".xml,.zip,text/xml,application/xml"
        disabled={busy}
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <p role="status" aria-label="Apple Health preview status" aria-atomic="true">
        {phase === "preview" && preview
          ? `Apple Health preview complete. ${preview.samplesRead} measurements ready to import.`
          : ""}
      </p>
      {phase === "idle" && (
        <EmptyState
          title="Preview before saving"
          body="Choose your export to review the measurements and dates."
        />
      )}
      {phase === "previewing" && (
        <LoadingSkeleton label="Reading Apple Health export for preview" count={2} />
      )}
      {preview && (
        <div className="hlt-import-preview">
          <h3>{phase === "done" ? "Import complete" : "Preview"}</h3>
          <p className="hlt-import-total">{preview.samplesRead} measurements</p>
          <p className="hlt-muted hlt-small">
            {preview.start
              ? `${preview.start.slice(0, 10)} – ${preview.end?.slice(0, 10)} (UTC)`
              : "No supported measurements found"}
          </p>
          <dl>
            {Object.entries(preview.counts).map(([kind, count]) => (
              <div key={kind}>
                <dt>{LABELS[kind] ?? kind}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {progress && (
        <p role="status">
          {progress.samplesRead} read · {progress.samplesWritten} saved · {progress.shardsWritten}{" "}
          shard writes
        </p>
      )}
      {phase === "importing" && <p role="status">Importing measurements. Keep this page open…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {phase === "error" && file && /\.xml$/i.test(file.name) && (
            <Button size="sm" variant="outline" onClick={() => void choose(file)}>
              Retry preview
            </Button>
          )}
        </div>
      )}
      {phase === "preview" && (
        <Button
          disabled={!preview?.samplesRead}
          onClick={async () => {
            if (!file) return;
            setPhase("importing");
            setError("");
            try {
              const result = await mutate(
                () =>
                  importHealth(store, session.webId, fileChunks(file), {
                    preview: false,
                    fingerprint: fingerprintAppleRecord,
                    onProgress: setProgress,
                  }),
                "Health import complete",
              );
              setProgress(result);
              setPhase("done");
            } catch (cause) {
              if (cause instanceof PartialImportError) {
                setProgress(cause.progress);
                setError(cause.message);
              } else
                setError(
                  "Couldn't import this file. Check your storage connection and private access, then try again.",
                );
              setPhase("error");
            }
          }}
        >
          Import {preview?.samplesRead} measurements
        </Button>
      )}
      {phase === "done" && <Link href="/health">View your summary</Link>}
    </section>
  );
}
interface GpxPreview {
  file: File;
  xml: string;
  route: ReturnType<typeof previewGpx>;
  id: string;
}
function GpxImport() {
  const { store, mutate } = useHealth();
  const [previews, setPreviews] = useState<GpxPreview[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "previewing" | "preview" | "importing" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; iri: string; name: string }[]>([]);
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const busy = phase === "previewing" || phase === "importing";
  const retryable = phase === "error" && previews.length > 0;
  return (
    <section className="hlt-panel hlt-import-card">
      <div className="hlt-import-icon">
        <Footprints size={24} aria-hidden="true" />
      </div>
      <h2>GPX workouts</h2>
      <p className="hlt-muted">
        Bring in recorded routes, distances and elevation. Choose one or more .gpx files.
      </p>
      <label htmlFor="hlt-gpx-files" className="hlt-file-label">
        Choose or drop GPX files
      </label>
      <input
        id="hlt-gpx-files"
        type="file"
        accept=".gpx,application/gpx+xml"
        multiple
        disabled={busy || retryable}
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          setError("");
          setDone([]);
          setPreviews([]);
          setPendingRoute(null);
          if (!files.length) {
            setPhase("idle");
            return;
          }
          setPhase("previewing");
          try {
            const result: GpxPreview[] = [];
            for (const file of files) {
              if (!/\.gpx$/i.test(file.name)) throw new Error("Choose files ending in .gpx.");
              const xml = await file.text();
              result.push({ file, xml, route: previewGpx(xml), id: crypto.randomUUID() });
            }
            setPreviews(result);
            setPhase("preview");
          } catch {
            setError(
              "Couldn't preview the route. Choose valid GPX files with recorded track points. No workouts were saved.",
            );
            setPhase("error");
          }
        }}
      />
      <p role="status" aria-label="GPX preview status" aria-atomic="true">
        {phase === "preview"
          ? `GPX preview complete. ${previews.length} ${previews.length === 1 ? "workout" : "workouts"} ready to import.`
          : ""}
      </p>
      {phase === "idle" && (
        <EmptyState
          title="Your routes, without map tracking"
          body="Preview the track before saving it to your pod."
        />
      )}
      {phase === "previewing" && <LoadingSkeleton count={2} label="Previewing GPX routes" />}
      {!!previews.length && (
        <div className="hlt-import-preview">
          <h3>{phase === "done" ? "Import complete" : "Preview"}</h3>
          <ul>
            {previews.map((item) => (
              <li key={item.id}>
                <strong>{item.file.name}</strong>
                <p className="hlt-muted">
                  {item.route.points.length} points · {(item.route.distance / 1000).toFixed(2)} km ·{" "}
                  {item.route.elevationGain.toFixed(0)} m elevation gain
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(phase === "preview" || retryable) && (
        <Button
          onClick={async () => {
            setPhase("importing");
            setError("");
            const completed = [...done];
            let current: GpxPreview | undefined;
            let route = pendingRoute;
            try {
              for (const item of previews) {
                if (completed.some((saved) => saved.id === item.id)) continue;
                current = item;
                const workout = await mutate(
                  () => importGpx(store, item.id, item.xml),
                  `Imported ${item.file.name}`,
                );
                completed.push({ id: item.id, iri: workout.value, name: item.file.name });
                route = null;
                setPendingRoute(null);
                setDone([...completed]);
              }
              setPhase("done");
            } catch (cause) {
              if (cause instanceof PartialGpxImportError) route = current?.id ?? null;
              setPendingRoute(route ?? null);
              setError(
                `Import stopped. ${completed.length} of ${previews.length} workouts complete. ${route ? "1 additional route is saved; its workout entry is pending. " : ""}Saved resources are kept. Check your storage connection and private access, then retry to finish the remaining workouts.`,
              );
              setPhase("error");
            }
          }}
        >
          {retryable
            ? "Retry remaining workouts"
            : `Import ${previews.length} ${previews.length === 1 ? "workout" : "workouts"}`}
        </Button>
      )}
      {phase === "importing" && (
        <p role="status">
          {done.length} of {previews.length} workouts saved. Keep this page open…
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {!retryable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPhase("idle");
                setError("");
              }}
            >
              Choose another file
            </Button>
          )}
        </div>
      )}
      {!!done.length && (
        <ul aria-label="Imported workouts">
          {done.map((item) => (
            <li key={item.iri}>
              <Link href={`/health/w/${encodeRef(item.iri)}`}>Open {item.name}</Link>
            </li>
          ))}
        </ul>
      )}
      {phase === "done" && <p role="status">{done.length} workouts imported.</p>}
    </section>
  );
}
