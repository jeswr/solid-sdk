// AUTHORED-BY Codex GPT-6.1-Sol
import { Agent } from "@solid/object";
import type { RdfIO } from "../model/io";
import { DataFactory, documentUrl, NS, node, requireHttp } from "../model/rdf";

/** Parsed containment, including a path boundary, for untrusted index and LDP links. */
export function inside(url: string, root: string): boolean {
  try {
    const child = new URL(requireHttp(url));
    const parent = new URL(requireHttp(root));
    return (
      child.origin === parent.origin &&
      child.pathname.startsWith(parent.pathname.replace(/\/?$/, "/")) &&
      !child.search
    );
  } catch {
    return false;
  }
}
/** Public registrations plus the conventional fallback, with no profile/index writes. */
export async function discoverIssues(
  webId: string,
  io: RdfIO,
  storage?: string,
): Promise<string[]> {
  const urls = new Set<string>();
  const roots = new Set(storage ? [storage] : []);
  try {
    const { dataset } = await io.read(documentUrl(webId));
    for (const root of new Agent(webId, dataset, DataFactory).storageUrls)
      roots.add(requireHttp(root));
    const indexUrl = node(webId, dataset).iri(`${NS.SOLID}publicTypeIndex`);
    if (indexUrl && [...roots].some((root) => inside(indexUrl, root))) {
      const index = await io.read(indexUrl);
      for (const quad of index.dataset.match(
        null,
        DataFactory.namedNode(`${NS.SOLID}forClass`),
        DataFactory.namedNode(`${NS.WF}Tracker`),
      )) {
        const registration = node(quad.subject.value, index.dataset);
        if (!registration.types.has(`${NS.SOLID}TypeRegistration`)) continue;
        for (const url of registration.iris(`${NS.SOLID}instance`))
          if ([...roots].some((root) => inside(url, root))) urls.add(documentUrl(url));
      }
    }
  } catch {
    /* Missing/unreadable indexes never suppress the conventional path. */
  }
  for (const root of roots) urls.add(new URL("issue-tracker/tracker.ttl", root).href);
  return [...urls];
}
export function allowsWrite(header: string | null, append = false): boolean {
  if (header === null) return true; // Some ACP servers do not expose WAC hints.
  const modes =
    /(?:^|,)\s*user\s*=\s*"([^"]*)"/i.exec(header)?.[1]?.toLowerCase().split(/\s+/) ?? [];
  return modes.includes("write") || (append && modes.includes("append"));
}
