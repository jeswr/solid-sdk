// AUTHORED-BY Claude Fable 5
// Entry point: register the web components, build the real LoginController
// (reactive-auth + silent session restore), mount the app.
import "@jeswr/solid-elements";
import { createRoot } from "react-dom/client";
import { buildController } from "./auth/controller.js";
import { App } from "./ui/App.jsx";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element");
createRoot(rootEl).render(<App controller={buildController()} />);
