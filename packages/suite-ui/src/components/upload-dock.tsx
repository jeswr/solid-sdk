// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
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
  const viewport = useRef<HTMLElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; control: "action" | "cancel" } | null>(null);
  const feedback = state ?? { status: items.length ? "ready" : "empty" };
  const focusedIndex = items.findIndex((item) => item.id === focusedId);
  const virtual = useVirtualizer({
    count: collapsed || feedback.status !== "ready" ? 0 : items.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 144,
    overscan: 5,
    getItemKey: (index) => items[index]?.id ?? index,
    initialRect: { width: 400, height: 400 },
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      // Pointer scrolling must not unmount the control that owns keyboard focus.
      if (focusedIndex >= 0 && focusedIndex < range.count && !indexes.includes(focusedIndex))
        indexes.push(focusedIndex);
      return indexes.sort((a, b) => a - b);
    },
  });
  function available(item: UploadItem, control: "action" | "cancel") {
    if (control === "cancel") return !["done", "skipped"].includes(item.status);
    return (
      item.status === "paused" ||
      item.status === "failed" ||
      (canPause && ["queued", "uploading", "waiting"].includes(item.status))
    );
  }
  const virtualRows = virtual.getVirtualItems();
  const hasMountedControls = virtualRows.some(({ index }) => {
    const item = items[index];
    return item && (available(item, "action") || available(item, "cancel"));
  });
  function buttonAt(index: number, control: "action" | "cancel") {
    return queue.current?.querySelector<HTMLButtonElement>(
      `[data-upload-index="${index}"] [data-upload-control="${control}"]:not(:disabled)`,
    );
  }
  function focusRow(index: number, control: "action" | "cancel", direction: number) {
    for (let next = index; next >= 0 && next < items.length; next += direction) {
      const item = items[next];
      if (!item) continue;
      const target = available(item, control)
        ? control
        : control === "action"
          ? "cancel"
          : "action";
      if (!available(item, target)) continue;
      pendingFocus.current = { id: item.id, control: target };
      setFocusedId(item.id);
      virtual.scrollToIndex(next, { align: "auto" });
      const button = buttonAt(next, target);
      if (button) {
        pendingFocus.current = null;
        button.focus({ preventScroll: true });
      }
      return true;
    }
    return false;
  }
  const removedFocus = useRef<{
    element: HTMLButtonElement;
    id: string;
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
      if (document.activeElement === element)
        removedFocus.current = { element, id: items[index]?.id ?? "", index, control };
    };
  }
  useLayoutEffect(() => {
    const previous = removedFocus.current;
    removedFocus.current = null;
    const pending = pendingFocus.current;
    if (pending) {
      const index = items.findIndex((item) => item.id === pending.id);
      const button = buttonAt(index, pending.control);
      if (button) {
        pendingFocus.current = null;
        button.focus({ preventScroll: true });
      }
      return;
    }
    if (!previous || previous.element.isConnected || document.activeElement !== document.body)
      return;
    const start = items[previous.index]?.id === previous.id ? previous.index + 1 : previous.index;
    // Completion can remove a focused control beyond the current virtual window.
    for (let offset = 0; offset < items.length; offset++) {
      const index = (start + offset) % items.length;
      const item = items[index];
      if (!item || item.id === previous.id || !available(item, previous.control)) continue;
      focusRow(index, previous.control, 1);
      return;
    }
    toggle.current?.focus();
  });
  const summary = uploadSummary(items);
  const collapse = () => {
    pendingFocus.current = null;
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
        onFocusCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>("[data-upload-id]");
          if (row) setFocusedId(row.dataset.uploadId ?? null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            collapse();
            return;
          }
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const target = event.target as HTMLElement;
          const row = target.closest<HTMLElement>("[data-upload-index]");
          if (!row && target !== viewport.current) return;
          const backwards = event.key === "ArrowUp" || event.key === "End";
          // From the viewport, start navigation at the corresponding end of the queue.
          const index = row ? Number(row.dataset.uploadIndex) : backwards ? items.length : -1;
          const control = target.dataset.uploadControl === "cancel" ? "cancel" : "action";
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            const moved = focusRow(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : index + (backwards ? -1 : 1),
              control,
              backwards ? -1 : 1,
            );
            // A queue without controls still needs native viewport scrolling.
            if (row || moved) event.preventDefault();
          } else if (event.key === "Tab" && row) {
            const buttons = row.querySelectorAll("button:not(:disabled)");
            if (target !== (event.shiftKey ? buttons[0] : buttons[buttons.length - 1])) return;
            if (
              focusRow(
                index + (event.shiftKey ? -1 : 1),
                event.shiftKey ? "cancel" : "action",
                event.shiftKey ? -1 : 1,
              )
            )
              event.preventDefault();
          }
        }}
      >
        {!collapsed &&
          (feedback.status === "ready" ? (
            <>
              <p className="su-dock-summary su-muted">
                {items.filter((item) => item.status === "done").length} of {items.length} uploaded
              </p>
              <section
                ref={viewport}
                className="su-upload-scroll"
                aria-label="Upload files"
                // Mounted controls provide entry; otherwise the viewport must be reachable.
                tabIndex={hasMountedControls ? -1 : 0}
              >
                <ul
                  className="su-upload-list"
                  style={{ height: virtual.getTotalSize(), position: "relative" }}
                >
                  {virtualRows.map((virtualRow) => {
                    const index = virtualRow.index;
                    const item = items[index];
                    if (!item) return null;
                    const percent =
                      item.total === 0
                        ? item.status === "done"
                          ? 100
                          : 0
                        : Math.round((item.sent / item.total) * 100);
                    const active = ["queued", "uploading", "waiting"].includes(item.status);
                    return (
                      <li
                        key={item.id}
                        ref={virtual.measureElement}
                        data-index={index}
                        data-upload-index={index}
                        data-upload-id={item.id}
                        aria-setsize={items.length}
                        aria-posinset={index + 1}
                        className="su-upload-item"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
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
              </section>
            </>
          ) : (
            <SurfaceFeedback state={feedback} onAction={onAction} />
          ))}
      </section>
    </aside>
  );
}
