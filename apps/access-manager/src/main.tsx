// AUTHORED-BY GPT-6.1 Sol
// Mount either the inert ?demo fixture or the real app with one page-lifetime pod-auth core.

import { SessionProvider } from "@jeswr/app-session/react";
import { ThemeProvider } from "@jeswr/app-shell";
import { createRoot } from "react-dom/client";
import { APP_NAME, getPodAuth, legacyCredentials } from "./auth/pod-auth.js";
import { demoViewFromSearch } from "./demo/gate.js";
import { App } from "./ui/App.jsx";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
const root = createRoot(rootEl);

const demoView = demoViewFromSearch(window.location.search);
if (demoView !== null) {
  // Code-split: the demo fixtures never load in the real app.
  void import("./demo/DemoApp.jsx").then(({ DemoApp }) => {
    root.render(<DemoApp view={demoView} />);
  });
} else {
  // ThemeProvider wraps the real app (suite convention — pod-drive/pod-photos
  // parity): defaults to "system", persists to localStorage "access-manager:app-shell-theme",
  // and toggles the `.dark` class on <html>. Without it the logged-in Shell's
  // ThemeToggle (useTheme) throws and the post-login UI white-screens. The
  // ?demo branch above is mutually exclusive and DemoApp mounts its OWN
  // provider (it must stay self-contained — tests render it directly), so
  // there is never a double wrap.
  root.render(
    <ThemeProvider storageKey="access-manager:app-shell-theme">
      <SessionProvider
        getPodAuth={getPodAuth}
        appName={APP_NAME}
        dev={import.meta.env.DEV}
        legacyCredentials={legacyCredentials}
      >
        <App />
      </SessionProvider>
    </ThemeProvider>,
  );
}
