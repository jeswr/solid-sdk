// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, IconButton, Input, toast } from "@jeswr/suite-ui";
import { ListTodo, Pin, PinOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChecklistItem } from "../lib/capture";
import type { NoteColour } from "../lib/model/prefs";
import { captureToNote } from "../lib/ui/capture";
import { useNotesContext } from "../state/notes-context";
import { ColourPicker, LabelChips, LabelPicker } from "./controls";

export function CaptureBar({ label }: { label?: string }) {
  const { create, attempt } = useNotesContext();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [items, setItems] = useState<ChecklistItem[] | undefined>();
  const [labels, setLabels] = useState<string[]>(label ? [label] : []);
  const [pinned, setPinned] = useState(false);
  const [colour, setColour] = useState<NoteColour>("default");
  const root = useRef<HTMLDivElement>(null);
  const opening = useRef<HTMLInputElement>(null);
  const latestClose = useRef(() => {});
  const finish = () => {
    let input: ReturnType<typeof captureToNote>;
    try {
      input = captureToNote(title, body, items);
    } catch {
      toast.error("Couldn't capture this text. Check the checklist markers and try again.");
      return;
    }
    if (input) {
      const saved = { ...input, labels };
      attempt(() => create(saved, pinned, colour), "Couldn't create your note");
    }
    setExpanded(false);
    setTitle("");
    setBody("");
    setItems(undefined);
    setLabels(label ? [label] : []);
    setPinned(false);
    setColour("default");
  };
  latestClose.current = finish;
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
          <Input
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
                variant="ghost"
                onClick={() => setItems([...items, { text: "", checked: false }])}
              >
                Add item
              </Button>
            </div>
          ) : (
            <textarea
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
            <ColourPicker value={colour} onChange={setColour} />
            <LabelPicker value={labels} onChange={setLabels} />
            <Button variant="ghost" className="notes-close-capture" onClick={finish}>
              Close
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
