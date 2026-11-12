// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";

import { Button, toast } from "@jeswr/suite-ui";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { EndpointCapture } from "../lib/client/access";
import { DriveError, type DriveItem } from "../lib/client/client";
import { discoveryOptions, type ResourceAssertion } from "../lib/client/commit";
import { isOwnStorage } from "../lib/client/ownership";
import { textGuard } from "../lib/offline/guards";
import { useDrive } from "../state/drive-context";
import { useDriveOutbox } from "../state/outbox";
import { useDriveUi } from "../state/ui";

export interface PreviewText {
  text: string;
  truncated: boolean;
  etag?: string | undefined;
  contentType?: string | undefined;
  writable?: boolean | undefined;
  editableEncoding?: boolean | undefined;
  declaredCharset?: boolean | undefined;
  verifyHeaders?: ResourceAssertion["verifyHeaders"] | undefined;
  /** The same discovery as JSON, so a save queued offline replays with the same check. */
  discovery?: EndpointCapture | undefined;
}

/** Retain the opened version and local edits across background preview refreshes. */
export function TextPreview({
  item,
  value,
  fallback,
  reload,
  onEditingChange,
  resourceChanged = false,
}: {
  item: DriveItem;
  value: PreviewText | undefined;
  fallback: ReactNode;
  reload: () => void;
  onEditingChange?: (editing: boolean) => void;
  resourceChanged?: boolean;
}) {
  const { client, session, invalidate } = useDrive();
  const { registerPreviewGuard } = useDriveUi();
  const storage = useDriveOutbox(session);
  const [local, setLocal] = useState<PreviewText>();
  const [saved, setSaved] = useState<PreviewText>();
  const [editing, setEditing] = useState(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  const savedAgainst = useRef(value);
  // Ignore the pre-save GET while keeping the write receipt. A subsequent read
  // supersedes it, including equivalent reads carrying the saved ETag.
  const refreshed = saved && (!value || value === savedAgainst.current) ? saved : value;
  const current = local ?? refreshed;
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const edit = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);
  const live = useRef(true);
  const busy = useRef(false);
  const label = useId();
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const dirty = editing && draft !== current?.text.replace(/\r\n/g, "\n");
  const changed = conflict || (editing && resourceChanged);
  useLayoutEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);
  useEffect(() => {
    if (editing && resourceChanged) setConflict(true);
  }, [editing, resourceChanged]);
  useEffect(() => {
    if (saved && value && value !== savedAgainst.current) setSaved(undefined);
  }, [saved, value]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useLayoutEffect(
    () =>
      registerPreviewGuard(
        () => !busy.current && (!dirty || window.confirm("Discard your changes?")),
      ),
    [registerPreviewGuard, dirty],
  );
  useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, saving]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    if (editing) textarea.current?.focus();
    else if (current && restoreFocus.current && edit.current) {
      edit.current.focus();
      restoreFocus.current = false;
    }
  }, [editing, current]);

  if (!current) return fallback;
  const writable =
    current.writable === true &&
    current.editableEncoding === true &&
    !current.truncated &&
    item.kind === "file" &&
    (item.size ?? 0) <= 1024 * 1024 &&
    isOwnStorage(item.url, session.storageUrl) &&
    (current.contentType === "text/plain" || current.contentType === "text/markdown");
  const etag = current.etag;
  const strong = etag !== undefined && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
  const noValidator = "Reload this file to get a current version before saving.";
  // Offline, a save queues only when Drive can replay it with the captured discovery.
  const queueable = !!storage && !!current.discovery;
  const disabledReason =
    !online && !queueable
      ? "You're offline. Reconnect to save."
      : !strong
        ? noValidator
        : undefined;
  const finish = () => {
    restoreFocus.current = true;
    setEditing(false);
    setError(undefined);
    setConflict(false);
  };
  const cancel = () => {
    if (busy.current) return;
    if (dirty && !window.confirm("Discard your changes?")) return;
    setLocal(undefined);
    finish();
  };
  const save = async () => {
    const offline = navigator.onLine === false;
    if (!writable || !strong || (offline && !queueable) || busy.current || changed) return;
    busy.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const contentType = `${current.contentType}${current.declaredCharset ? "; charset=utf-8" : ""}`;
      const text = current.text.includes("\r\n") ? draft.replace(/\n/g, "\r\n") : draft;
      // Queue through the shell outbox; replay runs Drive's same guarded write with the
      // captured discovery and If-Match (sst-8xm.74.1).
      const queue = async () => {
        const result = await (storage as NonNullable<typeof storage>).write(item.url, text, {
          contentType,
          ifMatch: etag,
          offline: "queue",
          guard: textGuard(current.discovery as EndpointCapture),
        });
        return {
          etag: result.queued ? undefined : (result.etag ?? undefined),
          queued: !!result.queued,
        };
      };
      let result: { etag?: string | undefined; queued: boolean };
      if (offline) result = await queue();
      else {
        try {
          result = {
            ...(await client.write(
              item.url,
              text,
              { contentType, ifMatch: etag, ...discoveryOptions(current) },
              { kind: "protect-ancestors" },
            )),
            queued: false,
          };
        } catch (cause) {
          // Only a fetch that never got an HTTP answer may be queued.
          if (!(cause instanceof TypeError) || !queueable) throw cause;
          result = await queue();
        }
      }
      if (!live.current) {
        return;
      }
      savedAgainst.current = latestValue.current;
      // A queued save has no version yet; the next edit needs a fresh read.
      setSaved({ ...current, text, etag: result.etag });
      setLocal(undefined);
      finish();
      toast.success(
        result.queued ? "Saved on this device. It will sync when you're back online." : "Saved",
      );
      if (!result.queued) invalidate(item.url);
    } catch (cause) {
      if (!live.current) return;
      if (cause instanceof DriveError && cause.status === 412) {
        setConflict(true);
        setError("This file changed since you opened it");
      } else setError("Couldn't save this file. Your changes are still here.");
    } finally {
      busy.current = false;
      if (live.current) setSaving(false);
    }
  };

  return (
    <div className="drv-preview-scroll">
      {editing ? (
        <form
          data-drive-text-editor
          aria-label={`Edit ${item.name}`}
          className="drv-text-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
        >
          <label htmlFor={label}>Edit {item.name}</label>
          <textarea
            ref={textarea}
            id={label}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
          />
          {disabledReason ? <p id={`${label}-reason`}>{disabledReason}</p> : null}
          {changed || error ? (
            <p role="alert">{changed ? "This file changed since you opened it" : error}</p>
          ) : null}
          <div className="drv-text-editor-actions">
            <Button
              disabled={!strong || (!online && !queueable) || saving || changed}
              aria-describedby={disabledReason ? `${label}-reason` : undefined}
              type="submit"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={cancel}>
              Cancel
            </Button>
            {changed || !strong ? (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  if (dirty && !window.confirm("Discard your changes and reload?")) return;
                  setLocal(undefined);
                  setSaved(undefined);
                  finish();
                  reload();
                }}
              >
                Reload
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          {writable ? (
            <Button
              ref={edit}
              variant="outline"
              size="sm"
              onClick={() => {
                setLocal(current);
                setDraft(current.text.replace(/\r\n/g, "\n"));
                setEditing(true);
              }}
            >
              Edit
            </Button>
          ) : null}
          <pre className="drv-preview-text">{current.text}</pre>
          {current.truncated ? <p className="drv-preview-note">Showing the first 1 MB.</p> : null}
        </>
      )}
    </div>
  );
}
