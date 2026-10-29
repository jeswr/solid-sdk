// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Download, Move, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import Markdown from "react-markdown";
import { SurfaceFeedback, type SurfaceState } from "./surface-state.js";

export interface PreviewSource {
  name: string;
  blob: Blob;
  contentType?: string;
  /** The owning app supplies <TypedView .../>. Raw data is never rendered here. */
  typedView?: ReactNode;
  details?: Readonly<Record<string, string>>;
}
export interface PreviewPaneProps {
  source?: PreviewSource;
  state?: SurfaceState;
  onAction?: () => void;
}
export function previewKind(
  contentType: string,
): "image" | "pdf" | "video" | "audio" | "text" | "markdown" | "typed" | "unknown" {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (
    [
      "text/turtle",
      "application/ld+json",
      "application/rdf+xml",
      "application/n-triples",
      "application/trig",
      "text/n3",
      "application/n-quads",
    ].includes(type)
  )
    return "typed";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "text/markdown") return "markdown";
  if (type.startsWith("text/")) return "text";
  return "unknown";
}
function useBlobUrl(blob: Blob, forcePdf = false) {
  const [value, setValue] = useState<{ blob: Blob; url: string; forcePdf: boolean }>();
  useEffect(() => {
    const url = URL.createObjectURL(forcePdf ? blob.slice(0, blob.size, "application/pdf") : blob);
    setValue({ blob, url, forcePdf });
    return () => URL.revokeObjectURL(url);
  }, [blob, forcePdf]);
  return value?.blob === blob && value.forcePdf === forcePdf ? value.url : undefined;
}
function ImagePreview({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const help = useId();
  const changeZoom = (delta: number) => setZoom((value) => Math.max(1, Math.min(4, value + delta)));
  return (
    <>
      <div className="su-actions su-preview-tools">
        <button
          className="su-button"
          type="button"
          onClick={() => changeZoom(-0.25)}
          disabled={zoom === 1}
        >
          <ZoomOut size={16} aria-hidden="true" />
          Zoom out
        </button>
        <output aria-live="polite" className="su-zoom-value">
          {Math.round(zoom * 100)}%
        </output>
        <button
          className="su-button"
          type="button"
          onClick={() => changeZoom(0.25)}
          disabled={zoom === 4}
        >
          <ZoomIn size={16} aria-hidden="true" />
          Zoom in
        </button>
        <button
          className="su-button"
          type="button"
          onClick={() => {
            setZoom(1);
            viewport.current?.scrollTo?.(0, 0);
          }}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Reset
        </button>
      </div>
      <p id={help} className="su-muted su-image-help">
        <Move size={16} aria-hidden="true" />
        Use + and − to zoom. Drag or use arrow keys to pan.
      </p>
      <section
        ref={viewport}
        className="su-image-viewport"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable image viewport supports keyboard zoom and pan.
        tabIndex={0}
        aria-label={`Image preview: ${name}`}
        aria-describedby={help}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (
            ["+", "=", "-", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
          )
            event.preventDefault();
          if (event.key === "+" || event.key === "=") changeZoom(0.25);
          if (event.key === "-") changeZoom(-0.25);
          const deltas: Record<string, [number, number]> = {
            ArrowLeft: [-40, 0],
            ArrowRight: [40, 0],
            ArrowUp: [0, -40],
            ArrowDown: [0, 40],
          };
          const delta = deltas[event.key];
          if (delta) {
            event.currentTarget.scrollLeft += delta[0];
            event.currentTarget.scrollTop += delta[1];
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop,
          };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft = drag.current.left - event.clientX + drag.current.x;
          event.currentTarget.scrollTop = drag.current.top - event.clientY + drag.current.y;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        {/* biome-ignore lint/performance/noImgElement: Local blob previews cannot use image optimisation. */}
        <img
          src={url}
          alt={name}
          draggable={false}
          onError={onError}
          style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
        />
      </section>
    </>
  );
}
function TextPreview({
  blob,
  markdown,
  onError,
}: {
  blob: Blob;
  markdown: boolean;
  onError: () => void;
}) {
  const [text, setText] = useState<string>();
  const [raw, setRaw] = useState(false);
  const tooLarge = blob.size > 1024 * 1024;
  useEffect(() => {
    if (tooLarge) return;
    let active = true;
    blob.text().then(
      (value) => {
        if (active) setText(value);
      },
      () => {
        if (active) onError();
      },
    );
    return () => {
      active = false;
    };
  }, [blob, onError, tooLarge]);
  if (tooLarge)
    return (
      <div className="su-feedback" role="status">
        <p className="su-title">Too large to preview</p>
      </div>
    );
  if (text === undefined) return <SurfaceFeedback state={{ status: "loading" }} />;
  return (
    <>
      <div className="su-preview-tools">
        <button className="su-button" type="button" aria-pressed={raw} onClick={() => setRaw(!raw)}>
          {raw ? "Show rendered" : "Show raw"}
        </button>
      </div>
      {raw ? (
        <pre className="su-text-raw">{text}</pre>
      ) : markdown ? (
        <div className="su-markdown">
          <Markdown
            skipHtml
            components={{
              h1: ({ children }) => <h3>{children}</h3>,
              h2: ({ children }) => <h3>{children}</h3>,
              img: ({ alt }) => <span>{alt || "Image"}</span>,
            }}
          >
            {text}
          </Markdown>
        </div>
      ) : (
        <div className="su-text-rendered">{text}</div>
      )}
    </>
  );
}
function ReadyPreview({ source, url }: { source: PreviewSource; url: string }) {
  const [failed, setFailed] = useState(false);
  const kind = previewKind(source.contentType || source.blob.type);
  // Stable callback keeps text reads independent of parent rerenders.
  const onError = useRef(() => setFailed(true)).current;
  return (
    <>
      {failed ? (
        <div className="su-feedback" role="alert">
          <p className="su-title">Can't preview this file</p>
        </div>
      ) : kind === "image" ? (
        <ImagePreview url={url} name={source.name} onError={onError} />
      ) : kind === "pdf" ? (
        <iframe
          className="su-pdf"
          src={url}
          title={`PDF preview: ${source.name}`}
          onError={onError}
        />
      ) : kind === "video" ? (
        <video
          className="su-media"
          controls
          preload="metadata"
          src={url}
          aria-label={source.name}
          onError={onError}
        >
          <track kind="captions" />
          Your browser cannot play this video.
        </video>
      ) : kind === "audio" ? (
        <audio
          className="su-media"
          controls
          preload="metadata"
          src={url}
          aria-label={source.name}
          onError={onError}
        >
          <track kind="captions" />
          Your browser cannot play this audio.
        </audio>
      ) : kind === "text" || kind === "markdown" ? (
        <TextPreview blob={source.blob} markdown={kind === "markdown"} onError={onError} />
      ) : kind === "typed" && source.typedView ? (
        <div className="su-typed-view">{source.typedView}</div>
      ) : (
        <div className="su-feedback">
          <p className="su-title">Can't preview this file</p>
          <dl className="su-details">
            <div>
              <dt>Name</dt>
              <dd>{source.name}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {new Intl.NumberFormat(undefined, { style: "unit", unit: "byte" }).format(
                  source.blob.size,
                )}
              </dd>
            </div>
            {Object.entries(source.details ?? {}).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="su-preview-footer">
        {kind === "pdf" && (
          <p className="su-muted">If the preview doesn't load, download the file.</p>
        )}
        <a
          className="su-button"
          href={url}
          download={source.name}
          aria-label={`Download ${source.name}`}
        >
          <Download size={16} aria-hidden="true" />
          Download<span className="su-sr-only"> {source.name}</span>
        </a>
      </div>
    </>
  );
}
function BlobPreview({ source }: { source: PreviewSource }) {
  const url = useBlobUrl(
    source.blob,
    previewKind(source.contentType || source.blob.type) === "pdf",
  );
  return url ? (
    <ReadyPreview key={url} source={source} url={url} />
  ) : (
    <SurfaceFeedback state={{ status: "loading" }} />
  );
}
function FailureDownload({ source }: { source: PreviewSource }) {
  const url = useBlobUrl(source.blob);
  return url ? (
    <div className="su-preview-footer">
      <a
        className="su-button"
        href={url}
        download={source.name}
        aria-label={`Download ${source.name}`}
      >
        Download<span className="su-sr-only"> {source.name}</span>
      </a>
    </div>
  ) : null;
}
export function PreviewPane({ source, state, onAction }: PreviewPaneProps) {
  const feedback: SurfaceState = state ?? { status: source ? "ready" : "empty" };
  return (
    <section
      className="su-preview-pane"
      aria-label={source ? `Preview: ${source.name}` : "File preview"}
    >
      {feedback.status !== "ready" || !source ? (
        <SurfaceFeedback
          state={feedback.status === "ready" ? { status: "empty" } : feedback}
          emptyTitle="Select a file to preview"
          emptyBody="Choose a file to see it here"
          actionLabel="Choose a file"
          onAction={onAction}
        />
      ) : (
        <BlobPreview source={source} />
      )}
      {feedback.status === "error" && source && <FailureDownload source={source} />}
    </section>
  );
}
