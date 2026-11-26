// AUTHORED-BY Codex GPT-6.1-Sol
import { Agent } from "@solid/object";
import type { RdfIO } from "../model/io";
import { DataFactory, documentUrl, NS, node, requireHttp } from "../model/rdf";

/** Path segments that would escape or smuggle a separator once decoded. */
function unsafeRelative(relative: string): boolean {
  if (/%2f|%5c/i.test(relative)) return true;
  try {
    const decoded = decodeURIComponent(relative);
    return /[\\]/.test(decoded) || decoded.split("/").some((segment) => segment === "..");
  } catch {
    return true;
  }
}
/**
 * Parsed containment, including a path boundary, for untrusted index and LDP links. Rejects
 * fragments, query strings, credentials, and encoded slashes, backslashes or dot-dot segments.
 */
export function inside(url: string, root: string): boolean {
  try {
    const child = new URL(requireHttp(url));
    const parent = new URL(requireHttp(root));
    const scope = parent.pathname.replace(/\/?$/, "/");
    return (
      child.origin === parent.origin &&
      !/[?#]/.test(url) &&
      !child.search &&
      !child.hash &&
      child.pathname.startsWith(scope) &&
      !unsafeRelative(child.pathname.slice(scope.length))
    );
  } catch {
    return false;
  }
}
/** A direct `.ttl` child of a container, matching the base store's `isTaskMember`. */
export function isIssueMember(url: string, container: string): boolean {
  if (!inside(url, container)) return false;
  const scope = new URL(container).pathname.replace(/\/?$/, "/");
  const child = new URL(url).pathname.slice(scope.length);
  return child.endsWith(".ttl") && child.length > 4 && !child.includes("/");
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
    if (indexUrl && [...roots].some((root) => inside(documentUrl(indexUrl), root))) {
      const index = await io.read(indexUrl);
      for (const quad of index.dataset.match(
        null,
        DataFactory.namedNode(`${NS.SOLID}forClass`),
        DataFactory.namedNode(`${NS.WF}Tracker`),
      )) {
        const registration = node(quad.subject.value, index.dataset);
        if (!registration.types.has(`${NS.SOLID}TypeRegistration`)) continue;
        for (const url of registration.iris(`${NS.SOLID}instance`))
          if ([...roots].some((root) => inside(documentUrl(url), root))) urls.add(documentUrl(url));
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
