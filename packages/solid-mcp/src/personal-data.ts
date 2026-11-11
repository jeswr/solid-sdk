// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { NanopubStore } from "@jeswr/pkg-memory";
import { PROTECTED_AGENT_CONTAINERS } from "./agent-layout.js";
import { podScopedUrlOrUndefined, requirePodScopedUrl } from "./auth.js";
import type { PodPort } from "./pod-port.js";

export const PERSONAL_DATA_DENIED = "Personal data requires a purpose-limited tool";

/** The store owns the layout. Derive its parent, including policy, locks and audit. */
export function personalDataRoot(pod: PodPort): string {
  // Layout inspection performs no I/O and does not require a configured owner.
  const root = new URL(pod.root).href;
  const store = new NanopubStore({ ...pod, root, webId: root });
  return new URL("../", store.container).href;
}

export function auditContainer(pod: PodPort): string {
  return new URL("audit/", personalDataRoot(pod)).href;
}

function within(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}.`);
}

/** ACLs must stay within the same memory area that generic tools cannot access. */
export function personalAclOptions(pod: PodPort) {
  const root = new URL(personalDataRoot(pod));
  const prefixes = pathAliases(root);
  return {
    allowAclUrl(url: string): boolean {
      const target = new URL(url);
      return (
        target.origin === root.origin &&
        pathAliases(target).every((path) => prefixes.some((prefix) => within(path, prefix)))
      );
    },
  };
}

/** Check every decoding stage: backends may decode different numbers of times. */
function pathAliases(url: URL): string[] {
  let path = url.pathname;
  const aliases: string[] = [];
  for (let depth = 0; ; depth++) {
    aliases.push(normalizedPath(path));
    if (!/%[\da-f]{2}/iu.test(path)) return aliases;
    if (depth === 8) throw new Error(PERSONAL_DATA_DENIED);
    // Keep literal malformed escapes in unrelated filenames, while decoding
    // every valid escape that could spell a protected segment or delimiter.
    path = decodeURIComponent(path.replace(/%(?![\da-f]{2})/giu, "%25"));
  }
}

/** Conservative identity for servers that fold case or normalize paths. */
function normalizedPath(path: string): string {
  const segments: string[] = [];
  // Some transports decode before splitting URL components or path parameters.
  path = path.split(/[?#]/u)[0] ?? "";
  for (const segment of path.replaceAll("\\", "/").toLowerCase().split("/")) {
    const part = segment.split(";")[0];
    if (part === "..") segments.pop();
    else if (part && part !== ".") segments.push(part);
  }
  return `/${segments.join("/")}`;
}

/** Auxiliary-resource suffixes whose content can govern access to their subject. */
const AUXILIARY_SUFFIXES = [".acl", ".acr", ".meta"] as const;

/**
 * Whether `path` (normalized) is an ACL/ACR/metadata resource of the root, of an ancestor of
 * `prefix`, or of `prefix` itself: both `container/.acl` and the slashless `container.acl` forms.
 */
function auxiliaryGovernsPrefix(path: string, prefix: string): boolean {
  const segments = path.split("/").filter(Boolean);
  const last = segments.pop();
  if (last === undefined) return false;
  let subject: string[];
  if ((AUXILIARY_SUFFIXES as readonly string[]).includes(last)) subject = segments;
  else {
    const suffix = AUXILIARY_SUFFIXES.find((value) => last.endsWith(value));
    if (suffix === undefined) return false;
    subject = [...segments, last.slice(0, -suffix.length)];
  }
  const subjectPath = `/${subject.filter(Boolean).join("/")}`;
  return subjectPath === "/" || prefix === subjectPath || prefix.startsWith(`${subjectPath}/`);
}

/** Per-mutation discovery, including absent areas and shared inheritance ancestors. */
export async function governingAuxiliaries(pod: PodPort): Promise<ReadonlySet<string>> {
  try {
    if (!pod.head) throw new Error();
    const root = new URL(pod.root);
    const profile = pod.webId && podScopedUrlOrUndefined({ podRoot: pod.root }, pod.webId);
    const areas = [
      personalDataRoot(pod),
      ...PROTECTED_AGENT_CONTAINERS.map((path) => new URL(path, root).href),
      ...(profile ? [profile] : []),
    ];
    const targets = new Set([root.href]);
    for (const area of areas) {
      const target = new URL(area);
      target.hash = "";
      targets.add(target.href);
      for (let ancestor = new URL("./", target); ; ancestor = new URL("../", ancestor)) {
        requirePodScopedUrl({ podRoot: root.href }, ancestor.href);
        targets.add(ancestor.href);
        if (ancestor.href === root.href) break;
      }
    }
    const auxiliaries = new Set<string>();
    const rootPaths = pathAliases(root);
    for (const target of targets) {
      const metadata = await pod.head(target);
      // A successful HEAD alone cannot establish the governing auxiliary resources.
      if (!metadata.acl && !metadata.describedby?.length) throw new Error();
      for (const association of [metadata.acl, ...(metadata.describedby ?? [])]) {
        if (association === undefined) continue;
        const url = new URL(association); // Portable ports promise absolute metadata.
        requirePodScopedUrl({ podRoot: root.href }, url.href);
        for (const path of pathAliases(url)) {
          // Every decoding stage must remain in the pod, including double-encoded traversal.
          if (
            !rootPaths.some(
              (prefix) => prefix === "/" || path === prefix || path.startsWith(`${prefix}/`),
            )
          )
            throw new Error();
          auxiliaries.add(path);
        }
      }
    }
    return auxiliaries;
  } catch {
    throw new Error(PERSONAL_DATA_DENIED);
  }
}

/** Apply the same conservative URL identities to advertised associations and final aliases. */
export function requireAuxiliaryMutationAccess(
  url: string,
  auxiliaries: ReadonlySet<string>,
): void {
  try {
    if (pathAliases(new URL(url)).some((path) => auxiliaries.has(path))) throw new Error();
  } catch {
    throw new Error(PERSONAL_DATA_DENIED);
  }
}

/** No URL or backend-supplied value may enter this diagnostic. */
export function requireGenericPodAccess(
  pod: PodPort,
  url: string,
  mutation = false,
  profileDiscovery = false,
): void {
  try {
    const target = new URL(url, pod.root);
    const protectedRoot = new URL(personalDataRoot(pod));
    if (target.origin !== protectedRoot.origin) return; // The pod-scope guard owns this.
    const prefixes = [
      protectedRoot,
      ...PROTECTED_AGENT_CONTAINERS.map((path) => new URL(path, pod.root)),
    ].flatMap(pathAliases);
    // The whole profile document carries Contact data, independent of its WebID fragment.
    const profile = pod.webId && podScopedUrlOrUndefined({ podRoot: pod.root }, pod.webId);
    if (profile && (!profileDiscovery || mutation)) prefixes.push(...pathAliases(new URL(profile)));
    for (const path of pathAliases(target)) {
      if (
        prefixes.some(
          (prefix) =>
            // Protect slashless container ACL/metadata aliases too.
            within(path, prefix) ||
            // Replacing/deleting an ancestor can destroy the protected subtree.
            (mutation && prefix.startsWith(`${path}/`)) ||
            // An ancestor's ACL/ACR/metadata governs the protected subtree by inheritance.
            (mutation && auxiliaryGovernsPrefix(path, prefix)),
        )
      )
        throw new Error();
    }
  } catch {
    throw new Error(PERSONAL_DATA_DENIED);
  }
}
