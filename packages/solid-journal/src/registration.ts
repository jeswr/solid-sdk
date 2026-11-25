// AUTHORED-BY Codex GPT-6
import { checkOwnerOnly, createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { DataFactory } from "n3";
import { JournalPrivacyError } from "./privacy.js";

const PRIVATE_POINTERS = [
  "http://www.w3.org/ns/pim/space#preferencesFile",
  "http://www.w3.org/ns/solid/terms#privateTypeIndex",
];

export function privateJournalIndex(storage: StorageClient, owner: string): StorageClient {
  const settings = new URL("settings/", storage.root).href;
  let profileIsPrivateDestination = false;
  const profileDocument = () => {
    const url = new URL(owner);
    url.hash = "";
    return url.href;
  };
  const refusal = (cause?: unknown) =>
    new JournalPrivacyError(
      "Journal registration needs owner-only access to the Type Index and preferences. Review their permissions in Drive.",
      { cause },
    );

  async function verify(url: string, signal?: AbortSignal, preflight = false) {
    const options = signal ? { signal } : {};
    const checking: StorageClient = {
      ...storage,
      head: (target, init) => storage.head(target, { ...init, ...options }),
      read: (target, init) => storage.read(target, { ...init, ...options }),
      // Provisioning is the Type Index SDK's responsibility. Verification never creates folders.
      create: () => Promise.reject(refusal()),
    };
    try {
      if (preflight && new URL(".", url).href === settings) {
        try {
          await checking.head(settings, { revalidate: true });
        } catch (error) {
          if (!(error instanceof StorageError) || error.status !== 404) throw error;
          // The SDK can bootstrap this one folder. Its initial policy comes from the root.
          if (
            !(await checkOwnerOnly({ storage: checking, url: storage.root, ownerWebId: owner }))
              .private
          )
            throw refusal();
          return;
        }
      }
      const verifyDestination = createOwnerOnlyDestinationVerifier({
        podRoot: storage.root,
        ownerWebId: owner,
        openStorage: () => checking,
        ...options,
      });
      if (!(await verifyDestination(url))) throw refusal();
    } catch (error) {
      if (error instanceof JournalPrivacyError) throw error;
      throw refusal(error);
    }
  }

  return {
    ...storage,
    async readRdf(url, options) {
      const profile = profileDocument();
      // The SDK reads both private destinations before its first write. Check them
      // here as well as at write time so an unsafe preferences file blocks registration.
      if (url !== profile) await verify(url, options?.signal, true);
      const read = await storage.readRdf(url, options);
      // A normal public profile may receive the preferences link. If a private pointer
      // aliases that profile, however, it has to pass the same check as any private file.
      for (const predicate of PRIVATE_POINTERS) {
        for (const { object } of read.dataset.match(
          DataFactory.namedNode(new URL(owner).href),
          DataFactory.namedNode(predicate),
          null,
          DataFactory.defaultGraph(),
        )) {
          if (object.termType !== "NamedNode") continue;
          const target = URL.parse(object.value);
          if (!target) continue;
          target.hash = "";
          if (target.href === profile) {
            profileIsPrivateDestination = true;
            await verify(profile, options?.signal);
          }
        }
      }
      return read;
    },
    async writeRdf(url, dataset, options) {
      if (url !== profileDocument() || profileIsPrivateDestination)
        await verify(url, options.signal);
      return storage.writeRdf(url, dataset, options);
    },
    async create(parent, body, options) {
      if (options?.kind === "container") {
        // The SDK only bootstraps settings/ and supplies no private payload.
        if (parent !== storage.root || options.name !== "settings" || body !== null)
          throw refusal();
        return storage.create(parent, body, options);
      }
      if (!options?.name) throw refusal();
      const exactUrl = new URL(encodeURIComponent(options.name), parent).href;
      await verify(exactUrl, options.signal);
      const { name: _name, ...rest } = options;
      return storage.create(parent, body, { ...rest, exactUrl });
    },
  };
}
