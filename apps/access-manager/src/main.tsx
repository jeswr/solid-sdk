// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Claude Opus 5.5
// Entry point. Access Manager now lives in Solid Suite Permissions, so the app sends people
// there (see suite-redirect.ts) and shows a link while the browser follows it. The ?demo-gated
// read-only demo (the old views over an inert in-browser fixture pod — no auth, no network, no
// writes) is still reachable ONLY via the ?demo query param.
import "@jeswr/solid-elements";
import { createRoot } from "react-dom/client";
import { demoViewFromSearch } from "./demo/gate.js";
import { goToSuite, suitePermissionsUrl } from "./suite-redirect.js";
import { MovedNotice } from "./ui/MovedNotice.jsx";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
const root = createRoot(rootEl);

const demoView = demoViewFromSearch(window.location.search);
if (demoView !== null) {
  // Code-split: the demo fixtures never load in the redirect path.
  void import("./demo/DemoApp.jsx").then(({ DemoApp }) => {
    root.render(<DemoApp view={demoView} />);
  });
} else {
  const target = suitePermissionsUrl();
  root.render(<MovedNotice href={target} />);
  goToSuite(target);
}
