// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Client entry: SessionProvider lazily creates one page-lifetime pod-auth core.
// ThemeProvider remains outside the session so the public catalog shares the theme.
import { SessionProvider } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { APP_NAME, getPodAuth, LEGACY_CREDENTIALS } from "./auth/pod-auth";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    {/* ThemeProvider wraps everything (theme is session-independent). It defaults
        to "system" and persists to localStorage key "app-store:app-shell-theme" — the SAME
        key the no-flash <script> in index.html reads, so the pre-paint class and
        the React state always agree. The `.dark` class it toggles on <html> drives
        both the app-shell components' `dark:` utilities and the host chrome. */}
    <ThemeProvider storageKey="app-store:app-shell-theme">
      <SessionProvider
        getPodAuth={getPodAuth}
        appName={APP_NAME}
        dev={import.meta.env.DEV}
        legacyCredentials={LEGACY_CREDENTIALS}
      >
        <App />
      </SessionProvider>
    </ThemeProvider>
  </StrictMode>,
);
