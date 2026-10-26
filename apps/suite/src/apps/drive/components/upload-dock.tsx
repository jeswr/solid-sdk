// AUTHORED-BY Claude Opus 5.5
"use client";
/** Upload dock (04-drive §4.1): the queue's progress, failures and retries. */

import { FileTypeIcon, IconButton, Progress, toast } from "@jeswr/suite-ui";
import { Check, ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDrive } from "../state/drive-context";

export function UploadDock() {
  const { uploads } = useDrive();
  const [collapsed, setCollapsed] = useState(false);
  const { tasks } = uploads;
  const active = tasks.filter((task) => task.status === "queued" || task.status === "uploading");
  const done = tasks.filter((task) => task.status === "done");
  const reported = useRef(new Set<string>());

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

  if (tasks.length === 0) return null;
  const title =
    active.length > 0
      ? `Uploading ${active.length} ${active.length === 1 ? "item" : "items"}`
      : `${done.length} ${done.length === 1 ? "upload" : "uploads"} complete`;
  return (
    <section className="drv-dock" aria-label="Uploads">
      <header>
        <h2 aria-live="polite">{title}</h2>
        <IconButton
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
          <IconButton label="Close uploads" variant="ghost" onClick={uploads.clear}>
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
                  label={`Retry ${task.name}`}
                  variant="ghost"
                  onClick={() => uploads.retry(task.id)}
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
