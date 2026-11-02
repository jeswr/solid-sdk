// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { toast } from "@jeswr/suite-ui";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { sectionContacts } from "../lib/list";
import { ContactsController } from "./controller";
import {
  contactLabels,
  decodeContactRef,
  projectContact,
  readStars,
  starsKey,
  toggleStar,
} from "./data";
import { browserIntentStorage } from "./journal";
import { dismissedKey, dismissGroup, findDuplicates, readDismissed } from "./merge";

const Context = createContext<ContactsController | null>(null);
const StarsContext = createContext<{ stars: ReadonlySet<string>; toggle(id: string): void }>({
  stars: new Set(),
  toggle: () => {},
});
const DismissedContext = createContext<{
  dismissed: ReadonlySet<string>;
  dismiss(contactIds: readonly string[]): void;
}>({ dismissed: new Set(), dismiss: () => {} });
export function ContactsProvider({ children }: { children: ReactNode }) {
  const session = usePodSessionState();
  const controller = useMemo(() => {
    if (session.status !== "ready") return null;
    const controller = new ContactsController(
      session.session.fetch,
      session.session.storageUrl,
      session.session.webId,
      (message) => toast.error(message, { duration: Infinity }),
      browserIntentStorage,
      (token) =>
        toast("Contact deleted", {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: () => {
              void controller.undo(token).catch(() => {});
            },
          },
        }),
    );
    return controller;
  }, [session]);
  const [stars, setStars] = useState<ReadonlySet<string>>(new Set());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // Consecutive dismissals before a re-render must build on each other.
  const latestDismissed = useRef(dismissed);
  latestDismissed.current = dismissed;
  useEffect(() => {
    if (session.status !== "ready" || !controller) return;
    const { session: pod } = session;
    const syncStars = () => {
      try {
        setStars(readStars(localStorage, pod.webId));
      } catch {
        setStars(new Set());
      }
    };
    const syncDismissed = () => {
      try {
        setDismissed(readDismissed(localStorage, pod.webId));
      } catch {
        setDismissed(new Set());
      }
    };
    syncStars();
    syncDismissed();
    void controller.refresh();
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = pod.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void controller.refresh();
      }, 60);
    });
    const sync = (event: StorageEvent) => {
      if (event.key === starsKey(pod.webId)) syncStars();
      if (event.key === dismissedKey(pod.webId)) syncDismissed();
      if (event.key?.startsWith(`solid-suite:contacts:intent:${encodeURIComponent(pod.webId)}:`)) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          void controller.refresh();
        }, 60);
      }
    };
    addEventListener("storage", sync);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      removeEventListener("storage", sync);
    };
  }, [session, controller]);
  if (session.status === "error")
    return <div role="alert">This browser couldn't open the demo pod's storage.</div>;
  if (!controller || session.status !== "ready") return <div role="status">Opening Contacts…</div>;
  return (
    <Context value={controller}>
      <StarsContext
        value={{
          stars,
          toggle: (id) => {
            try {
              setStars(toggleStar(localStorage, session.session.webId, stars, id));
            } catch {
              toast.error("This browser could not save your starred contacts.");
            }
          },
        }}
      >
        <DismissedContext
          value={{
            dismissed,
            dismiss: (contactIds) => {
              try {
                latestDismissed.current = dismissGroup(
                  localStorage,
                  session.session.webId,
                  latestDismissed.current,
                  contactIds,
                );
                setDismissed(latestDismissed.current);
              } catch {
                toast.error("This browser could not remember that these contacts are different.");
              }
            },
          }}
        >
          {children}
        </DismissedContext>
      </StarsContext>
    </Context>
  );
}
function useController() {
  const controller = useContext(Context);
  if (!controller) throw new Error("ContactsProvider required");
  return controller;
}
export function useAddressBook() {
  const controller = useController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return {
    ...state,
    book: state.data.book,
    retry: () => controller.refresh(),
    createAddressBook: () => controller.createBook(),
  };
}
export function useGroups() {
  return useAddressBook().data.groups;
}
export function useContacts() {
  const state = useAddressBook();
  const contacts = useMemo(() => state.data.people.map(projectContact), [state.data.people]);
  return {
    ...state,
    contacts,
    sections: useMemo(() => sectionContacts(contacts), [contacts]),
    labels: (id: string) => contactLabels(id, state.data.groups),
  };
}
export function useContact(ref: string) {
  const state = useAddressBook();
  let url: string | undefined;
  try {
    if (state.book) url = decodeContactRef(state.book.url, ref);
  } catch {
    /* Invalid references render the not-found state without fetching. */
  }
  return { ...state, contact: state.data.people.find((person) => person.url === url) };
}
export function useContactMutations() {
  return useController();
}
/** Likely duplicate groups over the visible (optimistic) people, minus dismissed pairs. */
export function useDuplicates() {
  const { data } = useAddressBook();
  const { dismissed, dismiss } = useContext(DismissedContext);
  const groups = useMemo(() => findDuplicates(data.people, dismissed), [data.people, dismissed]);
  return { groups, dismiss };
}
export function useStarred() {
  return useContext(StarsContext);
}
