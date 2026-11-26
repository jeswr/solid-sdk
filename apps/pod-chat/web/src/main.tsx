// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Client entry: the session provider lazily creates one shared pod-auth core.
import { SessionProvider } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { getPodAuth, legacyCredentials } from "./auth/pod-auth";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    {/* ThemeProvider wraps everything (theme is session-independent, so it sits
        OUTSIDE the SessionProvider). It defaults to "system" and persists to
        localStorage key "pod-chat:app-shell-theme" — the SAME key the no-flash <script> in
        index.html reads, so the pre-paint class and the React state always agree.
        The `.dark` class it toggles on <html> drives both the app-shell components'
        `dark:` utilities and the host chrome (whose --bg/--ink/… aliases map onto
        the OKLCH tokens in styles.css). */}
    <ThemeProvider storageKey="pod-chat:app-shell-theme">
      <SessionProvider
        getPodAuth={getPodAuth}
        appName="Pod Chat"
        dev={import.meta.env.DEV}
        legacyCredentials={legacyCredentials}
      >
        {/* Crash-resilience boundary (#72/#73 parity): INSIDE the Theme/Session
            providers (the fallback themes; the resetKey reads the session) but
            AROUND the routed content — a render error in <App/> shows the shared
            themed <ErrorState> instead of white-screening. See AppErrorBoundary.tsx. */}
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </SessionProvider>
    </ThemeProvider>
  </StrictMode>,
);
