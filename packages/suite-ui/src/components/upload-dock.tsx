// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Check, ChevronDown, ChevronUp, File, Upload } from "lucide-react";
import { Progress } from "radix-ui";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { type UploadItem, uploadFailureCopy, uploadSummary } from "../uploads/queue.js";
import { SurfaceFeedback, type SurfaceState } from "./surface-state.js";

export interface UploadDockProps {
  items: readonly UploadItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  /** False when the transport cannot pause. Explain that capability beside the control. */
  canPause?: boolean;
  initiallyCollapsed?: boolean;
  state?: SurfaceState;
  onAction?: () => void;
  /** In-flow layout for fixture galleries; the default is the bottom-right dock. */
  inline?: boolean;
}
const statusCopy = {
  queued: "Queued",
  uploading: "Uploading",
  paused: "Paused",
  waiting: "Waiting for connection",
  done: "Uploaded",
  failed: "Upload failed",
  skipped: "Cancelled",
};
export function UploadDock({
  items,
  onPause,
  onResume,
  onCancel,
  onRetry,
  canPause = true,
  initiallyCollapsed = false,
  state,
  onAction,
  inline = false,
}: UploadDockProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const queue = useRef<HTMLElement>(null);
  const removedFocus = useRef<{
    element: HTMLButtonElement;
    index: number;
    control: "action" | "cancel";
  } | null>(null);
  function rememberFocus(
    element: HTMLButtonElement | null,
    index: number,
    control: "action" | "cancel",
  ) {
    if (!element) return;
    // React detaches refs before removing the DOM node and losing its activeElement.
    return () => {
      if (document.activeElement === element) removedFocus.current = { element, index, control };
    };
  }
  useLayoutEffect(() => {
    const previous = removedFocus.current;
    removedFocus.current = null;
    if (!previous || previous.element.isConnected || document.activeElement !== document.body)
      return;
    const rows = Array.from(queue.current?.querySelectorAll(".su-upload-item") ?? []);
    const next = [...rows.slice(previous.index + 1), ...rows.slice(0, previous.index)]
      .map((row) =>
        row.querySelector<HTMLButtonElement>(
          `[data-upload-control="${previous.control}"]:not(:disabled)`,
        ),
      )
      .find((button) => button !== null);
    (next ?? toggle.current)?.focus();
  });
  const summary = uploadSummary(items);
  const feedback = state ?? { status: items.length ? "ready" : "empty" };
  const collapse = () => {
    setCollapsed(true);
    toggle.current?.focus();
  };
  return (
    <aside
      className={`su-upload-dock ${inline ? "su-dock-inline" : ""} ${collapsed ? "su-dock-collapsed" : ""}`}
      aria-label="Uploads"
    >
      <p role="status" aria-live="polite" aria-atomic="true" className="su-sr-only">
        {summary}
      </p>
      <div className="su-dock-header">
        <Upload size={20} strokeWidth={1.75} aria-hidden="true" />
        <button
          ref={toggle}
          type="button"
          className="su-button su-dock-toggle"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? `${items.length} uploads` : "Uploads"}
          {collapsed ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
          <span className="su-sr-only">{collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>
      <section
        ref={queue}
        aria-label="Upload queue"
        id={panelId}
        hidden={collapsed}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            collapse();
          }
        }}
      >
        {feedback.status === "ready" ? (
          <>
            <p className="su-dock-summary su-muted">
              {items.filter((item) => item.status === "done").length} of {items.length} uploaded
            </p>
            <ul className="su-upload-list">
              {items.map((item, index) => {
                const percent =
                  item.total === 0
                    ? item.status === "done"
                      ? 100
                      : 0
                    : Math.round((item.sent / item.total) * 100);
                const active = ["queued", "uploading", "waiting"].includes(item.status);
                return (
                  <li key={item.id} className="su-upload-item">
                    <div className="su-upload-name">
                      {item.status === "done" ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <File size={16} aria-hidden="true" />
                      )}
                      <span title={item.name}>{item.name}</span>
                    </div>
                    <p className="su-muted">
                      {item.status === "failed"
                        ? uploadFailureCopy[item.error ?? "unknown"]
                        : statusCopy[item.status]}
                      {item.status === "uploading" ? ` · ${percent}%` : ""}
                    </p>
                    <Progress.Root
                      className="su-progress"
                      value={percent}
                      aria-label={`Upload ${item.name}`}
                    >
                      <Progress.Indicator
                        className="su-progress-fill"
                        style={{ width: `${percent}%` }}
                      />
                    </Progress.Root>
                    <div className="su-actions">
                      {(active || item.status === "paused" || item.status === "failed") && (
                        <button
                          ref={(element) => rememberFocus(element, index, "action")}
                          data-upload-control="action"
                          type="button"
                          className="su-button"
                          aria-label={`${item.status === "paused" ? "Resume" : item.status === "failed" ? "Retry" : "Pause"} ${item.name}`}
                          disabled={active && !canPause}
                          onClick={() =>
                            item.status === "paused"
                              ? onResume(item.id)
                              : item.status === "failed"
                                ? onRetry(item.id)
                                : onPause(item.id)
                          }
                        >
                          {item.status === "paused"
                            ? "Resume"
                            : item.status === "failed"
                              ? "Retry"
                              : "Pause"}
                        </button>
                      )}
                      {!["done", "skipped"].includes(item.status) && (
                        <button
                          ref={(element) => rememberFocus(element, index, "cancel")}
                          data-upload-control="cancel"
                          type="button"
                          className="su-button"
                          aria-label={`Cancel ${item.name}`}
                          onClick={() => {
                            onCancel(item.id);
                            toggle.current?.focus();
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    {active && !canPause && (
                      <p className="su-muted">Pausing is not available on this storage</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <SurfaceFeedback state={feedback} onAction={onAction} />
        )}
      </section>
    </aside>
  );
}
