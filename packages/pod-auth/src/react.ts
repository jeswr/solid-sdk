// AUTHORED-BY Codex GPT-6.1-Sol
// Ported from solid-auth-core/src/react/index.tsx (AUTHORED-BY Claude Fable 5).
// React mirrors public identity/events. All credential handling remains in the core.
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createPodAuth,
  type Identity,
  type LoginHint,
  type PodAuth,
  type PodAuthOptions,
} from "./index.js";

export type PodAuthStatus = "restoring" | "unauthenticated" | "authenticated";

/** Credential-free session state and stable core actions. */
export interface PodAuthSession {
  status: PodAuthStatus;
  identity: Identity | null;
  webId: string | null;
  fetch: typeof fetch;
  login(hint?: LoginHint): Promise<void>;
  logout(): Promise<void>;
  error: string | null;
  auth: PodAuth;
}

export type PodAuthProviderProps = { children?: ReactNode } & (
  | { auth: PodAuth; config?: never }
  | { config: PodAuthOptions; auth?: never }
);

const Context = createContext<PodAuthSession | null>(null);

/** Adopt or create one auth instance, silently restore once, and mirror its lifecycle events. */
export function PodAuthProvider(props: PodAuthProviderProps): ReactNode {
  const authRef = useRef<PodAuth | null>(null);
  authRef.current ??= props.auth ?? createPodAuth(props.config);
  const auth = authRef.current;
  const restoreRef = useRef<Promise<Identity | null> | null>(null);
  const [status, setStatus] = useState<PodAuthStatus>("restoring");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let changed = false;
    const mirror = (identity: Identity | null) => {
      setIdentity(identity);
      setStatus(identity === null ? "unauthenticated" : "authenticated");
    };
    const stops = (["login", "restore", "logout", "expired"] as const).map((event) =>
      auth.on(event, (event) => {
        if (disposed) return;
        changed = true;
        mirror(event.identity);
      }),
    );
    // One promise across StrictMode effect replay. A later lifecycle event supersedes its result.
    restoreRef.current ??= auth.restore();
    void restoreRef.current
      .catch(() => null)
      .then((restored) => {
        if (!disposed && !changed) mirror(restored);
      });
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, [auth]);

  const handles = useMemo(
    () => ({
      login: async (hint?: LoginHint) => {
        setError(null);
        try {
          await auth.login(hint);
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setError(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
      logout: async () => {
        setError(null);
        try {
          await auth.logout();
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    }),
    [auth],
  );
  const session = useMemo<PodAuthSession>(
    () => ({
      status,
      identity,
      webId: identity?.webId ?? null,
      fetch: auth.fetch,
      ...handles,
      error,
      auth,
    }),
    [auth, handles, status, identity, error],
  );
  return createElement(Context.Provider, { value: session }, props.children);
}

/** Read the nearest provider; throw a targeted error when it is missing. */
export function usePodAuth(): PodAuthSession {
  const session = useContext(Context);
  if (session === null)
    throw new Error("usePodAuth() must be used inside a <PodAuthProvider> (@jeswr/pod-auth/react)");
  return session;
}

export type { Identity, PodAuth, PodAuthOptions } from "./index.js";
