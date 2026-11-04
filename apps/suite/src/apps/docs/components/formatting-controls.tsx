// AUTHORED-BY Codex
"use client";
import { Button, IconButton, Popover, PopoverAnchor, PopoverContent } from "@jeswr/suite-ui";
import type { Editor } from "@tiptap/react";
import { Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { focusDocument } from "../editor/focus";
import {
  colour,
  DOCUMENT_COLOURS,
  FONT_FAMILIES,
  fontSize,
  textColour,
} from "../lib/editor/styles";

export function FontSelect({ editor }: { editor: Editor }) {
  return (
    <select
      className="docs-font-select docs-block-select"
      aria-label="Font family"
      value={editor.getAttributes("textStyle").fontFamily ?? "var(--font-ui)"}
      onChange={(event) => {
        editor.chain().focus().setFontFamily(event.target.value).run();
      }}
    >
      {FONT_FAMILIES.map((font) => (
        <option key={font.value} value={font.value}>
          {font.label}
        </option>
      ))}
    </select>
  );
}

export function FontSizeControl({ editor }: { editor: Editor }) {
  const current = Number.parseFloat(editor.getAttributes("textStyle").fontSize ?? "11");
  const [draft, setDraft] = useState(String(current));
  useEffect(() => setDraft(String(current)), [current]);
  const apply = (value: string) => {
    const safe = fontSize(value);
    if (safe) {
      editor.chain().focus().setFontSize(safe).run();
      setDraft(String(Number.parseFloat(safe)));
    } else setDraft(String(current));
  };
  return (
    <fieldset className="docs-font-size" aria-label="Font size">
      <IconButton
        variant="ghost"
        size="icon-sm"
        label="Decrease font size"
        disabled={current <= 6}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => apply(String(Math.max(6, current - 1)))}
      >
        <Minus aria-hidden="true" size={14} />
      </IconButton>
      <input
        aria-label="Font size in points"
        type="number"
        min={6}
        max={96}
        step={0.5}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (Number(draft) !== current) apply(draft);
        }}
        onKeyDown={(event) => {
          // Typed digits belong to the field, not to an enclosing menu's typeahead or
          // the toolbar's arrow-key roving; Tab and Escape still reach the menu.
          if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            apply(draft);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(String(current));
            focusDocument(editor);
          }
        }}
      />
      <IconButton
        variant="ghost"
        size="icon-sm"
        label="Increase font size"
        disabled={current >= 96}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => apply(String(Math.min(96, current + 1)))}
      >
        <Plus aria-hidden="true" size={14} />
      </IconButton>
    </fieldset>
  );
}

export function ColourGrid({
  value,
  choose,
  label,
}: {
  value: unknown;
  choose: (value: string | null) => void;
  label: string;
}) {
  const selected = Math.max(
    0,
    DOCUMENT_COLOURS.findIndex((token) => token.value === colour(value)),
  );
  const [tab, setTab] = useState(selected);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: interactive colour grid with roving swatch focus */}
      <div
        ref={ref}
        role="grid"
        aria-label={label}
        className="docs-colour-grid"
        onKeyDown={(event) => {
          const index = Number((event.target as HTMLElement).dataset.swatch);
          if (!Number.isInteger(index)) return;
          const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[event.key];
          if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          event.stopPropagation();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? DOCUMENT_COLOURS.length - 1
                : (index + (delta as number) + DOCUMENT_COLOURS.length) % DOCUMENT_COLOURS.length;
          setTab(next);
          ref.current?.querySelector<HTMLElement>(`[data-swatch="${next}"]`)?.focus();
        }}
      >
        {[0, 1, 2].map((row) => (
          // biome-ignore lint/a11y/useFocusableInteractive: gridcells own the roving Tab stop
          // biome-ignore lint/a11y/useSemanticElements: interactive palette row
          <div key={row} role="row">
            {DOCUMENT_COLOURS.slice(row * 4, row * 4 + 4).map((token, column) => {
              const index = row * 4 + column;
              return (
                // biome-ignore lint/a11y/useSemanticElements: native swatch button provides activation within the interactive grid
                <button
                  key={token.label}
                  type="button"
                  role="gridcell"
                  aria-label={token.label}
                  aria-selected={colour(value) === token.value}
                  tabIndex={tab === index ? 0 : -1}
                  data-swatch={index}
                  title={token.label}
                  style={{ backgroundColor: token.value }}
                  onFocus={() => setTab(index)}
                  onClick={() => choose(token.value)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <Button variant="ghost" onClick={() => choose(null)}>
        Reset
      </Button>
    </>
  );
}

export function ColourPopover({
  editor,
  kind,
  close,
}: {
  editor: Editor;
  kind: "color" | "backgroundColor";
  close: () => void;
}) {
  const label = kind === "color" ? "Text colour" : "Highlight colour";
  // A click or Tab elsewhere already put focus where the person meant it to go.
  const outside = useRef(false);
  return (
    <Popover open onOpenChange={close}>
      <PopoverAnchor asChild>
        <span className="docs-colour-anchor" />
      </PopoverAnchor>
      <PopoverContent
        aria-label={label}
        className="docs-colour-popover"
        onInteractOutside={() => {
          outside.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!outside.current) focusDocument(editor);
        }}
      >
        <p>{label}</p>
        <ColourGrid
          label={label}
          value={editor.getAttributes("textStyle")[kind]}
          choose={(value) => {
            const chain = editor.chain().focus();
            if (kind === "color") {
              // Black is the default ink, so choosing it resets to default text.
              const ink = textColour(value);
              if (ink) chain.setColor(ink);
              else chain.unsetColor();
            } else {
              chain.unsetHighlight();
              if (value) chain.setBackgroundColor(value);
              else chain.unsetBackgroundColor();
            }
            chain.run();
            close();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
