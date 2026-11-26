// AUTHORED-BY Claude Sonnet 5.5
import { useEffect, useRef, useState } from "react";

/**
 * Resolve a per-session value (for example a Type Index discovery) once a session exists.
 *
 * Returns `null` while resolving and whenever there is no session. A rejection degrades to
 * `fallback(session)` instead of stranding the view, and a stale resolution is dropped
 * after a session change or unmount. The value is bound to the session it was resolved for, so
 * one session's value is never returned beside another session, even for a single render. Re-resolves when `session` or any of `deps` change;
 * list everything `resolve` closes over (for example the session's fetch) in `deps`.
 * The hook is session-package agnostic: `session` is any value, `null`/`undefined` meaning signed out.
 */
export function useSessionResource<S, T>(
  session: S | null | undefined,
  resolve: (session: S) => Promise<T>,
  fallback: (session: S) => T,
  deps: readonly unknown[] = [],
): T | null {
  const [state, setState] = useState<{ session: S; value: T } | null>(null);
  const latest = useRef({ resolve, fallback });
  latest.current = { resolve, fallback };

  useEffect(() => {
    if (!session) {
      setState(null);
      return;
    }
    let cancelled = false;
    setState(null);
    latest.current
      .resolve(session)
      .then((resolved) => {
        if (!cancelled) setState({ session, value: resolved });
      })
      .catch(() => {
        if (!cancelled) setState({ session, value: latest.current.fallback(session) });
      });
    return () => {
      cancelled = true;
    };
  }, [session, ...deps]);

  return state && state.session === session ? state.value : null;
}
