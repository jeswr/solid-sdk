// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { safeHttpIri } from "@jeswr/rdf-serialize";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  EmptyState,
  LoadingSkeleton,
  renderAsync,
  TagInput,
} from "@jeswr/suite-ui";
import { LiteralAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { ArrowLeft, ExternalLink, Mail, MapPin, Pencil, Phone, Star, Trash2 } from "lucide-react";
import { DataFactory } from "n3";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { useContact, useContactMutations, useStarred } from "../state/contacts-context";
import {
  contactLabels,
  displayAddress,
  displayPhone,
  homeCountry,
  projectContact,
} from "../state/data";
import { ContactExport } from "./contact-export";
import { ContactLoadError } from "./contact-load-error";
import { ContactAvatar } from "./contacts-list";

export function ContactDetail({ contactRef, onClose }: { contactRef: string; onClose(): void }) {
  const state = useContact(contactRef);
  const mutations = useContactMutations();
  const { stars, toggle } = useStarred();
  const session = usePodSessionState();
  const [confirm, setConfirm] = useState(false);
  const [profileName, setProfileName] = useState<string>();
  const back = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Selecting a different contact moves focus to its Back control.
  useEffect(() => {
    back.current?.focus();
  }, [contactRef]);
  const person = state.contact;
  const webId = safeHttpIri(person?.data.webId);
  useEffect(() => {
    setProfileName(undefined);
    if (!webId || session.status !== "ready") return;
    const pod = session.session;
    // No session fetch, credentials or remote profile request for another origin.
    const target = new URL(webId);
    const root = new URL(pod.storageUrl);
    if (target.origin !== root.origin || !target.pathname.startsWith(root.pathname)) return;
    let live = true;
    const signal = new AbortController();
    void fetchRdf(webId.split("#")[0] as string, {
      fetch: createPodScopedFetch(pod.storageUrl, { fetch: pod.fetch, maxRedirects: 0 }),
      signal: signal.signal,
    })
      .then(({ dataset }) => {
        if (live)
          setProfileName(
            OptionalFrom.subjectPredicate(
              new TermWrapper(webId, dataset, DataFactory),
              "http://xmlns.com/foaf/0.1/name",
              LiteralAs.string,
            ),
          );
      })
      .catch(() => {});
    return () => {
      live = false;
      signal.abort();
    };
  }, [webId, session]);
  return (
    <section className="con-detail" aria-label="Contact details">
      <Button variant="ghost" onClick={onClose} ref={back}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to contacts
      </Button>
      {renderAsync({
        loading: state.status === "loading" && <LoadingSkeleton preset="detail" />,
        error: state.status === "error" && <ContactLoadError onRetry={state.retry} />,
        empty: !person && (
          <EmptyState
            title="Contact not found"
            body="This contact may have been removed, or the link is invalid."
          />
        ),
        children: () => {
          if (!person) return null;
          const contact = projectContact(person);
          const id = contact.id;
          const labels = contactLabels(id, state.data.groups).map((g) => `${g.url}#this`);
          return (
            <>
              <header className="con-detail-header">
                <ContactAvatar contact={contact} large />
                <h2>{person.data.name}</h2>
                {person.data.organization && <p>{person.data.organization}</p>}
              </header>
              <div className="con-detail-actions">
                <button
                  type="button"
                  className="con-icon"
                  aria-label={`Star ${person.data.name}`}
                  aria-pressed={stars.has(id)}
                  onClick={() => toggle(id)}
                >
                  <Star
                    size={20}
                    fill={stars.has(id) ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                </button>
                <Button variant="outline" asChild>
                  <Link href={`/contacts/c/${contactRef}/edit`}>
                    <Pencil size={16} aria-hidden="true" />
                    Edit
                  </Link>
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(true)}>
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </Button>
              </div>
              <ContactExport contacts={[person.data]} />
              <div className="con-contact-points">
                {(person.data.emails ?? []).map((email) => (
                  <a
                    key={email}
                    href={`mailto:${email.replace(/^mailto:/, "")}`}
                    aria-label={`Email ${person.data.name}: ${email.replace(/^mailto:/, "")}`}
                  >
                    <Mail size={18} aria-hidden="true" />
                    <span>{email.replace(/^mailto:/, "")}</span>
                  </a>
                ))}
                {(person.data.phones ?? []).map((phone) => (
                  <a
                    key={phone}
                    href={`tel:${phone.replace(/^tel:/, "")}`}
                    aria-label={`Call ${person.data.name}: ${displayPhone(phone)}`}
                  >
                    <Phone size={18} aria-hidden="true" />
                    <span>{displayPhone(phone)}</span>
                  </a>
                ))}
                {(person.data.addresses ?? []).map((address, index) => {
                  // AUTHORED-BY Claude Opus 5.5
                  const kind =
                    address.kind === "home" ? "Home" : address.kind === "work" ? "Work" : "Address";
                  const text = displayAddress(address, homeCountry(navigator.language));
                  return (
                    <a
                      // Addresses have no identity of their own; order is stable per snapshot.
                      // biome-ignore lint/suspicious/noArrayIndexKey: see above.
                      key={index}
                      href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(text.replaceAll("\n", ", "))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Map ${address.kind ? `${address.kind} ` : ""}address for ${person.data.name}: ${text.replaceAll("\n", ", ")} (opens in a new tab)`}
                    >
                      <MapPin size={18} aria-hidden="true" />
                      <span>
                        <span className="con-address-kind">{kind}</span>
                        <span className="con-address-text">{text}</span>
                      </span>
                    </a>
                  );
                })}
                {webId && (
                  <a href={webId} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={18} aria-hidden="true" />
                    <span>Open Solid profile{profileName ? `: ${profileName}` : ""}</span>
                  </a>
                )}
              </div>
              {person.data.note && (
                <div className="con-note">
                  <h3>Notes</h3>
                  <p>{person.data.note}</p>
                </div>
              )}
              <TagInput
                label="Labels"
                options={state.data.groups.map((g) => ({
                  id: `${g.url}#this`,
                  label: g.data.name,
                }))}
                value={labels}
                onChange={(next) => {
                  for (const label of new Set([...labels, ...next]))
                    if (labels.includes(label) !== next.includes(label))
                      void mutations.setLabel(id, label, next.includes(label)).catch(() => {});
                }}
              />
              <AlertDialog open={confirm} onOpenChange={setConfirm}>
                <AlertDialogContent>
                  <AlertDialogTitle>Delete {person.data.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It moves to Trash, where you can restore it for 30 days.
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        onClose();
                        void mutations.delete(id).catch(() => {});
                      }}
                    >
                      Delete contact
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          );
        },
      })}
    </section>
  );
}
