// AUTHORED-BY Claude Fable 5
// Entry point: register the web components, then EITHER mount the ?demo-gated
// read-only demo (the real views over an inert in-browser fixture pod — no
// auth, no network, no writes) OR build the real LoginController
// (reactive-auth + silent session restore) and mount the app. Demo mode is
// reachable ONLY via the ?demo query param; the real path is unchanged.
import "@jeswr/solid-elements";
import { ThemeProvider } from "@jeswr/app-shell";
import { createRoot } from "react-dom/client";
import { buildController } from "./auth/controller.js";
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
  // parity): defaults to "system", persists to localStorage "app-shell-theme",
  // and toggles the `.dark` class on <html>. Without it the logged-in Shell's
  // ThemeToggle (useTheme) throws and the post-login UI white-screens. The
  // ?demo branch above is mutually exclusive and DemoApp mounts its OWN
  // provider (it must stay self-contained — tests render it directly), so
  // there is never a double wrap.
  root.render(
    <ThemeProvider>
      <App controller={buildController()} />
    </ThemeProvider>,
  );
}
