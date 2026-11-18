// AUTHORED-BY Claude Opus 5.5
import { createRoot } from "react-dom/client";
import type { SampleFn } from "./engine/core.js";
import { Session } from "./engine/session.js";
import { App } from "./ui/App.js";
import "./styles.css";

const session = new Session();

/** On a host that offers a model (the hosted preview's `sample` capability), allow a live core. */
type Host = { use?: (name: string) => Promise<unknown> };
const host = (window as unknown as { claude?: Host }).claude;
if (host?.use) {
  void host
    .use("sample")
    .then((sample) => {
      if (typeof sample === "function") session.enableLive(sample as SampleFn);
    })
    .catch(() => undefined);
}

const element = document.getElementById("root");
if (!element) throw new Error("Missing root element");
createRoot(element).render(<App session={session} />);
