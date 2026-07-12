// AUTHORED-BY Claude Fable 5
//
// AppErrorBoundary — the app-level crash-resilience boundary (cross-app parity
// #72/#73), wrapping the shared @jeswr/app-shell <ErrorBoundary> around this
// app's routed root. A render/lifecycle error anywhere in <App/> shows the
// themed default <ErrorState> panel ("Something went wrong" + Try again)
// instead of white-screening the tab.
//
// RESET KEY: pod-photos is ROUTER-FREE (no pathname routing — see App.tsx), so
// the app's only "navigation" is a session-identity change: login, logout, or
// an autologin identity switch. We therefore pass the session's `webId` as the
// boundary's `resetKey` — when it changes (`Object.is`) while an error is
// showing, the boundary clears the error and re-renders, exactly as a pathname
// change would in a routed sibling app. The manual `Try again` button (the
// default fallback's `onRetry={reset}`) covers same-identity recovery.
//
// PLACEMENT: inside <ThemeProvider> (the fallback panel themes via the shell's
// `--as-*` tokens + `.dark` class) and inside <SessionProvider> (this component
// reads `useSession()` for the resetKey — and an auth-seam failure must surface
// through the provider's own `error` state, not be swallowed here), but AROUND
// the routed content (<App/>). See main.tsx.
import { ErrorBoundary } from "@jeswr/app-shell";
import type { ReactNode } from "react";
import { useSession } from "./auth/SessionProvider";

export function AppErrorBoundary({ children }: { children?: ReactNode }) {
  const { webId } = useSession();
  // `fallback` intentionally UNSET → the default themed <ErrorState
  // onRetry={reset}/>: generic copy only, no error internals/stack in the UI.
  return <ErrorBoundary resetKey={webId}>{children}</ErrorBoundary>;
}
