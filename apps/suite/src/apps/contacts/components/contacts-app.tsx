// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, Toaster, toast } from "@jeswr/suite-ui";
import { Download, Plus, Star, Tag, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { PodSessionProvider } from "@/lib/session/pod-session";
import {
  ContactsProvider,
  useAddressBook,
  useContactMutations,
  useGroups,
  useStarred,
} from "../state/contacts-context";
import { encodeContactRef } from "../state/data";
import { ContactDetail } from "./contact-detail";
import { ContactExport } from "./contact-export";
import { ContactsList } from "./contacts-list";

const ignoreFailure = () => {}; // The controller reports and reconciles write errors.
function Sidebar() {
  const { book, data } = useAddressBook();
  const groups = useGroups();
  const mutations = useContactMutations();
  const { stars } = useStarred();
  const pathname = usePathname();
  const [menu, setMenu] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const link = (href: string, label: string, icon: ReactNode, count?: number) => (
    <Link
      className="con-nav-link"
      href={href}
      aria-current={pathname === href ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && <span className="con-count">{count}</span>}
    </Link>
  );
  return (
    <div className="con-sidebar">
      <Button variant="outline" asChild>
        <Link href="/contacts/new">
          <Plus size={18} aria-hidden="true" />
          New contact
        </Link>
      </Button>
      <nav aria-label="Contact views">
        {link(
          "/contacts",
          "All contacts",
          <Users size={18} aria-hidden="true" />,
          data.people.length,
        )}
        {link(
          "/contacts/starred",
          "Starred",
          <Star size={18} aria-hidden="true" />,
          data.people.filter((p) => stars.has(`${p.url}#this`)).length,
        )}
      </nav>
      <h2>Labels</h2>
      <nav aria-label="Labels">
        {groups.map((group) => {
          const id = `${group.url}#this`;
          return (
            <div className="con-label-row" key={id}>
              {link(
                `/contacts/label/${book ? encodeContactRef(book.url, id) : ""}`,
                group.data.name,
                <Tag size={16} aria-hidden="true" />,
                data.people.filter((p) => group.data.members?.includes(`${p.url}#this`)).length,
              )}
              <button
                type="button"
                className="con-icon"
                aria-label={`Manage ${group.data.name}`}
                aria-expanded={menu === id}
                onClick={() => setMenu(menu === id ? undefined : id)}
              >
                ···
              </button>
              {menu === id && (
                <div className="con-label-menu">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditing(id);
                      setName(group.data.name);
                      setMenu(undefined);
                    }}
                  >
                    Rename label
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMenu(undefined);
                      void mutations.deleteLabel(id).catch(ignoreFailure);
                    }}
                  >
                    Delete label
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      {editing !== undefined ? (
        <form
          className="con-label-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void (
              editing === "new"
                ? mutations.createLabel(name.trim())
                : mutations.renameLabel(editing, name.trim())
            ).catch(ignoreFailure);
            setEditing(undefined);
          }}
        >
          <label htmlFor="con-label-name">Label name</label>
          <input
            id="con-label-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
          <Button type="submit">Save label</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          disabled={!book}
          onClick={() => {
            setName("");
            setEditing("new");
          }}
        >
          <Plus size={16} aria-hidden="true" />
          Create label
        </Button>
      )}
      {link("/contacts/import", "Import", <Download size={18} aria-hidden="true" />)}
      <ContactExport contacts={data.people.map((person) => person.data)} all />
    </div>
  );
}
function MigrationBanner() {
  const { data, book } = useAddressBook();
  const mutations = useContactMutations();
  const [dismissed, setDismissed] = useState(false);
  const [moving, setMoving] = useState(false);
  if (dismissed || !data.flat.length) return null;
  return (
    <section className="con-migration" aria-label="Pod Manager contacts">
      <p>{data.flat.length} contacts from Pod Manager aren't in your address book yet</p>
      <Button
        variant="outline"
        disabled={!book || moving}
        onClick={() => {
          setMoving(true);
          void mutations
            .migrate()
            .then(({ moved, failed }) => {
              toast(
                failed
                  ? `${moved} contacts moved. ${failed} could not be moved; their originals are safe. Retry the remaining contacts.`
                  : `${moved} contacts moved into your address book.`,
              );
            })
            .finally(() => setMoving(false));
        }}
      >
        {moving ? "Moving…" : "Move them"}
      </Button>
      <button
        type="button"
        className="con-icon"
        aria-label="Dismiss migration banner"
        onClick={() => setDismissed(true)}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
function ContactsChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const state = useAddressBook();
  const match = /^\/contacts\/c\/([^/]+)$/.exec(pathname);
  const ref = match?.[1];
  const formRoute = pathname === "/contacts/new" || /^\/contacts\/c\/[^/]+\/edit$/.test(pathname);
  const [wide, setWide] = useState(false);
  const returnPath = useRef("/contacts");
  const openedId = useRef<string | null>(null);
  const restoreFocus = useRef(false);
  const listHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = matchMedia("(min-width: 1024px)");
    const change = () => setWide(query.matches);
    change();
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const listRoute =
    pathname === "/contacts" ||
    pathname === "/contacts/starred" ||
    pathname.startsWith("/contacts/label/");
  if (listRoute) returnPath.current = pathname + (params.toString() ? `?${params.toString()}` : "");
  if (pathname === "/contacts/new") returnPath.current = "/contacts";
  const close = () => {
    restoreFocus.current = true;
    router.push(returnPath.current);
  };
  // Route completion makes the mobile list visible. Its virtual rows may arrive after layout;
  // find the contact by identity rather than focusing a detached or still-hidden trigger.
  useEffect(() => {
    const host = listHost.current;
    if (!listRoute || !restoreFocus.current || !host) return;
    const observer = new MutationObserver(focus);
    function focus() {
      const person = [...(host?.querySelectorAll<HTMLElement>("[data-contact-id]") ?? [])].find(
        (element) => element.dataset.contactId === openedId.current,
      );
      const target =
        person?.closest<HTMLElement>("[data-collection-item]") ??
        host?.querySelector<HTMLElement>("[data-collection-item][tabindex='0']") ??
        host?.querySelector<HTMLElement>("[data-collection-item]") ??
        host?.querySelector<HTMLElement>(".con-list button, .con-list a");
      if (!target) return;
      target.focus({ preventScroll: true });
      restoreFocus.current = false;
      observer.disconnect();
    }
    observer.observe(host, { childList: true, subtree: true });
    const frame = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [listRoute]);
  useEffect(() => {
    if (!ref) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("[role='alertdialog']") &&
        !(event.target as HTMLElement).closest("[role='combobox'][aria-expanded='true']")
      ) {
        event.preventDefault();
        close();
      }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  const detail = ref ? <ContactDetail contactRef={ref} onClose={close} /> : undefined;
  const basePath = ref || formRoute ? (returnPath.current.split("?")[0] as string) : pathname;
  return (
    <SuiteFrame
      app="contacts"
      sidebar={<Sidebar />}
      context={<span>Contacts</span>}
      search={{
        placeholder: "Search Contacts",
        action: basePath,
        scopeLabel: "Contacts",
        query: params.get("q") ?? "",
      }}
      details={wide ? detail : undefined}
      onDetailsClose={close}
    >
      <div className="con-app">
        <div className="con-save" role="status" aria-live="polite">
          {state.saving ? "Saving…" : ""}
        </div>
        {(listRoute || ref || (formRoute && wide)) && (
          <>
            <div
              ref={listHost}
              className={ref && !wide ? "con-list-host con-hidden" : "con-list-host"}
            >
              <MigrationBanner />
              {state.book && state.data.registrationPending && (
                <section className="con-migration" aria-label="Address book registration">
                  <p>Your address book is ready. Finish setup so other apps can find it.</p>
                  <Button
                    variant="outline"
                    disabled={state.saving}
                    onClick={() => {
                      void state.createAddressBook().catch(ignoreFailure);
                    }}
                  >
                    Retry registration
                  </Button>
                </section>
              )}
              <ContactsList
                path={basePath}
                onOpen={(contact) => {
                  if (!state.book) return;
                  openedId.current = contact.id;
                  router.push(
                    `/contacts/c/${encodeContactRef(state.book.url, contact.id)}${params.toString() ? `?${params.toString()}` : ""}`,
                  );
                }}
              />
            </div>
            {!wide && detail}
          </>
        )}
        {!listRoute && !ref && children}
      </div>
    </SuiteFrame>
  );
}
export function ContactsApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <ContactsProvider>
        <ContactsChrome>{children}</ContactsChrome>
      </ContactsProvider>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
