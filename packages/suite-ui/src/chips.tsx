// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type ChipRef,
  chipIri,
  chipQuery,
  chipText,
  type ResolvedChip,
  textChips,
} from "@jeswr/suite-sdk/chips/core";
import {
  Calendar,
  CheckSquare,
  File,
  FileText,
  Link,
  Lock,
  MapPin,
  Sheet,
  StickyNote,
  User,
} from "lucide-react";
import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./components/ui/hover-card.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";

const icons = {
  person: User,
  file: File,
  doc: FileText,
  sheet: Sheet,
  note: StickyNote,
  event: Calendar,
  task: CheckSquare,
  place: MapPin,
  link: Link,
  lock: Lock,
};

export function Chip({
  reference,
  resolve,
  href = reference.iri,
  resolveOnMount = false,
}: {
  reference: ChipRef;
  resolve?: ((ref: ChipRef) => Promise<ResolvedChip>) | undefined;
  href?: string;
  resolveOnMount?: boolean;
}) {
  const [live, setLive] = useState<ResolvedChip>();
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Clear metadata when the resource or session resolver changes.
  useEffect(() => {
    setLive(undefined);
  }, [reference, resolve]);
  useEffect(() => {
    let active = true;
    if (resolve && chipIri(reference.iri) && (resolveOnMount || open))
      void resolve(reference)
        .then((value) => {
          if (active) setLive(value);
        })
        .catch(() => {
          if (active) setLive({ ...reference, readable: false, icon: "lock" });
        });
    return () => {
      active = false;
    };
  }, [reference, resolve, resolveOnMount, open]);
  const label = live?.label ?? reference.label;
  const Icon = icons[live?.icon ?? reference.kind] ?? icons.link;
  if (!chipIri(reference.iri)) return <span>{label}</span>;
  const target = live?.readable === false ? reference.iri : href;
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={250} closeDelay={200}>
      <HoverCardTrigger asChild>
        <a
          className="suite-chip"
          data-unreadable={live?.readable === false ? "true" : undefined}
          href={target}
          data-chip=""
          data-chip-kind={reference.kind}
          data-chip-label={reference.label}
          rel="noopener noreferrer"
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Element) ||
              !event.relatedTarget.closest(".suite-chip-card")
            )
              setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="suite-chip-card" onFocusCapture={() => setOpen(true)}>
        <strong>{label}</strong>
        <p>
          {live?.readable === false ? "Private or unavailable" : (live?.kind ?? reference.kind)}
        </p>
        <p>Owner: {live?.owner ?? "Unknown"}</p>
        <a href={target} rel="noopener noreferrer">
          Open {label}
        </a>
      </HoverCardContent>
    </HoverCard>
  );
}

/** A focused combobox keeps the editor's captured insertion range stable while searching. */
export function ChipPicker({
  search,
  initialQuery = "",
  onChoose,
  onClose,
}: {
  search: (query: string, signal: AbortSignal) => Promise<ChipRef[]>;
  initialQuery?: string;
  onChoose: (ref: ChipRef) => void;
  onClose: (restoreFocus?: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<ChipRef[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("Searching…");
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setItems([]);
    setActive(0);
    setStatus("Searching…");
    const timer = setTimeout(() => {
      void search(query, abort.signal)
        .then((refs) => {
          if (abort.signal.aborted) return;
          setItems(refs);
          setStatus(refs.length ? "" : "No matches");
        })
        .catch(() => {
          if (!abort.signal.aborted) setStatus("Couldn't search. Try again.");
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, search]);
  return (
    <div
      className="suite-chip-picker"
      role="dialog"
      aria-label="Insert a mention"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
    >
      <Input
        ref={input}
        role="combobox"
        aria-label="Mention a person or resource"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={items[active] ? `${id}-${active}` : undefined}
        value={query}
        placeholder="Search people, files, events…"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") event.preventDefault();
            event.stopPropagation();
            onClose(event.key === "Escape");
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) =>
              items.length
                ? (value + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
                : 0,
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (items[active]) onChoose(items[active]);
          }
        }}
      />
      <div role="listbox" id={`${id}-list`} aria-label="Mention suggestions">
        {items.map((ref, index) => {
          const Icon = icons[ref.kind] ?? icons.link;
          return (
            <button
              type="button"
              tabIndex={-1}
              key={ref.iri}
              role="option"
              aria-label={`${ref.label} (${ref.kind})`}
              id={`${id}-${index}`}
              aria-selected={active === index}
              onMouseMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onChoose(ref)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{ref.label}</span>
              <small>{ref.kind}</small>
            </button>
          );
        })}
      </div>
      {status && <p role="status">{status}</p>}
    </div>
  );
}

/** Shared portal positioning for text and rich-text composers. */
export function ChipPickerAnchor({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      style={{ position: "fixed", bottom: "var(--space-4)", left: "var(--space-4)", zIndex: 100 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export type ChipSearch = (query: string, signal: AbortSignal) => Promise<ChipRef[]>;
type ChipRange = NonNullable<ReturnType<typeof chipQuery>>;
export interface ChipEditorAdapter {
  query(): ChipRange | null;
  subscribe(listener: () => void): () => void;
  focus(): void;
  insert(range: ChipRange, ref: ChipRef): void;
}
/** Editor-specific transaction access stays in the caller's small adapter. */
export function ChipEditorTools({
  editor,
  search,
}: {
  editor: ChipEditorAdapter | null;
  search: ChipSearch;
}) {
  const [range, setRange] = useState<ChipRange | null>(null);
  const dismissed = useRef<number | null>(null);
  useEffect(() => {
    setRange(null);
    if (!editor) return;
    return editor.subscribe(() => {
      const query = editor.query();
      if (!query) {
        dismissed.current = null;
        return;
      }
      if (dismissed.current !== query.from) setRange(query);
    });
  }, [editor]);
  if (!range || !editor) return null;
  return (
    <ChipPickerAnchor>
      <ChipPicker
        initialQuery={range.query}
        search={search}
        onClose={(restoreFocus) => {
          dismissed.current = range.from;
          setRange(null);
          if (restoreFocus) editor.focus();
        }}
        onChoose={(ref) => {
          setRange(null);
          editor.insert(range, ref);
        }}
      />
    </ChipPickerAnchor>
  );
}

/** Adds mentions while preserving the caller's controlled field and blur/save contract. */
export function ChipTextarea({
  value = "",
  onChange,
  onBlur,
  ref: forwardedRef,
  search,
  ...props
}: ComponentProps<"textarea"> & { search: ChipSearch }) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const dismissed = useRef<number | null>(null);
  const [range, setRange] = useState<ReturnType<typeof chipQuery>>(null);
  const current = String(value);
  return (
    <>
      <Textarea
        {...props}
        value={value}
        ref={(node) => {
          field.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        onChange={(event) => {
          onChange?.(event);
          const query = chipQuery(event.target.value, event.target.selectionStart);
          if (!query) dismissed.current = null;
          setRange(query && dismissed.current !== query.from ? query : null);
        }}
        onBlur={onBlur}
      />
      {range && (
        <ChipPickerAnchor>
          <ChipPicker
            initialQuery={range.query}
            search={search}
            onClose={(restoreFocus) => {
              dismissed.current = range.from;
              setRange(null);
              if (restoreFocus) field.current?.focus();
            }}
            onChoose={(reference) => {
              const node = field.current;
              setRange(null);
              if (!node || node.disabled || node.readOnly) return;
              const next = `${current.slice(0, range.from)}${chipText(reference)} ${current.slice(range.to)}`;
              Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value",
              )?.set?.call(node, next);
              node.dispatchEvent(new Event("input", { bubbles: true }));
              node.dispatchEvent(new Event("change", { bubbles: true }));
              node.focus();
            }}
          />
        </ChipPickerAnchor>
      )}
    </>
  );
}

/** Render plain composers' structured links without duplicating their parsing in applications. */
export function ChipText({
  text,
  plain = (value: string) => value,
  renderChip = (reference: ChipRef) => <Chip reference={reference} />,
}: {
  text: string;
  plain?: ((value: string) => ReactNode) | undefined;
  renderChip?: (reference: ChipRef) => ReactNode;
}) {
  let cursor = 0;
  return (
    <>
      {textChips(text).map(({ ref, from, to }) => {
        const before = text.slice(cursor, from);
        cursor = to;
        return (
          <Fragment key={`${from}:${ref.iri}`}>
            {plain(before)}
            {renderChip(ref)}
          </Fragment>
        );
      })}
      {plain(text.slice(cursor))}
    </>
  );
}
