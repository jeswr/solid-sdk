// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Client entry: the session provider lazily creates one shared pod-auth core.
import { ThemeProvider } from "@jeswr/app-shell";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionProvider } from "./auth/SessionProvider";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    {/* ThemeProvider wraps everything (theme is session-independent). It defaults
        to "system" and persists to localStorage key "pod-drive:app-shell-theme" — the SAME
        key the no-flash <script> in index.html reads, so the pre-paint class and
        the React state always agree. The `.dark` class it toggles on <html> drives
        both the app-shell components' `dark:` utilities and the host chrome (whose
        --bg/--ink/… aliases map onto the OKLCH tokens in styles.css). */}
    <ThemeProvider storageKey="pod-drive:app-shell-theme">
      <SessionProvider>
        <App />
      </SessionProvider>
    </ThemeProvider>
  </StrictMode>,
);
