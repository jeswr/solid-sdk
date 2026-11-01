// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  ErrorState,
  LoadingSkeleton,
  RadioGroup,
  RadioGroupItem,
  renderAsync,
  toast,
} from "@jeswr/suite-ui";
import { Merge } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ContactData, Snapshot } from "../lib/model";
import {
  useAddressBook,
  useContactMutations,
  useDuplicates,
  useGroups,
} from "../state/contacts-context";
import { MergeFailure } from "../state/controller";
import { contactLabels, displayPhone, encodeContactRef, projectContact } from "../state/data";
import {
  type DuplicateGroup,
  type DuplicateReason,
  defaultSelection,
  MERGE_FIELDS,
  type MergeField,
  type MergeSelection,
  mergeChoices,
  mergeContactData,
  mergedDocument,
  mergeFailureMessage,
  mergeLosses,
} from "../state/merge";
import { ContactAvatar } from "./contacts-list";

type Person = Snapshot<ContactData>;
const contactId = (person: Person) => `${person.url}#this`;
const FIELD_LABELS: Record<MergeField, string> = {
  name: "Name",
  organization: "Organisation",
  note: "Note",
  webId: "WebID",
};

export function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function reasonText(reasons: readonly DuplicateReason[]): string {
  const text = reasons.map((reason) =>
    reason.kind === "email"
      ? `email ${reason.value}`
      : reason.kind === "phone"
        ? `phone ${displayPhone(reason.value)}`
        : `WebID ${reason.value}`,
  );
  return `Same ${joinNames(text)}`;
}

function bare(value: string) {
  return value.replace(/^(mailto|tel):/, "");
}

function Summary({ person }: { person: Person }) {
  const details = [
    person.data.organization,
    ...(person.data.emails ?? []).map(bare),
    ...(person.data.phones ?? []).map(displayPhone),
  ].filter(Boolean);
  return details.length ? <span className="con-dup-meta">{details.join(" · ")}</span> : null;
}

function MergeReview({
  people,
  onCancel,
  onMerge,
}: {
  people: readonly Person[];
  onCancel(): void;
  onMerge(primary: Person, others: readonly Person[], selection: MergeSelection): void;
}) {
  const uid = useId();
  const groups = useGroups();
  const heading = useRef<HTMLHeadingElement>(null);
  const choices = useMemo(() => mergeChoices(people), [people]);
  const [primaryId, setPrimaryId] = useState(() => contactId(people[0] as Person));
  const [chosen, setSelection] = useState(() => defaultSelection(choices, primaryId));
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const primary = people.find((person) => contactId(person) === primaryId) ?? (people[0] as Person);
  // A background refresh can change the offered values; never submit one that is not shown.
  const selection = defaultSelection(choices, contactId(primary));
  for (const field of MERGE_FIELDS) {
    const value = chosen[field];
    if (value !== undefined && choices[field].some((option) => option.value === value))
      selection[field] = value;
  }
  const others = people.filter((person) => person !== primary);
  const merged = mergeContactData(
    primary.data,
    others.map((person) => person.data),
    selection,
  );
  const labels = [
    ...new Set(
      people.flatMap((person) => contactLabels(contactId(person), groups).map((g) => g.data.name)),
    ),
  ];
  const fixed = MERGE_FIELDS.filter((field) => choices[field].length === 1);
  // Like migration's lossless check: list what deleting the other documents would discard.
  let losses: { name: string; items: string[] }[] | undefined;
  try {
    const document = mergedDocument(primary, merged);
    losses = others
      .map((person) => ({
        name: person.data.name,
        items: mergeLosses(document, contactId(primary), person),
      }))
      .filter((loss) => loss.items.length);
  } catch {
    losses = undefined;
  }
  const choose = (field: MergeField) => {
    const options = choices[field];
    const labelId = `${uid}-${field}`;
    const selected = options.findIndex((option) => option.value === selection[field]);
    return (
      <div className="con-dup-choice" key={field}>
        <span id={labelId} className="con-dup-legend">
          {FIELD_LABELS[field]}
        </span>
        <RadioGroup
          aria-labelledby={labelId}
          value={String(Math.max(selected, 0))}
          onValueChange={(value) =>
            setSelection((current) => ({
              ...current,
              [field]: (options[Number(value)] as (typeof options)[number]).value,
            }))
          }
        >
          {options.map((option, index) => (
            <label className="con-dup-option" key={option.value} htmlFor={`${labelId}-${index}`}>
              <RadioGroupItem id={`${labelId}-${index}`} value={String(index)} />
              <span>{option.value}</span>
            </label>
          ))}
        </RadioGroup>
      </div>
    );
  };
  const otherNames = joinNames(others.map((person) => person.data.name));
  const name = merged.name;
  return (
    <form
      className="con-dup-review"
      aria-labelledby={`${uid}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        setConfirm(true);
      }}
    >
      <h3 id={`${uid}-title`} ref={heading} tabIndex={-1}>
        Choose what to keep
      </h3>
      <div className="con-dup-choice">
        <span id={`${uid}-primary`} className="con-dup-legend">
          Keep contact
        </span>
        <RadioGroup
          aria-labelledby={`${uid}-primary`}
          aria-describedby={`${uid}-primary-help`}
          value={primaryId}
          onValueChange={(value) => {
            setPrimaryId(value);
            setSelection(defaultSelection(choices, value));
          }}
        >
          {people.map((person, index) => (
            <label className="con-dup-option" key={person.url} htmlFor={`${uid}-p-${index}`}>
              <RadioGroupItem id={`${uid}-p-${index}`} value={contactId(person)} />
              <span className="con-person-text">
                <span>{person.data.name}</span>
                <Summary person={person} />
              </span>
            </label>
          ))}
        </RadioGroup>
        <p id={`${uid}-primary-help`} className="con-field-help">
          The other contacts are deleted after their details are added to this one.
        </p>
      </div>
      {MERGE_FIELDS.filter((field) => choices[field].length > 1).map(choose)}
      <dl className="con-dup-summary">
        {fixed.map((field) => (
          <div key={field}>
            <dt>{FIELD_LABELS[field]}</dt>
            <dd>{selection[field]}</dd>
          </div>
        ))}
        <div>
          <dt>Emails</dt>
          <dd>
            {merged.emails?.length ? (
              <ul>
                {merged.emails.map((email) => (
                  <li key={email}>{bare(email)}</li>
                ))}
              </ul>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt>Phones</dt>
          <dd>
            {merged.phones?.length ? (
              <ul>
                {merged.phones.map((phone) => (
                  <li key={phone}>{displayPhone(phone)}</li>
                ))}
              </ul>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt>Labels</dt>
          <dd>{labels.length ? labels.join(", ") : "None"}</dd>
        </div>
      </dl>
      {losses === undefined ? (
        <div className="con-dup-warning" role="alert">
          <p className="con-dup-warning-title">These contacts can't be merged here</p>
          <p>
            Some of their details aren't valid in the kept contact. Edit the contacts first, or keep
            them separate.
          </p>
        </div>
      ) : losses.length ? (
        <div className="con-dup-warning" role="note" aria-labelledby={`${uid}-loss`}>
          <p id={`${uid}-loss`} className="con-dup-warning-title">
            Some details will be removed
          </p>
          <p>
            These details can't be carried into {name}. They are deleted with the other
            {others.length === 1 ? " contact" : " contacts"}:
          </p>
          <ul>
            {losses.map((loss) => (
              <li key={loss.name}>
                {loss.name}: {loss.items.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="con-form-actions">
        <Button type="submit" disabled={losses === undefined}>
          <Merge size={16} aria-hidden="true" />
          Merge contacts
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogTitle>
            Merge {people.length} contacts into {name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {`Keeps ${primary.data.name}${name === primary.data.name ? "" : ` (renamed to ${name})`} and deletes ${otherNames}, after adding their emails, phones and labels.${losses?.length ? " The details listed in the review are removed." : ""} This can't be undone.`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction onClick={() => onMerge(primary, others, selection)}>
              Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function GroupCard({
  group,
  people,
  reviewing,
  headingRef,
  onReview,
  onCancel,
  onDismiss,
  onMerge,
}: {
  group: DuplicateGroup;
  people: readonly Person[];
  reviewing: boolean;
  headingRef(element: HTMLHeadingElement | null): void;
  onReview(): void;
  onCancel(): void;
  onDismiss(): void;
  onMerge(primary: Person, others: readonly Person[], selection: MergeSelection): void;
}) {
  const uid = useId();
  const { book } = useAddressBook();
  const title = joinNames(people.map((person) => person.data.name));
  return (
    <section className="con-dup-group" aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} ref={headingRef} tabIndex={-1}>
        {title}
      </h2>
      <p className="con-dup-reason">{reasonText(group.reasons)}</p>
      <ul className="con-dup-people">
        {people.map((person) => (
          <li key={person.url} className="con-person">
            <ContactAvatar contact={projectContact(person)} />
            <span className="con-person-text">
              {book ? (
                <Link
                  className="con-name"
                  href={`/contacts/c/${encodeContactRef(book.url, contactId(person))}`}
                >
                  {person.data.name}
                </Link>
              ) : (
                <span className="con-name">{person.data.name}</span>
              )}
              <Summary person={person} />
            </span>
          </li>
        ))}
      </ul>
      {reviewing ? (
        <MergeReview people={people} onCancel={onCancel} onMerge={onMerge} />
      ) : (
        <div className="con-form-actions">
          <Button onClick={onReview} aria-describedby={`${uid}-title`}>
            <Merge size={16} aria-hidden="true" />
            Merge
          </Button>
          <Button variant="outline" onClick={onDismiss} aria-describedby={`${uid}-title`}>
            Not duplicates
          </Button>
        </div>
      )}
    </section>
  );
}

export function ContactDuplicates() {
  const state = useAddressBook();
  const { groups, dismiss } = useDuplicates();
  const mutations = useContactMutations();
  const [reviewing, setReviewing] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const empty = useRef<HTMLHeadingElement>(null);
  // After a merge or dismissal removes a group, focus the group now in its place (or the
  // previous one, or the empty state) once the list has re-rendered.
  const pendingFocus = useRef<number | null>(null);
  // A failed merge's group reappears once the controller reconciles; focus it again.
  const [restore, setRestore] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Headings register on commit, so retry whenever the groups re-render.
  useEffect(() => {
    if (restore === undefined) return;
    const heading = headings.current.get(restore);
    if (heading) heading.focus();
    if (heading || state.status === "ready") setRestore(undefined);
  }, [groups, restore, state.status]);
  useEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const next = groups[Math.min(index, groups.length - 1)];
    (next ? headings.current.get(next.id) : empty.current)?.focus();
  }, [groups]);
  const byId = useMemo(
    () => new Map(state.data.people.map((person) => [contactId(person), person])),
    [state.data.people],
  );
  const count = groups.length;
  return (
    <section className="con-duplicates" aria-labelledby="con-dup-heading">
      <div className="con-list-heading">
        <h1 id="con-dup-heading">Merge duplicates</h1>
        {state.status === "ready" && state.book && (
          <span className="con-dup-count">{count === 1 ? "1 group" : `${count} groups`}</span>
        )}
      </div>
      <p className="con-dup-intro">
        These contacts share an email address, phone number or WebID. Merge each group into one
        contact, or keep them separate.
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {renderAsync({
        loading: state.status === "loading" && (
          <LoadingSkeleton preset="table" label="Loading contacts" />
        ),
        error: state.status === "error" && (
          <ErrorState error="unreachable" actions={{ retry: state.retry }} />
        ),
        empty: (!state.book || !count) && (
          <div className="con-dup-empty">
            <h2 ref={empty} tabIndex={-1}>
              No duplicates
            </h2>
            <p>
              {state.book
                ? "Every contact has its own email addresses, phone numbers and WebID."
                : "Create your address book to start adding contacts."}
            </p>
            <Button variant="outline" asChild>
              <Link href="/contacts">All contacts</Link>
            </Button>
          </div>
        ),
        children: () => (
          <ol className="con-dup-groups">
            {groups.map((group, index) => {
              const people = group.contactIds.map((id) => byId.get(id) as Person);
              const title = joinNames(people.map((person) => person.data.name));
              return (
                <li key={group.id}>
                  <GroupCard
                    group={group}
                    people={people}
                    reviewing={reviewing === group.id}
                    headingRef={(element) => {
                      if (element) headings.current.set(group.id, element);
                      else headings.current.delete(group.id);
                    }}
                    onReview={() => setReviewing(group.id)}
                    onCancel={() => {
                      setReviewing(undefined);
                      requestAnimationFrame(() => headings.current.get(group.id)?.focus());
                    }}
                    onDismiss={() => {
                      pendingFocus.current = index;
                      dismiss(group.contactIds);
                      setAnnouncement(`${title} are kept as separate contacts.`);
                    }}
                    onMerge={(primary, others, selection) => {
                      const name = selection.name ?? primary.data.name;
                      pendingFocus.current = index;
                      setReviewing(undefined);
                      setAnnouncement("");
                      // The success toast is the single announcement once the write settles.
                      void mutations
                        .merge(contactId(primary), others.map(contactId), selection)
                        .then(() => toast(`Merged ${people.length} contacts into ${name}`))
                        .catch((error: unknown) => {
                          setAnnouncement(
                            mergeFailureMessage(
                              error instanceof MergeFailure ? error.outcome : "unknown",
                              title,
                            ),
                          );
                          setRestore(group.id);
                        });
                    }}
                  />
                </li>
              );
            })}
          </ol>
        ),
      })}
    </section>
  );
}
