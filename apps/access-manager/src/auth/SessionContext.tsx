// AUTHORED-BY Claude Fable 5
// AUTHORED-BY GPT-6.1 Sol
//
// The React session seam. A Session is just `{ webId, fetch }` — the
// authenticated fetch handed down from pod-auth. Every view reads
// the session from context and passes `session.fetch` into the data layer, so
// UI tests inject a stubbed session and never touch real auth.

import { publicFetch as pristineFetch } from "@jeswr/app-session";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { SolidFetch } from "../lib/http.js";

export interface Session {
  webId: string;
  /** The authenticated (DPoP-bound) fetch — the injectable seam. */
  fetch: SolidFetch;
}

const SessionContext = createContext<Session | null>(null);
const PublicFetchContext = createContext<SolidFetch | null>(null);

export function SessionProvider({
  session,
  publicFetch,
  children,
}: {
  session: Session | null;
  /** Real sessions supply the pristine transport; demo/test sessions use their inert fetch. */
  publicFetch?: SolidFetch;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={session}>
      <PublicFetchContext.Provider value={publicFetch ?? pristineFetch}>
        {children}
      </PublicFetchContext.Provider>
    </SessionContext.Provider>
  );
}

/** Profile reads use the public transport, including profiles inside a credential root. */
export function usePublicFetch(fallback: SolidFetch): SolidFetch {
  return useContext(PublicFetchContext) ?? fallback;
}

/** The current session; throws when used outside a logged-in subtree. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession used outside a logged-in SessionProvider");
  return session;
}
