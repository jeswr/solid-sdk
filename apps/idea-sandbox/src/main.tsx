// AUTHORED-BY Claude Opus 5.5
import "@jeswr/app-shell/tokens.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("Missing root element");
createRoot(element).render(<App />);
