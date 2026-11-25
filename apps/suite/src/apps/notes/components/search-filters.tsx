// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { Bell, Image, Link as LinkIcon, ListChecks, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import type { Note } from "../lib/model/note";
import { NoteColour } from "../lib/model/prefs";
import {
  matchesNoteSearch,
  type NoteSearchContext,
  type NoteSearchFilters,
  noteSearchHref,
  noteSearchTypes,
  serializeNoteSearch,
} from "../lib/search-filters";

const types = {
  images: { label: "Images", icon: Image },
  lists: { label: "Lists", icon: ListChecks },
  reminders: { label: "Reminders", icon: Bell },
  links: { label: "Links", icon: LinkIcon },
};
const colourName = (colour: string) => colour.charAt(0).toUpperCase() + colour.slice(1);

export function SearchFilters({
  filters,
  notes,
  labels,
  context,
}: {
  filters: NoteSearchFilters;
  notes: readonly Note[];
  labels: readonly string[];
  context: NoteSearchContext;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const browsing = !serializeNoteSearch(filters);
  const available = notes.filter((note) => note.location !== "trashed");
  const colours = new Set(available.map((note) => context.prefs.colours[note.url] ?? "default"));
  const people = [
    ...new Set(available.flatMap((note) => context.collaborators[note.url] ?? [])),
  ].sort();
  const shared = available.some((note) => context.sharedNotes[note.url] === true);
  const chips = [
    { key: "q", label: filters.q ? `Search: ${filters.q}` : undefined },
    { key: "type", label: filters.type ? `Type: ${types[filters.type].label}` : undefined },
    { key: "colour", label: filters.colour ? `Colour: ${colourName(filters.colour)}` : undefined },
    { key: "label", label: filters.label ? `Label: ${filters.label}` : undefined },
    {
      key: "shared",
      label:
        filters.shared === "any"
          ? "Shared notes"
          : filters.shared
            ? `Shared with: ${filters.shared}`
            : undefined,
    },
  ] as const;
  return (
    <div className="notes-search-filters">
      {!browsing && (
        <nav className="notes-search-chips" aria-label="Active search filters">
          {chips
            .filter((chip) => chip.label)
            .map(({ key, label }) => (
              <Button asChild variant="outline" key={key}>
                <Link
                  href={noteSearchHref({ ...filters, [key]: key === "q" ? "" : undefined })}
                  aria-label={`Remove ${label}`}
                >
                  {label}
                  <X size={16} aria-hidden="true" />
                </Link>
              </Button>
            ))}
          <Button asChild variant="ghost">
            <Link href="/notes/search">Clear all</Link>
          </Button>
          <Button
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={id}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Hide filters" : "Add filters"}
          </Button>
        </nav>
      )}
      <div id={id}>
        {(browsing || expanded) && (
          <div className="notes-search-options">
            <section aria-label="Types">
              <h2>Types</h2>
              <div className="notes-search-tiles">
                {noteSearchTypes
                  .filter((type) =>
                    available.some((note) => matchesNoteSearch(note, { q: "", type }, context)),
                  )
                  .map((type) => {
                    const { label, icon: Icon } = types[type];
                    return (
                      <Button asChild variant="outline" key={type} className="notes-search-tile">
                        <Link href={noteSearchHref({ ...filters, type })}>
                          <Icon size={28} aria-hidden="true" />
                          {label}
                        </Link>
                      </Button>
                    );
                  })}
              </div>
            </section>
            <section aria-label="Labels">
              <h2>Labels</h2>
              <div className="notes-search-tiles">
                {labels.map((label) => (
                  <Button asChild variant="outline" key={label}>
                    <Link href={noteSearchHref({ ...filters, label })}>{label}</Link>
                  </Button>
                ))}
                {labels.length === 0 && <p>No labels yet</p>}
              </div>
            </section>
            <section aria-label="Colours">
              <h2>Colours</h2>
              <div className="notes-search-tiles">
                {NoteColour.options
                  .filter((colour) => colours.has(colour))
                  .map((colour) => (
                    <Button asChild variant="ghost" key={colour} className="notes-search-colour">
                      <Link href={noteSearchHref({ ...filters, colour })}>
                        <span
                          className="notes-search-swatch"
                          data-note-colour={colour}
                          aria-hidden="true"
                        />
                        {colourName(colour)}
                      </Link>
                    </Button>
                  ))}
              </div>
            </section>
            <section aria-label="Shared">
              <h2>Shared</h2>
              <div className="notes-search-tiles">
                {shared && (
                  <Button asChild variant="outline">
                    <Link href={noteSearchHref({ ...filters, shared: "any" })}>
                      Any shared note
                    </Link>
                  </Button>
                )}
                {people.map((webId) => (
                  <Button asChild variant="outline" key={webId}>
                    <Link href={noteSearchHref({ ...filters, shared: webId })}>{webId}</Link>
                  </Button>
                ))}
                {!shared && <p>No shared notes found</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
