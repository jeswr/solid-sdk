// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Fable 5
//
// The React session seam. A Session is just `{ webId, fetch }` — the
// authenticated fetch handed down from the LoginController. Every view reads
// the session from context and passes `session.fetch` into the data layer, so
// UI tests inject a stubbed session and never touch real auth.

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { credentialFreeFetch, type SolidFetch } from "../lib/http.js";

export interface Session {
  webId: string;
  /** The authenticated (DPoP-bound) fetch — the injectable seam. */
  fetch: SolidFetch;
  /** Optional public transport seam for the offline demo and tests. */
  publicFetch?: SolidFetch;
}

const publicTransports = new WeakMap<Session, SolidFetch>();

/** A stable, credential-free transport for the lifetime of this session. */
export function publicFetchFor(session: Session): SolidFetch {
  let transport = publicTransports.get(session);
  if (!transport) {
    transport = credentialFreeFetch(session.publicFetch ?? ((input, init) => fetch(input, init)));
    publicTransports.set(session, transport);
  }
  return transport;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The current session; throws when used outside a logged-in subtree. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession used outside a logged-in SessionProvider");
  return session;
}
