// AUTHORED-BY Codex GPT-6.1-Sol
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { PreferencesError } from "./value.js";

/** Public pod-access has policy builders, but no exported container-provisioning helper. */
export async function ensureOwnerOnly(
  storage: StorageClient,
  container: string,
  webId: string,
  signal: AbortSignal,
) {
  function active() {
    if (signal.aborted) throw new PreferencesError("session-changed");
  }
  active();
  const feature = storage.features.accessControl;
  if (
    storage.protocol !== "solid" ||
    feature.state !== "available" ||
    feature.detail.model !== "wac"
  )
    throw new PreferencesError("unsupported-access");
  const links = (await storage.head(container, { signal })).links.get("acl");
  active();
  if (links?.length !== 1) throw new PreferencesError("unsupported-access");
  const url = (links[0] as { target: string }).target;
  const parsed = new URL(url);
  if (!storage.isWithinStorage(url) || parsed.search || parsed.hash)
    throw new PreferencesError("unsafe-location");
  const policy = ownerPolicy(webId, true);
  // Owner-only is set once, when the container has no ACL of its own. An existing ACL is the
  // owner's choice (for example, deliberately sharing settings) and is never rewritten here.
  // AUTHORED-BY Claude Opus 5.5
  try {
    await storage.head(url, { signal });
    active();
    return;
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "not-found") throw error;
  }
  active();
  const parent = new URL(".", url).href;
  const name = decodeURIComponent(parsed.pathname.slice(parsed.pathname.lastIndexOf("/") + 1));
  const body = await writeWac(policy, container, url);
  active();
  await storage.create(parent, body, {
    name,
    contentType: "text/turtle",
    signal,
  });
}
