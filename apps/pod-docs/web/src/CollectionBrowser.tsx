// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { DocumentBrowser } from "@jeswr/pod-docs/ui";
import { useState } from "react";
import { allowInsecureLoopback } from "./auth/pod-auth";

type Selection = { webId: string; podRoot: string; container: string };
const keyFor = (webId: string, podRoot: string) =>
  `pod-docs:collection:${JSON.stringify([webId, podRoot])}`;

function validate(container: string, podRoot: string): string {
  const url = new URL(container);
  const root = new URL(podRoot);
  const prefix = root.pathname.replace(/\/?$/, "/");
  if (
    url.href !== container ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin !== root.origin ||
    (url.pathname !== root.pathname && !url.pathname.startsWith(prefix))
  )
    throw new Error("Invalid documents collection");
  return container;
}

/** Mounted per WebID/root so stale completions can save only their original selection. */
export function CollectionBrowser({
  webId,
  podRoot,
  fetch,
}: Pick<Selection, "webId" | "podRoot"> & { fetch: typeof globalThis.fetch }) {
  const [selection, setSelection] = useState(() => {
    try {
      const saved = localStorage.getItem(keyFor(webId, podRoot));
      return { container: saved === null ? undefined : validate(saved, podRoot), error: false };
    } catch {
      return { container: undefined, error: true };
    }
  });
  const remember = (assigned: Selection) => {
    try {
      const container = validate(assigned.container, assigned.podRoot);
      localStorage.setItem(keyFor(assigned.webId, assigned.podRoot), container);
      if (assigned.webId === webId && assigned.podRoot === podRoot)
        setSelection({ container, error: false });
    } catch {
      setSelection((current) => ({ ...current, error: true }));
      throw new Error("Unable to save the documents collection");
    }
  };
  if (selection.error)
    return (
      <p role="alert">
        Unable to restore or save your documents collection. Enable browser storage and reload.
      </p>
    );
  return (
    <DocumentBrowser
      podRoot={podRoot}
      webId={webId}
      title="Your documents"
      container={selection.container}
      onContainerChange={remember}
      fetch={fetch}
      allowInsecureLoopback={allowInsecureLoopback()}
    />
  );
}
