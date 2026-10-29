// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type DroppedFiles,
  DropZoneOverlay,
  PreviewPane,
  type PreviewSource,
  type SurfaceError,
  type SurfaceState,
  surfaceErrorCopy,
  UploadDock,
  type UploadItem,
  uploadQueueReducer,
} from "@jeswr/suite-ui";
import { useEffect, useMemo, useReducer, useState } from "react";
export const ds11States = [
  "ready",
  "loading",
  "empty",
  "filtered-empty",
  ...Object.keys(surfaceErrorCopy).map((code) => `error-${code}`),
];
function feedback(value: string): SurfaceState {
  if (value === "loading" || value === "empty") return { status: value };
  if (value === "filtered-empty") return { status: value, query: "travel" };
  if (value.startsWith("error-") && value.slice(6) in surfaceErrorCopy)
    return { status: "error", error: value.slice(6) as SurfaceError };
  return { status: "ready" };
}
export function FixtureFrame({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <div className="fixture-heading">
        <p className="eyebrow">Solid Suite · DS-11</p>
        <h1>{name}</h1>
        <a href="/dev/components">All components</a>
      </div>
      {children}
    </main>
  );
}
const initial: readonly UploadItem[] = [
  {
    id: "active",
    name: "Project proposal.pdf",
    total: 100,
    sent: 45,
    status: "uploading",
    attempt: 1,
  },
  {
    id: "queued",
    name: "Notes/Meeting notes.md",
    total: 100,
    sent: 0,
    status: "queued",
    attempt: 0,
  },
  { id: "paused", name: "Summer photo.png", total: 100, sent: 60, status: "paused", attempt: 1 },
  { id: "waiting", name: "Interview.wav", total: 100, sent: 0, status: "waiting", attempt: 0 },
  {
    id: "failed",
    name: "Budget.csv",
    total: 100,
    sent: 0,
    status: "failed",
    attempt: 1,
    error: "quota",
  },
  { id: "done", name: "Read me.txt", total: 100, sent: 100, status: "done", attempt: 1 },
  { id: "skipped", name: "Old draft.txt", total: 100, sent: 0, status: "skipped", attempt: 1 },
];
export function UploadFixture({ state }: { state: string }) {
  const [items, dispatch] = useReducer(uploadQueueReducer, initial);
  const [fixed, setFixed] = useState(false);
  const controls = {
    onPause: (id: string) => dispatch({ type: "pause", id }),
    onResume: (id: string) => dispatch({ type: "resume", id }),
    onCancel: (id: string) => dispatch({ type: "cancel", id }),
    onRetry: (id: string) => dispatch({ type: "retry", id }),
  };
  return (
    <FixtureFrame name="UploadDock">
      <p className="text-foreground-muted">
        Per-file progress and queue controls. Escape collapses the dock.
      </p>
      <button type="button" className="su-button w-fit" onClick={() => setFixed(!fixed)}>
        {fixed ? "Show in page" : "Show bottom-right dock"}
      </button>
      <UploadDock
        {...controls}
        items={
          ["queued", "uploading", "paused", "waiting", "done", "failed", "skipped"].includes(state)
            ? items.filter((item) => item.status === state)
            : items
        }
        inline={!fixed}
        state={feedback(state)}
        canPause={state !== "no-pause"}
        initiallyCollapsed={state === "collapsed"}
        onAction={() =>
          dispatch({
            type: "enqueue",
            files: [{ id: `file-${items.length}`, name: "New file.txt", total: 100 }],
          })
        }
      />
      <FixtureStateLinks
        component="upload-dock"
        extras={[
          "collapsed",
          "no-pause",
          "queued",
          "uploading",
          "paused",
          "waiting",
          "done",
          "failed",
          "skipped",
        ]}
      />
    </FixtureFrame>
  );
}
export function DropFixture({ state }: { state: string }) {
  const [received, setReceived] = useState<DroppedFiles>();
  const [pending, setPending] = useState(false);
  async function accept(files: DroppedFiles) {
    if (state === "read-error") throw new Error("fixture read failure");
    setReceived(files);
  }
  return (
    <FixtureFrame name="DropZoneOverlay">
      <p className="text-foreground-muted">
        Drop files or a folder. The buttons offer the same action from a keyboard.
      </p>
      <DropZoneOverlay
        folderName="Project notes"
        onFiles={accept}
        state={feedback(state)}
        showOverlay={state === "drag-over"}
        disabled={state === "disabled"}
        onAction={() => setPending(true)}
      >
        <div className="p-4">
          <p className="font-medium">This folder is empty</p>
          <p className="text-foreground-muted">Drag files here or use New</p>
        </div>
      </DropZoneOverlay>
      {pending && <p role="status">Ready to try again</p>}
      {received && (
        <section aria-label="Received files">
          <h2>
            {received.files.length} {received.files.length === 1 ? "file" : "files"} received
          </h2>
          <ul>
            {received.directories.map((path) => (
              <li key={path}>{path}</li>
            ))}
            {received.files.map(({ path }) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </section>
      )}
      <FixtureStateLinks
        component="drop-zone-overlay"
        extras={["drag-over", "disabled", "read-error"]}
      />
    </FixtureFrame>
  );
}
function wav(): Blob {
  const count = 8000;
  const data = new ArrayBuffer(44 + count * 2);
  const view = new DataView(data);
  const word = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  word(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  word(8, "WAVE");
  word(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, count, true);
  view.setUint32(28, count * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, count * 2, true);
  return new Blob([data], { type: "audio/wav" });
}
function pdf(): Blob {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([text], { type: "application/pdf" });
}
function image(): Blob {
  // Small local raster; no external image request or raw colour literal in app source.
  const bytes = atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  );
  return new Blob([Uint8Array.from(bytes, (char) => char.charCodeAt(0))], { type: "image/png" });
}
function TypedExample() {
  return (
    <article className="grid gap-3">
      <h3>Project notes</h3>
      <p>A shared document for the team.</p>
      <dl className="su-details">
        <div>
          <dt>Owner</dt>
          <dd>Alex Morgan</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>26 October 2026</dd>
        </div>
      </dl>
    </article>
  );
}
function fixtureSource(kind: string): PreviewSource {
  switch (kind) {
    case "image":
      return { name: "Paper.png", blob: image() };
    case "pdf":
      return { name: "Project proposal.pdf", blob: pdf() };
    case "video":
      return { name: "Project.webm", blob: new Blob([], { type: "video/webm" }) };
    case "audio":
      return { name: "Silence.wav", blob: wav() };
    case "text":
      return {
        name: "Read me.txt",
        blob: new Blob(["Project notes\n\nSaved to your pod.\nReady to share with your team."], {
          type: "text/plain",
        }),
      };
    case "markdown":
    case "raw":
      return {
        name: "Meeting notes.md",
        blob: new Blob(
          [
            "# Meeting notes\n\nYour data stays **yours**.\n\n- Review the proposal\n- Share with the team\n\n[All components](/dev/components)\n\n`Saved to your pod`",
          ],
          { type: "text/markdown" },
        ),
      };
    case "typed":
      return {
        name: "Project notes",
        blob: new Blob([], { type: "text/turtle" }),
        typedView: <TypedExample />,
      };
    default:
      return {
        name: "Archive.bin",
        blob: new Blob(["Example binary fixture"], { type: "application/octet-stream" }),
        details: { Type: "File", Owner: "Alex Morgan" },
      };
  }
}
function RasterFixture() {
  const [source, setSource] = useState<PreviewSource>();
  useEffect(() => {
    let active = true;
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    if (!context) return;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    context.fillStyle = token("--primary-soft");
    context.fillRect(0, 0, 960, 600);
    context.fillStyle = token("--surface");
    context.fillRect(120, 80, 720, 440);
    context.strokeStyle = token("--border");
    context.strokeRect(120, 80, 720, 440);
    context.fillStyle = token("--primary");
    context.fillRect(168, 128, 48, 48);
    context.fillStyle = token("--foreground");
    context.font = "600 36px system-ui";
    context.fillText("Project notes", 168, 248);
    context.fillStyle = token("--foreground-muted");
    context.font = "24px system-ui";
    context.fillText("Your data stays yours.", 168, 296);
    context.fillStyle = token("--surface-3");
    context.fillRect(168, 344, 624, 12);
    context.fillRect(168, 376, 480, 12);
    canvas.toBlob((blob) => {
      if (active && blob) setSource({ name: "Paper.png", blob });
    }, "image/png");
    return () => {
      active = false;
    };
  }, []);
  return (
    <PreviewPane {...(source ? { source } : {})} state={{ status: source ? "ready" : "loading" }} />
  );
}
function VideoFixture() {
  const [source, setSource] = useState<PreviewSource>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    if (!context || typeof MediaRecorder === "undefined") {
      setFailed(true);
      return;
    }
    const styles = getComputedStyle(document.documentElement);
    context.fillStyle = styles.getPropertyValue("--surface-2");
    context.fillRect(0, 0, 320, 180);
    context.fillStyle = styles.getPropertyValue("--foreground");
    context.font = "18px sans-serif";
    context.fillText("Project notes", 24, 90);
    const stream = canvas.captureStream(0);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      if (active)
        setSource({ name: "Project.webm", blob: new Blob(chunks, { type: "video/webm" }) });
    };
    recorder.start();
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    const frame = requestAnimationFrame(() => {
      context.fillText("Project notes", 24, 90);
      track?.requestFrame();
    });
    const secondFrame = window.setTimeout(() => {
      context.fillText("Project notes", 24, 90);
      track?.requestFrame();
    }, 200);
    const timer = window.setTimeout(() => recorder.stop(), 400);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      clearTimeout(secondFrame);
      clearTimeout(timer);
      if (recorder.state !== "inactive") recorder.stop();
      stream.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, []);
  return (
    <PreviewPane
      {...(source ? { source } : {})}
      state={
        source
          ? { status: "ready" }
          : failed
            ? { status: "error", error: "unsupported" }
            : { status: "loading" }
      }
    />
  );
}
export function PreviewFixture({ state, kind }: { state: string; kind: string }) {
  const source = useMemo(() => fixtureSource(kind), [kind]);
  return (
    <FixtureFrame name="PreviewPane">
      <h2>{kind === "typed" ? "Document" : source.name}</h2>
      {kind === "image" && state === "ready" ? (
        <RasterFixture />
      ) : kind === "video" && state === "ready" ? (
        <VideoFixture />
      ) : (
        <PreviewPane
          source={source}
          state={feedback(state)}
          onAction={() => window.location.assign("/dev/components/preview-pane")}
        />
      )}
      <nav aria-label="Preview types" className="flex flex-wrap gap-4">
        {["image", "pdf", "video", "audio", "text", "markdown", "typed", "unknown"].map((type) => (
          <a key={type} href={`?kind=${type}`}>
            {type === "typed" ? "Document" : type}
          </a>
        ))}
      </nav>
      <FixtureStateLinks component="preview-pane" />
    </FixtureFrame>
  );
}
function FixtureStateLinks({ component, extras = [] }: { component: string; extras?: string[] }) {
  return (
    <nav aria-label="Fixture states" className="grid gap-2">
      <h2>States</h2>
      {[...ds11States, ...extras].map((state) => (
        <a key={state} href={`/dev/components/${component}?state=${state}`}>
          {state}
        </a>
      ))}
    </nav>
  );
}
