import { Repository } from "./repository";
import { trackerDocumentUrl } from "./profile";
import { registerTracker, resolveTrackersFromTypeIndex } from "./type-index";

/**
 * Workspaces: multiple projects per pod (Jira "projects" / Monday "boards").
 * Each project is a self-contained tracker — config, `issues/`, `attachments/`
 * — in its own container under `issue-tracker/<slug>/`, so per-project sharing
 * falls out of the existing container ACLs. The original
 * `issue-tracker/tracker.ttl` remains the default project. Discovery is the
 * public type index: one `wf:Tracker` registration per project.
 */

/** URI-safe kebab slug — never `:` (breaks ACL matching on some servers). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diacritics left over from NFKD
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Where a named project's tracker config lives under a pod root. */
export function projectTrackerUrl(storageUrl: string, slug: string): string {
  return new URL(`issue-tracker/${slug}/tracker.ttl`, storageUrl).toString();
}

/**
 * The user's own projects: the default tracker first, then every type-index
 * registration under this storage (deduped). Registrations elsewhere are
 * other people's trackers and not "projects" of this pod.
 */
export async function listProjects(
  webId: string,
  storageUrl: string,
  fetchImpl?: typeof fetch,
): Promise<string[]> {
  const registered = await resolveTrackersFromTypeIndex(webId, fetchImpl);
  const own = registered.filter((u) => u.startsWith(storageUrl));
  return [...new Set([trackerDocumentUrl(storageUrl), ...own])];
}

/**
 * Create a project named `name`: write its tracker config and register it in
 * the public type index. Throws when the slug is taken or empty; registration
 * is best-effort (discovery is a convenience), creation is not.
 */
export async function createProject(
  webId: string,
  storageUrl: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const title = name.trim();
  const slug = slugify(title);
  if (!slug) throw new Error("Please give the project a name.");
  const trackerUrl = projectTrackerUrl(storageUrl, slug);

  const repo = new Repository(trackerUrl, fetchImpl);
  const { exists } = await repo.loadTracker();
  if (exists) throw new Error(`A project named "${title}" already exists.`);
  await repo.ensureTracker(title);

  await registerTracker(webId, storageUrl, trackerUrl, fetchImpl);
  return trackerUrl;
}
