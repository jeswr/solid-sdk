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
import { useNotesContext } from "../state/notes-context";
import { ColourPicker, LabelChips, LabelPicker } from "./controls";

const captureKey = "notes-capture-draft";
const captureDraft = z.object({
  webId: z.string(),
  title: z.string(),
  body: z.string(),
  items: z.array(z.object({ text: z.string(), checked: z.boolean() })).optional(),
  labels: z.array(z.string()),
  pinned: z.boolean(),
  colour: NoteColour,
  error: z.string().optional(),
});

export function CaptureBar({ label }: { label?: string }) {
  const { create, session } = useNotesContext();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [items, setItems] = useState<ChecklistItem[] | undefined>();
  const [labels, setLabels] = useState<string[]>(label ? [label] : []);
  const [pinned, setPinned] = useState(false);
  const [colour, setColour] = useState<NoteColour>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const recovery = useRef<string | null>(null);
  const captureSnapshot = useRef<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const captureText = expanded
    ? JSON.stringify({ webId: session.webId, title, body, items, labels, pinned, colour, error })
    : null;
  captureSnapshot.current = captureText;
  const persistCapture = useCallback(() => {
    clearTimeout(persistTimer.current);
    const text = captureSnapshot.current;
    if (text === null) return;
    try {
      localStorage.setItem(captureKey, text);
      recovery.current = text;
    } catch {
      // The mounted form still retains its text if browser storage is full.
    }
  }, []);
  const submitted = useRef(false);
  const mounted = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const opening = useRef<HTMLInputElement>(null);
  const latestClose = useRef(() => {});
  const finish = async () => {
    if (submitted.current) return;
    let input: ReturnType<typeof captureToNote>;
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
          });
          localStorage.setItem(captureKey, text);
          recovery.current = text;
        } catch {
          // The mounted form still retains its text if browser storage is full.
        }
        submitted.current = false;
        if (mounted.current) {
          setBusy(false);
          setError(message);
        }
        toast.error(message, {
          action: { label: "Retry", onClick: () => void latestClose.current() },
        });
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
    }
    if (!mounted.current) return;
    setExpanded(false);
    setTitle("");
    setBody("");
    setItems(undefined);
    setLabels(label ? [label] : []);
    setPinned(false);
    setColour("default");
    setBusy(false);
    setError(undefined);
    submitted.current = false;
  };
  latestClose.current = finish;
  useEffect(() => {
    try {
      const text = localStorage.getItem(captureKey);
      const saved = captureDraft.parse(JSON.parse(text ?? "null"));
      if (saved.webId === session.webId) {
        recovery.current = text;
        setTitle(saved.title);
        setBody(saved.body);
        setItems(saved.items);
        setLabels(saved.labels);
        setPinned(saved.pinned);
        setColour(saved.colour);
        setError(saved.error);
        setExpanded(true);
      }
    } catch {
      // Empty, invalid or unavailable storage leaves a fresh capture form.
    }
  }, [session.webId]);
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
            ref={opening}
            aria-label="Take a note"
            placeholder="Take a note…"
            onFocus={() => setExpanded(true)}
          />
          <IconButton
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
