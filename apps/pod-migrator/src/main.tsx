// AUTHORED-BY Codex GPT-6
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createConnections } from "./auth/connections.js";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("Missing root element");
createRoot(element).render(<App connections={createConnections(location.origin)} />);
