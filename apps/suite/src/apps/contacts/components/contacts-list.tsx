// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  type DataColumn,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  renderAsync,
} from "@jeswr/suite-ui";
import { Star, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";
import {
  CONTACT_HUES,
  contactAvatar,
  type HighlightRange,
  type ListContact,
  searchContacts,
  sectionContacts,
} from "../lib/list";
import { useContacts, useStarred } from "../state/contacts-context";
import { decodeContactRef, filterContacts } from "../state/data";

export function ContactAvatar({
  contact,
  large = false,
}: {
  contact: ListContact;
  large?: boolean;
}) {
  const avatar = contactAvatar(contact);
  const hue = CONTACT_HUES[avatar.colourIndex];
  const hueApps: Record<number, string> = {
    205: "home",
    250: "drive",
    280: "docs",
    150: "tasks",
    40: "calendar",
    320: "contacts",
    85: "notes",
    350: "photos",
    300: "chat",
    170: "sheets",
    20: "mail",
    335: "music",
    130: "money",
    10: "health",
    225: "permissions",
  };
  const app = hueApps[hue as number];
  return (
    <Avatar className={large ? "con-avatar con-avatar-large" : "con-avatar"} aria-hidden="true">
      <AvatarFallback
        style={{
          background: `var(--app-${app}-soft)`,
          color: "var(--foreground)",
        }}
      >
        {avatar.initials}
      </AvatarFallback>
    </Avatar>
  );
}
function Highlight({ text, ranges }: { text: string; ranges: readonly HighlightRange[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    parts.push(
      text.slice(cursor, range.start),
      <mark key={range.start}>{text.slice(range.start, range.end)}</mark>,
    );
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
export function ContactsList({
  path,
  onOpen,
}: {
  path: string;
  onOpen(contact: ListContact): void;
}) {
  const state = useContacts();
  const { stars, toggle } = useStarred();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [stickyLetter, setStickyLetter] = useState("");
  let groupUrl: string | undefined;
  try {
    if (state.book && path.startsWith("/contacts/label/"))
      groupUrl = decodeContactRef(state.book.url, path.slice("/contacts/label/".length));
  } catch {
    /* Unknown label is an empty filtered view. */
  }
  const group = state.data.groups.find((g) => g.url === groupUrl);
  const filtered = filterContacts(state.contacts, stars, group, path === "/contacts/starred");
  const missingLabel = path.startsWith("/contacts/label/") && !group;
  let invalidQuery = false;
  let hits: ReturnType<typeof searchContacts> = [];
  try {
    hits = searchContacts(missingLabel ? [] : filtered, query);
  } catch {
    invalidQuery = true;
  }
  const sections = sectionContacts(hits.map((hit) => hit.contact));
  const items = sections.flatMap((section) => section.contacts);
  const letters = new Map(
    sections.flatMap((section) =>
      section.contacts.map((contact) => [contact.id, section.label] as const),
    ),
  );
  const sectionStarts = new Set(sections.map((section) => section.contacts[0]?.id));
  const byId = new Map(hits.map((hit) => [hit.contact.id, hit]));
  const high = (contact: ListContact, field: HighlightRange["field"], text: string) => (
    <Highlight
      text={text}
      ranges={
        byId
          .get(contact.id)
          ?.highlights.filter((range) => range.field === field && range.index === 0) ?? []
      }
    />
  );
  const columns: DataColumn<ListContact>[] = [
    {
      id: "name",
      header: "Name",
      accessor: (c) => c.displayName ?? c.emails?.[0] ?? "Unnamed contact",
      size: 250,
      minSize: 180,
      sortable: false,
      hideable: false,
      render: (c) => (
        <div className="con-person" data-contact-id={c.id} data-letter={letters.get(c.id)}>
          <span
            className="con-section-letter"
            title={sectionStarts.has(c.id) ? `Section ${letters.get(c.id)}` : undefined}
          >
            {sectionStarts.has(c.id) ? letters.get(c.id) : ""}
          </span>
          <ContactAvatar contact={c} />
          <span className="con-person-text">
            <span className="con-name">
              {high(c, "displayName", c.displayName ?? c.emails?.[0] ?? "Unnamed contact")}
            </span>
            <span className="con-mobile-point">
              {c.emails?.[0]
                ? high(c, "emails", c.emails[0])
                : high(c, "phones", c.phones?.[0] ?? "")}
            </span>
          </span>
        </div>
      ),
    },
    {
      id: "email",
      header: "Email",
      accessor: (c) => c.emails?.[0] ?? "",
      size: 210,
      minSize: 120,
      sortable: false,
      render: (c) => high(c, "emails", c.emails?.[0] ?? ""),
    },
    {
      id: "phone",
      header: "Phone",
      accessor: (c) => c.phones?.[0] ?? "",
      size: 160,
      minSize: 120,
      sortable: false,
      render: (c) => high(c, "phones", c.phones?.[0] ?? ""),
    },
    {
      id: "labels",
      header: "Labels",
      accessor: (c) =>
        state
          .labels(c.id)
          .map((g) => g.data.name)
          .join(", "),
      size: 160,
      minSize: 100,
      sortable: false,
      render: (c) => (
        <div className="con-chips">
          {state.labels(c.id).map((g) => (
            <Badge key={g.url} variant="secondary">
              {g.data.name}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: "star",
      header: "Star",
      accessor: (c) => Number(stars.has(c.id)),
      size: 56,
      minSize: 56,
      maxSize: 56,
      sortable: false,
      hideable: false,
      render: (c) => (
        <button
          type="button"
          className="con-icon con-star"
          aria-label={`Star ${c.displayName ?? "contact"}`}
          aria-pressed={stars.has(c.id)}
          onClick={() => toggle(c.id)}
        >
          <Star size={18} fill={stars.has(c.id) ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      ),
    },
  ];
  const height = useMemo(() => 620, []);
  const title = group?.data.name ?? (path === "/contacts/starred" ? "Starred" : "All contacts");
  return (
    <section className="con-list" aria-labelledby="con-list-title">
      <div className="con-list-heading">
        <h1 id="con-list-title">{title}</h1>
        <span role="status" aria-live="polite">
          {items.length} contacts{query ? ` matching “${query}”` : ""}
        </span>
      </div>
      {state.data.incomplete && (
        <p>
          Some discovery results may be incomplete. Your address book is loaded from its full people
          index.
        </p>
      )}
      {renderAsync({
        loading: state.status === "loading" && (
          <LoadingSkeleton preset="table" label="Loading contacts" />
        ),
        error: state.status === "error" && (
          <ErrorState error="unreachable" actions={{ retry: state.retry }} />
        ),
        empty: !state.book ? (
          <EmptyState
            title="Create your address book"
            body="Keep your people and labels together in your pod."
            icon={<Users aria-hidden="true" />}
            primaryAction={
              <Button
                onClick={() => {
                  void state.createAddressBook().catch(() => {});
                }}
              >
                Create address book
              </Button>
            }
          />
        ) : !items.length ? (
          <EmptyState
            title={
              query || group || missingLabel || path === "/contacts/starred"
                ? "No matches"
                : "No contacts yet"
            }
            body={
              invalidQuery
                ? "Try a shorter search without special characters."
                : query || group || missingLabel
                  ? "Try another search or label."
                  : path === "/contacts/starred"
                    ? "Star a contact to find them here."
                    : "Add someone to your address book."
            }
            primaryAction={
              <Button asChild>
                <Link href="/contacts/new">New contact</Link>
              </Button>
            }
          />
        ) : null,
        children: (
          // biome-ignore lint/a11y/noStaticElementInteractions: Delegates clicks to grid rows; DataTable owns roving keyboard navigation.
          // biome-ignore lint/a11y/useKeyWithClickEvents: DataTable handles Enter on its focused row.
          <div
            className="con-table"
            onScrollCapture={(event) => {
              const viewport = event.target as HTMLElement;
              const index = Math.floor(viewport.scrollTop / 64);
              setStickyLetter(letters.get(items[index]?.id ?? "") ?? "");
            }}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("button, input, a")) return;
              const row = target.closest("tr");
              const id = row?.querySelector<HTMLElement>("[data-contact-id]")?.dataset.contactId;
              const contact = items.find((c) => c.id === id);
              if (contact) {
                row?.focus();
                onOpen(contact);
              }
            }}
          >
            <div className="con-sticky-letter" aria-hidden="true">
              {stickyLetter || sections[0]?.label}
            </div>
            <DataTable
              items={items}
              columns={columns}
              getKey={(c) => c.id}
              getLabel={(c) => c.displayName ?? "Unnamed contact"}
              label="Contacts"
              onOpen={onOpen}
              height={height}
            />
          </div>
        ),
      })}
    </section>
  );
}
