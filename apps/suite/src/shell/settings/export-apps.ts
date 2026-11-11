// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, createPodScopedFetch, refuseRedirects } from "@jeswr/guarded-fetch";
import { readContainerMembers } from "@jeswr/ldp-container";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { NS } from "@jeswr/suite-vocab";

import { exportFolders } from "./export-job";

/** Root choices remain available even when the complete inventory exceeds its safety limits. */
export async function exportRootFolders(
  fetch: typeof globalThis.fetch,
  root: string,
  signal: AbortSignal,
) {
  const transport = createPodScopedFetch(root, { fetch: refuseRedirects(fetch) });
  const members = await readContainerMembers(transport, root, { scope: root, signal });
  return exportFolders({
    root,
    estimatedBytes: 0,
    unknownSizes: 0,
    resources: (members ?? []).map((member) => ({
      url: member.url,
      kind: member.container ? "container" : "binary",
      contentType: "",
    })),
  });
}

const appClasses = [
  ["Docs", `${NS.POD_DOCS}Document`],
  ["Tasks", `${NS.TASK}Task`],
  ["Tasks", "http://www.w3.org/2005/01/wf/flow#Task"],
  ["Contacts", `${NS.VCARD}AddressBook`],
  ["Calendar", `${NS.SCHEMA}Event`],
  ["Calendar", `${NS.SCHEDULING}Calendar`],
  ["Calendar", `${NS.SCHEDULING}CalendarEvent`],
  ["Notes", `${NS.SCHEMA}TextDigitalDocument`],
  ["Photos", `${NS.SCHEMA}ImageObject`],
  ["Photos", `${NS.SCHEMA}Photograph`],
  ["Photos", `${NS.SCHEMA}ImageGallery`],
  ["Sheets", `${NS.SCHEMA}SpreadsheetDigitalDocument`],
  ["Mail", `${NS.SCHEMA}EmailMessage`],
  ["Money", `${NS.FINANCE}FinancialAccount`],
  ["Health", `${NS.HEALTH}HealthRecord`],
  ["Chat", `${NS.POD_CHAT}ChatRoom`],
  ["Music", `${NS.SCHEMA}MusicRecording`],
  ["Agent", `${NS.AGENT}AgentWorkspace`],
] as const;

/** Optional discovery hints use the SDK; a missing index never prevents whole-pod export. */
export async function exportApps(
  fetch: typeof globalThis.fetch,
  root: string,
  webId: string,
  signal: AbortSignal,
) {
  const transport = refuseRedirects(fetch);
  const scoped: typeof globalThis.fetch = async (input, init) =>
    transport(assertWithinPodScope(root, String(input)), { ...init, signal });
  const { storage, features } = await createPodClient({
    fetch: scoped,
    storage: root,
    signal,
    capabilities: createMemoryCache(),
  });
  const index = createTypeIndex({ storage, features, profile: webId, fetch: scoped });
  const found = await index.findAll(appClasses.map(([, iri]) => iri));
  signal.throwIfAborted();
  return appClasses.flatMap(([label, iri]) =>
    (found.get(iri) ?? []).flatMap((raw) => {
      try {
        const url = new URL(assertWithinPodScope(root, raw));
        url.hash = "";
        if (url.search) return [];
        return [{ url: url.href, label: `${label} — ${url.pathname}` }];
      } catch {
        return [];
      }
    }),
  );
}
