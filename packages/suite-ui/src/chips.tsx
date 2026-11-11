// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { type ChipRef, chipIri, type ResolvedChip } from "@jeswr/suite-sdk/chips";
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
import { useEffect, useId, useRef, useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./components/ui/hover-card.js";
import { Input } from "./components/ui/input.js";

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
}: {
  reference: ChipRef;
  resolve?: ((ref: ChipRef) => Promise<ResolvedChip>) | undefined;
  href?: string;
}) {
  const [live, setLive] = useState<ResolvedChip>();
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Clear metadata when the resource or session resolver changes.
  useEffect(() => {
    setLive(undefined);
  }, [reference, resolve]);
  useEffect(() => {
    let active = true;
    if (resolve)
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
  }, [reference, resolve]);
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
  onClose: () => void;
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
            onClose();
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
