// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex
"use client";
/** Upload dock (04-drive §4.1): the queue's progress, failures and retries. */

import { FileTypeIcon, IconButton, Progress, toast } from "@jeswr/suite-ui";
import { Check, ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDrive } from "../state/drive-context";
import { captureDriveFocusRemoval } from "../state/ui";

export function UploadDock() {
  const { uploads } = useDrive();
  const [collapsed, setCollapsed] = useState(false);
  const { tasks } = uploads;
  const active = tasks.filter((task) => task.status === "queued" || task.status === "uploading");
  const done = tasks.filter((task) => task.status === "done");
  const failed = tasks.filter((task) => task.status === "failed");
  const reported = useRef(new Set<string>());
  const reportedFailures = useRef(new Set<string>());
  const toggle = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLElement>(null);
  const restoreFocus = useRef<(() => void) | undefined>(undefined);
  // Status changes can remove Close or Retry without a click. Ref cleanup runs
  // before the DOM removal, while the displaced focus can still be captured.
  const restoreOnRemoval = useCallback((element: HTMLButtonElement | null) => {
    if (!element) return;
    return () => {
      if (document.activeElement !== element) return;
      const restore = captureDriveFocusRemoval(element);
      restoreFocus.current ??= () => {
        if (!element.isConnected) restore();
      };
    };
  }, []);
  useLayoutEffect(() => {
    const restore = restoreFocus.current;
    restoreFocus.current = undefined;
    restore?.();
  });

  // "Uploaded {n} files" once a batch settles.
  useEffect(() => {
    if (active.length > 0) return;
    const fresh = done.filter((task) => !reported.current.has(task.id));
    if (fresh.length === 0) return;
    for (const task of fresh) reported.current.add(task.id);
    const [first] = fresh;
    toast.success(
      fresh.length === 1 && first ? `Uploaded ${first.name}` : `Uploaded ${fresh.length} files`,
    );
  }, [active.length, done]);

  useEffect(() => {
    const current = new Set(failed.map((task) => task.id));
    for (const id of reportedFailures.current)
      if (!current.has(id)) reportedFailures.current.delete(id);
    for (const task of failed) {
      if (reportedFailures.current.has(task.id)) continue;
      reportedFailures.current.add(task.id);
      toast.error(`Couldn't upload ${task.name}: ${task.error ?? "Upload failed"}`);
    }
  }, [failed]);

  if (tasks.length === 0) return null;
  const progress =
    active.length > 0
      ? `Uploading ${active.length} ${active.length === 1 ? "item" : "items"}`
      : `${done.length} ${done.length === 1 ? "upload" : "uploads"} complete`;
  const title = failed.length
    ? `${progress}, ${failed.length} ${failed.length === 1 ? "upload" : "uploads"} failed`
    : progress;
  return (
    <section ref={dock} className="drv-dock" aria-label="Uploads">
      <header>
        <h2 aria-live="polite">{title}</h2>
        <IconButton
          ref={toggle}
          label={collapsed ? "Expand uploads" : "Collapse uploads"}
          variant="ghost"
          onClick={() => setCollapsed((on) => !on)}
        >
          {collapsed ? (
            <ChevronUp aria-hidden="true" size={18} />
          ) : (
            <ChevronDown aria-hidden="true" size={18} />
          )}
        </IconButton>
        {active.length === 0 ? (
          <IconButton
            ref={restoreOnRemoval}
            label="Close uploads"
            variant="ghost"
            onClick={() => {
              restoreFocus.current = captureDriveFocusRemoval(dock.current);
              uploads.clear();
            }}
          >
            <X aria-hidden="true" size={18} />
          </IconButton>
        ) : null}
      </header>
      {collapsed ? null : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id} data-status={task.status}>
              <FileTypeIcon name={task.name} size={20} decorative />
              <span className="drv-dock-name">
                {task.name}
                {task.error ? <span className="drv-dock-error">{task.error}</span> : null}
                {task.status === "skipped" ? <span className="drv-dock-error">Skipped</span> : null}
                {task.status === "conflict" ? (
                  <span className="drv-dock-error">Waiting for your choice</span>
                ) : null}
              </span>
              {task.status === "uploading" || task.status === "queued" ? (
                <Progress className="drv-dock-progress" aria-label={`Uploading ${task.name}`} />
              ) : null}
              {task.status === "done" ? (
                <Check aria-label="Uploaded" size={18} className="drv-dock-ok" />
              ) : null}
              {task.status === "failed" ? (
                <IconButton
                  ref={restoreOnRemoval}
                  label={`Retry ${task.name}`}
                  variant="ghost"
                  onClick={(event) => {
                    const restore = captureDriveFocusRemoval(event.currentTarget);
                    restoreFocus.current = () => restore(undefined, toggle.current);
                    uploads.retry(task.id);
                  }}
                >
                  <RotateCcw aria-hidden="true" size={16} />
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
