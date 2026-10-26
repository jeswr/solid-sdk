// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Upload } from "lucide-react";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { captureDrop, type DroppedFiles, filesFromPicker, readDrop } from "../uploads/drop.js";
import { SurfaceFeedback, type SurfaceState } from "./surface-state.js";
export interface DropZoneOverlayProps {
  folderName: string;
  onFiles: (files: DroppedFiles) => void | Promise<void>;
  children?: ReactNode;
  state?: SurfaceState;
  onAction?: () => void;
  disabled?: boolean;
  /** For visual documentation of the drag-over state. */
  showOverlay?: boolean;
}
export function DropZoneOverlay({
  folderName,
  onFiles,
  children,
  state,
  onAction,
  disabled = false,
  showOverlay = false,
}: DropZoneOverlayProps) {
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  const depth = useRef(0);
  const busy = useRef(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const loadingFeedback = useRef<HTMLDivElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    // Removing the focused feedback node returns focus to body during this commit.
    const ownsFocus =
      document.activeElement === document.body ||
      feedback.current?.contains(document.activeElement);
    if (reading) loadingFeedback.current?.focus();
    else if (failed) {
      if (ownsFocus) retry.current?.focus();
    } else {
      const previous = previousFocus.current;
      previousFocus.current = null;
      if (ownsFocus && previous?.isConnected && !previous.closest("[inert]")) previous.focus();
    }
  }, [reading, failed]);
  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };
  useEffect(() => {
    if (!dragging) return;
    const clear = () => {
      depth.current = 0;
      setDragging(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    window.addEventListener("keydown", onEscape);
    window.addEventListener("dragend", clear);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("dragend", clear);
      window.removeEventListener("blur", clear);
    };
  }, [dragging]);
  async function accept(read: () => Promise<DroppedFiles> | DroppedFiles) {
    if (busy.current || disabled) return;
    // Keep the original target across failures and retries while the children stay mounted.
    if (!failed)
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    busy.current = true;
    setReading(true);
    setFailed(false);
    try {
      await onFiles(await read());
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setReading(false);
    }
  }
  return (
    <section
      className="su-drop-zone"
      aria-label={`Upload to ${folderName}`}
      aria-busy={reading}
      onDragEnter={(event) => {
        if (!disabled && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          depth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        if (!disabled && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        depth.current = Math.max(0, depth.current - 1);
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (depth.current === 0) reset();
      }}
      onDrop={(event) => {
        // A descendant drop target (e.g. a breadcrumb) that claimed the drop owns it.
        if (event.defaultPrevented) {
          reset();
          return;
        }
        if (disabled || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        reset();
        void accept(() =>
          readDrop(captureDrop(event.dataTransfer.items, event.dataTransfer.files)),
        );
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          reset();
          setFailed(false);
        }
      }}
    >
      {/* Pickers stay outside the inert region so Retry can still open them. */}
      <input
        ref={filesInput}
        id={`${id}-files`}
        aria-label="Choose files"
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void accept(() => filesFromPicker(files));
        }}
      />
      <input
        ref={folderInput}
        id={`${id}-folder`}
        aria-label="Choose folder"
        type="file"
        multiple
        hidden
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void accept(() => filesFromPicker(files));
        }}
      />
      <div inert={reading || failed}>
        <div className="su-actions su-drop-actions">
          <button
            className="su-button su-button-primary"
            type="button"
            disabled={disabled || reading}
            onClick={() => filesInput.current?.click()}
          >
            Upload files
          </button>
          <button
            className="su-button"
            type="button"
            disabled={disabled || reading}
            onClick={() => folderInput.current?.click()}
          >
            Upload folder
          </button>
        </div>
        {state && state.status !== "ready" ? (
          <SurfaceFeedback
            state={state}
            onAction={onAction ?? (() => filesInput.current?.click())}
          />
        ) : (
          children
        )}
      </div>
      {(reading || failed) && (
        <div ref={feedback} className="su-drop-feedback">
          {reading ? (
            <SurfaceFeedback ref={loadingFeedback} tabIndex={-1} state={{ status: "loading" }} />
          ) : (
            <div className="su-feedback" role="alert">
              <p>Can't read these files</p>
              <button
                ref={retry}
                className="su-button"
                type="button"
                onClick={() => filesInput.current?.click()}
              >
                Choose files again
              </button>
              <button className="su-button" type="button" onClick={() => setFailed(false)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
      <div className="su-drop-overlay" hidden={!(dragging || showOverlay) || disabled}>
        <Upload size={24} strokeWidth={1.5} aria-hidden="true" />
        <p>Drop to upload to {folderName}</p>
      </div>
      <p className="su-sr-only" role="status">
        {dragging ? `Drop to upload to ${folderName}` : ""}
      </p>
    </section>
  );
}
