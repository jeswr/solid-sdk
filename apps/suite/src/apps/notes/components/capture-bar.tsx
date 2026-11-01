// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { Button, IconButton, Input, toast } from "@jeswr/suite-ui";
import { ListTodo, Pin, PinOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { ChecklistItem } from "../lib/capture";
import { NoteColour } from "../lib/model/prefs";
import { captureTitle, captureToNote, escapeHtml } from "../lib/ui/capture";
import { getPendingDrafts, heartbeatLive } from "../state/draft-registry";
import { useNotesContext } from "../state/notes-context";
import { ColourPicker, LabelChips, LabelPicker } from "./controls";

const capturePrefix = "notes-capture-draft";
const submitting = new Set<string>();
const MAYBE_SAVED =
  "This note may already have been saved before the page closed. Check your notes before adding it again.";
const recovering = new Set<string>();
const captureSettled = "notes-capture-settled";
const captureRetry = "notes-capture-retry";
const captureDraft = z.object({
  webId: z.string(),
  title: z.string(),
  body: z.string(),
  items: z.array(z.object({ text: z.string(), checked: z.boolean() })).optional(),
  labels: z.array(z.string()),
  pinned: z.boolean(),
  colour: NoteColour,
  error: z.string().optional(),
  tabId: z.string().optional(),
  updatedAt: z.number().finite().optional(),
  submitting: z.boolean().optional(),
  /** Its create may have reached the pod before the page closed: never save it without asking. */
  maybeSaved: z.boolean().optional(),
});

/** Whether the kept draft is still the text a failed save stored; unreadable storage counts as unchanged. */
function keptUnchanged(key: string, kept: string | null) {
  try {
    return localStorage.getItem(key) === kept;
  } catch {
    return true;
  }
}

export function CaptureBar({ label }: { label?: string }) {
  const { create, session } = useNotesContext();
  const createNote = useRef(create);
  createNote.current = create;
  const { tabId } = getPendingDrafts(session.webId);
  const captureKey = `${capturePrefix}:${tabId}`;
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [items, setItems] = useState<ChecklistItem[] | undefined>();
  const [labels, setLabels] = useState<string[]>(label ? [label] : []);
  const [pinned, setPinned] = useState(false);
  const [colour, setColour] = useState<NoteColour>("default");
  const [busy, setBusy] = useState(() => submitting.has(captureKey));
  const [error, setError] = useState<string>();
  const [maybeSaved, setMaybeSaved] = useState(false);
  const recovery = useRef<string | null>(null);
  const captureSnapshot = useRef<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const captureText = expanded
    ? JSON.stringify({
        webId: session.webId,
        title,
        body,
        items,
        labels,
        pinned,
        colour,
        error,
        tabId,
        submitting: busy,
        maybeSaved,
      })
    : null;
  captureSnapshot.current = captureText;
  const persistCapture = useCallback(() => {
    clearTimeout(persistTimer.current);
    const text = captureSnapshot.current;
    if (text === null) return;
    try {
      const record = JSON.stringify({
        ...JSON.parse(text),
        updatedAt: Date.now(),
        submitting: submitting.has(captureKey),
      });
      localStorage.setItem(captureKey, record);
      recovery.current = record;
    } catch {
      // The mounted form still retains its text if browser storage is full.
    }
  }, [captureKey]);
  const submitted = useRef(false);
  const mounted = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const opening = useRef<HTMLInputElement>(null);
  const latestClose = useRef(() => {});
  const finish = async (confirmed = false) => {
    if (submitted.current || submitting.has(captureKey)) return;
    if (maybeSaved && !confirmed) {
      // Closing must not create a capture that may already exist: keep it
      // stored and the bar open (a collapsed bar never holds text) until the
      // user picks Save anyway or Discard.
      persistCapture();
      return;
    }
    let input: ReturnType<typeof captureToNote>;
    let settled = false;
    try {
      input = captureToNote(title, body, items);
    } catch {
      if (mounted.current) {
        toast.error("Couldn't capture this text. Check the checklist markers and try again.");
        return;
      }
      // Navigation has removed the form. Preserve unsupported syntax literally
      // in the HTML-backed note rather than asking for an inaccessible edit.
      const raw = title ? `${title}\n${body}` : body;
      input = {
        title: captureTitle(raw.split(/\r?\n/)[0] as string),
        body: raw
          .split(/\r?\n/)
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join(""),
      };
    }
    if (input) {
      const saved = { ...input, labels };
      submitted.current = true;
      submitting.add(captureKey);
      persistCapture();
      if (mounted.current) setBusy(true);
      try {
        await create(saved, pinned, colour);
      } catch {
        const message = "Couldn't create your note. Your text has been kept.";
        try {
          const text = JSON.stringify({
            webId: session.webId,
            title,
            body,
            items,
            labels,
            pinned,
            colour,
            error: message,
            tabId,
            updatedAt: Date.now(),
            submitting: false,
          });
          localStorage.setItem(captureKey, text);
          recovery.current = text;
        } catch {
          // The mounted form still retains its text if browser storage is full.
        }
        submitted.current = false;
        submitting.delete(captureKey);
        if (mounted.current) {
          setBusy(false);
          setError(message);
        }
        toast.error(message, {
          action: {
            label: "Retry",
            onClick: () => {
              const detail = { key: captureKey, webId: session.webId, handled: false };
              window.dispatchEvent(new CustomEvent(captureRetry, { detail }));
              // No capture bar is mounted for this key: retry from this closure, but
              // only while the kept text is still the one this failure stored
              // (a later bar may already have saved or replaced it).
              if (!detail.handled && keptUnchanged(captureKey, recovery.current))
                void finish(confirmed);
            },
          },
        });
        window.dispatchEvent(new CustomEvent(captureSettled, { detail: captureKey }));
        return;
      }
      captureSnapshot.current = null;
      clearTimeout(persistTimer.current);
      try {
        if (recovery.current !== null && localStorage.getItem(captureKey) === recovery.current)
          localStorage.removeItem(captureKey);
      } catch {
        // A successful pod write does not depend on browser storage cleanup.
      }
      submitting.delete(captureKey);
      settled = true;
    } else if (confirmed) {
      // "Save anyway" on an emptied capture: nothing to create, nothing to keep.
      clearTimeout(persistTimer.current);
      captureSnapshot.current = null;
      try {
        localStorage.removeItem(captureKey);
      } catch {
        // Nothing stored to remove.
      }
    }
    // Announce settlement only after this form has reset, so a capture that
    // restore() recovers into the bar is not wiped by the reset below.
    const announce = () => {
      if (settled) window.dispatchEvent(new CustomEvent(captureSettled, { detail: captureKey }));
    };
    if (!mounted.current) {
      announce();
      return;
    }
    setExpanded(false);
    setTitle("");
    setBody("");
    setItems(undefined);
    setLabels(label ? [label] : []);
    setPinned(false);
    setColour("default");
    setBusy(false);
    setError(undefined);
    setMaybeSaved(false);
    submitted.current = false;
    announce();
  };
  latestClose.current = finish;
  useEffect(() => {
    const removeExact = (key: string, text: string) => {
      if (localStorage.getItem(key) === text) localStorage.removeItem(key);
    };
    const restore = () => {
      const inFlight = submitting.has(captureKey);
      setBusy(inFlight);
      if (inFlight) return;
      try {
        // Migrate once to a durable orphan slot without overwriting this tab's draft.
        const legacy = localStorage.getItem(capturePrefix);
        let legacyDraft = captureDraft.safeParse(undefined);
        try {
          legacyDraft = captureDraft.safeParse(JSON.parse(legacy ?? "null"));
        } catch {
          // Invalid legacy text must not hide per-tab drafts.
        }
        if (legacyDraft.success && legacyDraft.data.webId === session.webId) {
          const id = crypto.randomUUID();
          localStorage.setItem(
            `${capturePrefix}:${id}`,
            JSON.stringify({
              ...legacyDraft.data,
              tabId: id,
              updatedAt: 0,
            }),
          );
          removeExact(capturePrefix, legacy as string);
        }
        const drafts: { key: string; text: string; saved: z.infer<typeof captureDraft> }[] = [];
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith(`${capturePrefix}:`) || submitting.has(key) || recovering.has(key))
            continue;
          try {
            const text = localStorage.getItem(key) as string;
            const saved = captureDraft.parse(JSON.parse(text));
            if (saved.webId !== session.webId || key !== `${capturePrefix}:${saved.tabId}`)
              continue;
            if (
              key !== captureKey &&
              heartbeatLive(localStorage, saved.tabId as string, Date.now())
            )
              continue;
            drafts.push({ key, text, saved });
          } catch {
            // A damaged or foreign draft cannot hide valid captures.
          }
        }
        drafts.sort((a, b) => (b.saved.updatedAt ?? 0) - (a.saved.updatedAt ?? 0));
        const newest = drafts.shift();
        if (newest) {
          const { saved } = newest;
          const own = drafts.find((draft) => draft.key === captureKey);
          if (own) {
            // Free this tab's slot only after its older text has a durable home.
            const id = crypto.randomUUID();
            const key = `${capturePrefix}:${id}`;
            const text = JSON.stringify({ ...own.saved, tabId: id });
            localStorage.setItem(key, text);
            removeExact(own.key, own.text);
            own.key = key;
            own.text = text;
          }
          // Copy before removing an orphan so the restored form remains durable.
          const flagged = Boolean(saved.submitting || saved.maybeSaved);
          const text = JSON.stringify({ ...saved, tabId, submitting: false, maybeSaved: flagged });
          localStorage.setItem(captureKey, text);
          if (newest.key !== captureKey) removeExact(newest.key, newest.text);
          recovery.current = text;
          setTitle(saved.title);
          setBody(saved.body);
          setItems(saved.items);
          setLabels(saved.labels);
          setPinned(saved.pinned);
          setColour(saved.colour);
          // The page closed while this capture's create was in flight; it may exist already.
          setMaybeSaved(flagged);
          setError(flagged ? MAYBE_SAVED : saved.error);
          setExpanded(true);
        }
        for (const orphan of drafts) {
          // Never auto-create a capture that may already have been saved; it
          // waits to be offered in the bar with a warning.
          if (orphan.saved.submitting || orphan.saved.maybeSaved) continue;
          recovering.add(orphan.key);
          // Preserve checklist syntax literally; recovery must not reject unique text.
          const raw = [
            orphan.saved.title,
            orphan.saved.body,
            ...(orphan.saved.items ?? []).map(
              (item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`,
            ),
          ]
            .filter(Boolean)
            .join("\n");
          void createNote
            .current(
              {
                title: captureTitle(raw.split(/\r?\n/)[0] as string),
                body: raw
                  .split(/\r?\n/)
                  .map((line) => `<p>${escapeHtml(line)}</p>`)
                  .join(""),
                labels: orphan.saved.labels,
              },
              orphan.saved.pinned,
              orphan.saved.colour,
            )
            .then(() => removeExact(orphan.key, orphan.text))
            .catch(() => {
              /* Keep failed recoveries for the next mount. */
            })
            .finally(() => recovering.delete(orphan.key));
        }
      } catch {
        // Empty, invalid or unavailable storage leaves a fresh capture form.
      }
    };
    restore();
    const settled = (event: Event) => {
      if ((event as CustomEvent<string>).detail === captureKey) restore();
    };
    const retry = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; webId: string; handled: boolean }>)
        .detail;
      if (detail.key !== captureKey || detail.webId !== session.webId) return;
      detail.handled = true;
      void latestClose.current();
    };
    window.addEventListener(captureSettled, settled);
    window.addEventListener(captureRetry, retry);
    return () => {
      window.removeEventListener(captureSettled, settled);
      window.removeEventListener(captureRetry, retry);
    };
  }, [session.webId, captureKey, tabId]);
  useEffect(() => {
    if (captureText === null) return;
    persistTimer.current = setTimeout(persistCapture, 200);
    return () => clearTimeout(persistTimer.current);
  }, [captureText, persistCapture]);
  const latestPersist = useRef(persistCapture);
  latestPersist.current = persistCapture;
  useEffect(() => {
    const flush = () => latestPersist.current();
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      flush();
      removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void latestClose.current();
    };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target.closest("input,textarea,select,[contenteditable=true],[role=dialog]")
      )
        return;
      if (event.key === "c") {
        event.preventDefault();
        (
          opening.current ??
          root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea, input")
        )?.focus();
      }
    };
    addEventListener("keydown", shortcut);
    return () => removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (expanded)
      root.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          '[aria-label="List item 1"], textarea',
        )
        ?.focus();
  }, [expanded]);
  const contains = useCallback(
    (target: EventTarget | null) =>
      target instanceof Element &&
      (root.current?.contains(target) ||
        target.closest('[data-slot="popover-content"], [data-slot="tooltip-content"]')),
    [],
  );
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!contains(event.target)) latestClose.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        latestClose.current();
        (
          opening.current ??
          root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea, input")
        )?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [expanded, contains]);
  return (
    <div
      ref={root}
      className="notes-capture"
      data-note-colour={colour}
      data-expanded={expanded || undefined}
    >
      {!expanded ? (
        <div className="notes-capture-collapsed">
          <Input
            disabled={busy}
            ref={opening}
            aria-label="Take a note"
            placeholder="Take a note…"
            onFocus={() => setExpanded(true)}
          />
          <IconButton
            disabled={busy}
            label="New list"
            variant="ghost"
            onClick={() => {
              setItems([{ text: "", checked: false }]);
              setExpanded(true);
            }}
          >
            <ListTodo size={22} aria-hidden="true" />
          </IconButton>
        </div>
      ) : (
        <>
          {error && <p role="alert">{error}</p>}
          <Input
            disabled={busy}
            className="notes-title-input"
            aria-label="Note title"
            placeholder="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {items ? (
            <div className="notes-capture-list">
              {items.map((item, index) => (
                <div key={`capture-row-${index.toString()}`}>
                  <input
                    disabled={busy}
                    type="checkbox"
                    aria-label={`Complete item ${index + 1}`}
                    checked={item.checked}
                    onChange={() =>
                      setItems(
                        items.map((row, i) =>
                          i === index ? { ...row, checked: !row.checked } : row,
                        ),
                      )
                    }
                  />
                  <Input
                    disabled={busy}
                    aria-label={`List item ${index + 1}`}
                    placeholder="List item"
                    value={item.text}
                    onChange={(event) =>
                      setItems(
                        items.map((row, i) =>
                          i === index ? { ...row, text: event.target.value } : row,
                        ),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        setItems([
                          ...items.slice(0, index + 1),
                          { text: "", checked: false },
                          ...items.slice(index + 1),
                        ]);
                        requestAnimationFrame(() =>
                          root.current
                            ?.querySelector<HTMLInputElement>(
                              `[aria-label="List item ${index + 2}"]`,
                            )
                            ?.focus(),
                        );
                      }
                    }}
                  />
                </div>
              ))}
              <Button
                disabled={busy}
                variant="ghost"
                onClick={() => setItems([...items, { text: "", checked: false }])}
              >
                Add item
              </Button>
            </div>
          ) : (
            <textarea
              disabled={busy}
              className="notes-capture-body"
              aria-label="Note text"
              placeholder="Take a note…"
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          )}
          <LabelChips links={false} labels={labels} />
          <div className="notes-capture-footer">
            <IconButton
              disabled={busy}
              label={pinned ? "Unpin note" : "Pin note"}
              variant="ghost"
              aria-pressed={pinned}
              onClick={() => setPinned(!pinned)}
            >
              {pinned ? (
                <PinOff size={18} aria-hidden="true" />
              ) : (
                <Pin size={18} aria-hidden="true" />
              )}
            </IconButton>
            <ColourPicker value={colour} onChange={setColour} disabled={busy} />
            <LabelPicker value={labels} onChange={setLabels} disabled={busy} />
            {maybeSaved && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    try {
                      localStorage.removeItem(captureKey);
                    } catch {
                      // Nothing stored to discard.
                    }
                    captureSnapshot.current = null;
                    clearTimeout(persistTimer.current);
                    setExpanded(false);
                    setTitle("");
                    setBody("");
                    setItems(undefined);
                    setLabels(label ? [label] : []);
                    setPinned(false);
                    setColour("default");
                    setError(undefined);
                    setMaybeSaved(false);
                  }}
                >
                  Discard
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => void finish(true)}>
                  Save anyway
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              className="notes-close-capture"
              disabled={busy}
              onClick={() => void finish()}
            >
              Close
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
