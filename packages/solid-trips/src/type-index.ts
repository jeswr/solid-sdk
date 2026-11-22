// AUTHORED-BY Codex (GPT-6.1 Sol)
import { fetchRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { checkOwnerOnly } from "@jeswr/pod-access";
import { createTypeIndex } from "@jeswr/pod-type-index";
import type { StorageClient } from "@jeswr/storage-client";
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";

const PRIVATE = "http://www.w3.org/ns/solid/terms#privateTypeIndex";
const PREFS = "http://www.w3.org/ns/pim/space#preferencesFile";
/** Exact identity-document read exception; all data and mutations stay pod-scoped. */
export function tripsTypeIndex(
  storage: StorageClient,
  fetch: typeof globalThis.fetch,
  owner: string,
  demo: boolean,
) {
  const profile = new URL(owner);
  if (!/^https?:$/.test(profile.protocol) || profile.username || profile.password)
    throw new TypeError("Invalid WebID");
  profile.hash = "";
  const profileUrl = profile.href;
  const readProfile = async (signal = AbortSignal.timeout(30000)) => {
    const result = await fetchRdf(profileUrl, {
      fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
      signal,
      maxBytes: 512 * 1024,
      maxQuads: 10000,
    });
    return { ...result, contentType: result.contentType ?? "text/turtle" };
  };
  const verify = async (url: string) => {
    const scoped = assertWithinPodScope(storage.root, url);
    if (!demo && !(await checkOwnerOnly({ storage, url: scoped, ownerWebId: owner })).private)
      throw new Error(
        "Your private Type Index must already be owner-only. Trips has not changed its access.",
      );
  };
  // pod-type-index currently scopes the WebID as though it were a storage document.
  // Supply just this exact identity read; do not broaden any data/write operation.
  const indexStorage: StorageClient = {
    ...storage,
    isWithinStorage: (url) => url === owner || url === profileUrl || storage.isWithinStorage(url),
    readRdf: (url, options) =>
      url === profileUrl ? readProfile(options?.signal) : storage.readRdf(url, options),
    writeRdf: async (url, dataset, options) => {
      await verify(url);
      return storage.writeRdf(url, dataset, options);
    },
    // Registration only edits an existing private index. Bootstrap belongs to the
    // account setup flow; this must never create shared settings or rewrite the profile.
    create: async () => {
      throw new Error("Set up a private Type Index before registering Trips");
    },
  };
  const index = createTypeIndex({
    storage: indexStorage,
    features: storage.features,
    profile: owner,
    fetch,
  });
  async function verifyPrivateIndex() {
    if (storage.protocol !== "solid") return;
    const profileData = await readProfile();
    const agent = new TermWrapper(owner, profileData.dataset, DataFactory);
    const indexes = new Set<string>();
    const direct = OptionalFrom.subjectPredicate(agent, PRIVATE, NamedNodeAs.string);
    if (direct) indexes.add(assertWithinPodScope(storage.root, direct));
    const prefs = OptionalFrom.subjectPredicate(agent, PREFS, NamedNodeAs.string);
    if (prefs) {
      const url = assertWithinPodScope(storage.root, prefs);
      await verify(url);
      const data = await storage.readRdf(url);
      const linked = OptionalFrom.subjectPredicate(
        new TermWrapper(owner, data.dataset, DataFactory),
        PRIVATE,
        NamedNodeAs.string,
      );
      if (linked) indexes.add(assertWithinPodScope(storage.root, linked));
    }
    if (!indexes.size) throw new Error("Set up a private Type Index before registering Trips");
    for (const url of indexes) await verify(url);
  }
  return { index, verifyPrivateIndex };
}
