// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { X } from "lucide-react";
import { Avatar } from "radix-ui";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "./primitives.js";
import { hasSharingContent, type SharingState, SharingStatus } from "./state.js";

export interface SharingPerson {
  webId: string;
  displayName?: string;
  emails?: readonly string[];
}
export interface SharingProfile {
  displayName?: string;
  avatarUrl?: string;
  loading: boolean;
}
export type UseSharingProfile = (webId: string) => SharingProfile;
export type PersonValidation =
  | { valid: true; person: SharingPerson }
  | { valid: false; message: string };

function validAccountId(value: string) {
  if (/\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validatePersonEntry(
  entry: string,
  contacts: readonly SharingPerson[],
): PersonValidation {
  const value = entry.trim();
  if (!value) return { valid: false, message: "Enter a name, email or account ID" };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    const contact = contacts.find(
      (person) =>
        person.emails?.some((email) => email.toLowerCase() === value.toLowerCase()) &&
        validAccountId(person.webId),
    );
    return contact
      ? { valid: true, person: contact }
      : { valid: false, message: "No account found for this email — paste their account ID" };
  }
  if (validAccountId(value)) {
    return {
      valid: true,
      person: contacts.find((person) => person.webId === value) ?? { webId: value },
    };
  }
  return { valid: false, message: "Enter an account ID starting with http:// or https://" };
}

function personName(person: SharingPerson, profile: SharingProfile | undefined) {
  return profile?.displayName || person.displayName || new URL(person.webId).hostname;
}

function ContactProfile({
  webId,
  useProfile,
  onResolve,
}: {
  webId: string;
  useProfile: UseSharingProfile;
  onResolve: (webId: string, profile: SharingProfile) => void;
}) {
  const { displayName = "", avatarUrl = "", loading } = useProfile(webId);
  useEffect(() => {
    onResolve(webId, { displayName, avatarUrl, loading });
  }, [webId, displayName, avatarUrl, loading, onResolve]);
  return null;
}

function SelectedPersonLabel({
  person,
  useProfile,
}: {
  person: SharingPerson;
  useProfile: UseSharingProfile;
}) {
  const profile = useProfile(person.webId);
  return <PersonLabel person={person} profile={profile} />;
}

function PersonLabel({
  person,
  profile,
}: {
  person: SharingPerson;
  profile: SharingProfile | undefined;
}) {
  const name = personName(person, profile);
  return (
    <>
      <Avatar.Root className="su-avatar">
        {profile?.avatarUrl && <Avatar.Image src={profile.avatarUrl} alt="" />}
        <Avatar.Fallback>{name.slice(0, 1).toUpperCase()}</Avatar.Fallback>
      </Avatar.Root>
      <span className="su-person-label">
        <strong>{name}</strong>
        <span className="su-account-id">Account ID: {person.webId}</span>
        {profile?.loading && <span className="su-muted">Loading profile…</span>}
      </span>
    </>
  );
}

export interface PeoplePickerProps {
  contacts: { people: readonly SharingPerson[]; state: SharingState; onRetry?: () => void };
  value: readonly SharingPerson[];
  onChange: (people: SharingPerson[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  useProfile: UseSharingProfile;
}

export function PeoplePicker({
  contacts,
  value,
  onChange,
  query,
  onQueryChange,
  useProfile,
}: PeoplePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [profiles, setProfiles] = useState<Record<string, SharingProfile>>({});
  const onProfileResolve = useCallback((webId: string, profile: SharingProfile) => {
    setProfiles((current) => ({ ...current, [webId]: profile }));
  }, []);
  const offline = contacts.state.kind === "offline";
  const candidates = hasSharingContent(contacts.state)
    ? contacts.people.filter(
        (person) =>
          validAccountId(person.webId) &&
          !value.some((selected) => selected.webId === person.webId),
      )
    : [];
  const results = candidates.filter((person) =>
    `${personName(person, profiles[person.webId])} ${person.displayName ?? ""} ${person.webId} ${person.emails?.join(" ") ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const activePerson = results[active];
  useEffect(() => {
    if (open && active >= 0)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, active, open]);

  function add(person: SharingPerson) {
    if (offline) return;
    if (value.some((selected) => new URL(selected.webId).href === new URL(person.webId).href)) {
      setError("This person is already added");
      return;
    }
    onChange([...value, person]);
    onQueryChange("");
    setOpen(false);
    setActive(-1);
    setError("");
    setAnnouncement(`Added ${person.displayName || person.webId}`);
  }
  function addEntry() {
    const result = validatePersonEntry(query, contacts.people);
    if (result.valid) add(result.person);
    else setError(result.message);
  }
  return (
    <div className="su-stack">
      {/* Keep profile lookups mounted while contacts are filtered out. */}
      {candidates.map((person) => (
        <ContactProfile
          key={person.webId}
          webId={person.webId}
          useProfile={useProfile}
          onResolve={onProfileResolve}
        />
      ))}
      <label className="su-label" htmlFor={`${id}-input`}>
        Add people
      </label>
      {value.length > 0 && (
        <ul className="su-stack" aria-label="Selected people">
          {value.map((person) => (
            <li className="su-person-chip" key={person.webId}>
              <SelectedPersonLabel person={person} useProfile={useProfile} />
              <Button
                className="su-icon-button"
                disabled={offline}
                aria-label={`Remove ${person.displayName || person.webId}`}
                title={`Remove ${person.displayName || person.webId}`}
                onClick={() => {
                  onChange(value.filter((selected) => selected.webId !== person.webId));
                  setAnnouncement(`Removed ${person.displayName || person.webId}`);
                }}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="su-picker-input">
        <input
          id={`${id}-input`}
          className="su-input"
          role="combobox"
          autoComplete="off"
          value={query}
          disabled={offline}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && activePerson ? `${id}-option-${active}` : undefined}
          aria-invalid={!!error}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
            setActive(-1);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              setActive(-1);
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!results.length) setActive(-1);
              else if (active < 0) setActive(event.key === "ArrowDown" ? 0 : results.length - 1);
              else
                setActive(
                  (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length,
                );
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (open && activePerson) add(activePerson);
              else addEntry();
            }
          }}
        />
        <Button disabled={offline} onClick={addEntry}>
          Add person
        </Button>
      </div>
      <p className="su-muted" id={`${id}-help`}>
        {offline
          ? "Reconnect to change sharing"
          : "Search contacts or enter an email or account ID"}
      </p>
      {error && (
        <p className="su-error" role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
      <div
        role="listbox"
        id={`${id}-list`}
        aria-label="Contacts"
        className="su-contact-list"
        hidden={!open || results.length === 0}
      >
        {results.map((person, index) => (
          <div
            role="option"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Enter") add(person);
            }}
            aria-selected={active === index}
            id={`${id}-option-${index}`}
            key={person.webId}
            className="su-contact-option"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(person)}
          >
            <PersonLabel person={person} profile={profiles[person.webId]} />
          </div>
        ))}
      </div>
      <SharingStatus
        state={contacts.state}
        empty="No contacts yet. Add someone using their account ID."
        onRetry={contacts.onRetry}
        onClear={() => onQueryChange("")}
      />
      {open && hasSharingContent(contacts.state) && results.length === 0 && (
        <p role="status" className="su-muted">
          {query
            ? `No results for '${query}'`
            : "No more contacts. Enter an account ID to add someone."}
        </p>
      )}
      <span className="su-sr-only" role="status">
        {announcement}
      </span>
    </div>
  );
}
