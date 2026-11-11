// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-6.1-Sol
//
// The React session seam. A Session carries the WebID and the LoginController's
// authenticated and pristine public fetches. Every view reads
// the session from context and passes `session.fetch` into the data layer, so
// UI tests inject a stubbed session and never touch real auth.

import { publicTransport } from "@jeswr/pod-access/requests-solid";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { SolidFetch } from "../lib/http.js";

export interface Session {
  webId: string;
  /** The authenticated (DPoP-bound) fetch — the injectable seam. */
  fetch: SolidFetch;
  /** Pristine public fetch from LoginController, or an explicit offline test/demo transport. */
  publicFetch: SolidFetch;
}

const publicTransports = new WeakMap<Session, SolidFetch>();

/** A stable, credential-free transport for the lifetime of this session. */
export function publicFetchFor(session: Session): SolidFetch {
  let transport = publicTransports.get(session);
  if (!transport) {
    transport = publicTransport(session.publicFetch);
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
