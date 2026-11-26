// AUTHORED-BY GPT-6.1 Sol
import type { ReactNode } from "react";
import { useSession } from "./SessionProvider.js";
import type { DerivedSession } from "./session-derivation.js";

/** The narrowed identity handed to render-function children. */
export interface SignedInSession {
  webId: string;
  session: DerivedSession;
}

export interface SessionGateProps {
  /** Heading on the loading card. */
  appName: string;
  /** Configured sign-in screen, shown once startup settles without a session. */
  login: ReactNode;
  /**
   * Application content, mounted only when both identity and profile are present. A function
   * receives the non-null WebID and session, so callers need no second null check.
   */
  children: ReactNode | ((signedIn: SignedInSession) => ReactNode);
  /** Replace the default live status text, for example with a loading spinner. */
  renderLoading?: (label: string) => ReactNode;
}

/** Present session startup, sign-in and signed-in content without changing authentication. */
export function SessionGate({ appName, login, children, renderLoading }: SessionGateProps) {
  const { webId, session, restoringSession, ready, error } = useSession();
  if (!webId || !session) {
    if (restoringSession || (!ready && !error) || (webId && !session)) {
      const label = restoringSession ? "Restoring your session…" : "Loading your account…";
      return (
        <main className="login-screen" aria-busy="true">
          <section className="login-card">
            <h1>{appName}</h1>
            <p className="login-sub">
              {renderLoading ? renderLoading(label) : <span role="status">{label}</span>}
            </p>
          </section>
        </main>
      );
    }
    return login;
  }
  return typeof children === "function" ? children({ webId, session }) : children;
}
