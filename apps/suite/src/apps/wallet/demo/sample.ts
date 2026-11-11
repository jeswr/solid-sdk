// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  credentialToJsonLd,
  generateKeyPairForSuite,
  issue,
  publishVerificationMethod,
} from "@jeswr/solid-vc";
import type { WalletItemData, WalletRepository } from "@jeswr/solid-wallet";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import type { PodSession } from "@/lib/session/pod-session";
import { openWallet } from "../lib/data/client";

const seeds = new WeakMap<typeof fetch, Promise<void>>();
export function ensureWalletSample(session: PodSession, now = new Date()): Promise<void> {
  if (session.mode !== "demo") return Promise.resolve();
  const previous = seeds.get(session.fetch);
  if (previous) return previous;
  const task = seed(session, now).catch((error) => {
    seeds.delete(session.fetch);
    throw error;
  });
  seeds.set(session.fetch, task);
  return task;
}
async function seed(session: PodSession, now: Date) {
  const { storage, repository } = await openWallet(session);
  await repository.initialise();
  const marker = new URL("demo-seeded.txt", repository.credentials).href;
  const found = await session.fetch(marker, { method: "HEAD", redirect: "error" });
  if (found.ok) return;
  if (found.status !== 404) throw new Error("Couldn't check the Wallet sample data");
  const date = (days: number) => new Date(now.getTime() + days * 86_400_000);
  const common = {
    created: now,
    modified: now,
    holderName: "Rowan Meadow",
    notes: "Fictional sample document. Not valid for identification.",
    tags: ["sample"],
  };
  const credential = await sampleCredential(session, storage, repository, now, date);
  const samples = [
    {
      ...common,
      name: "Rowan's passport",
      kind: "passport" as const,
      identifier: "DEMO-P000042",
      issuerName: "Republic of Meadowland",
      validFrom: date(-730),
      expires: date(600),
      favourite: true,
    },
    {
      ...common,
      name: "Travel insurance",
      kind: "insurance" as const,
      identifier: "DEMO-INS-731",
      issuerName: "Fern & Finch Assurance",
      expires: date(18),
    },
    {
      ...common,
      name: "Willow gym membership",
      kind: "membership" as const,
      identifier: "DEMO-GYM-108",
      issuerName: "Willow Leisure Club",
    },
    {
      ...common,
      name: "Woodland first aid credential",
      kind: "verifiable-credential" as const,
      issuerName: "Demo Woodland Academy",
      credential,
      expires: date(365),
    },
  ];
  for (const data of samples) await seedRecord(storage, repository, `demo-${data.kind}.ttl`, data);
  await storage.create(repository.credentials, "seeded", {
    name: "demo-seeded.txt",
    contentType: "text/plain",
  });
}

const isCode = (error: unknown, code: string) =>
  error instanceof StorageError && error.code === code;

/** Reuse a stored sample credential: a retried seed must not leave orphan credential copies. */
async function sampleCredential(
  session: PodSession,
  storage: StorageClient,
  repository: WalletRepository,
  now: Date,
  date: (days: number) => Date,
): Promise<string> {
  const stored = new URL("demo-credential.json", repository.credentials).href;
  try {
    await storage.head(stored);
    return stored;
  } catch (error) {
    if (!isCode(error, "not-found")) throw error;
  }
  // Keep issuer and public key in the pod so demo verification also survives reloads. No
  // stored credential is signed by an earlier attempt's key, so that key may be replaced.
  const issuerDocument = new URL("demo-issuer.ttl", repository.credentials).href;
  try {
    await storage.create(repository.credentials, null, {
      name: "demo-issuer.ttl",
      contentType: "text/turtle",
    });
  } catch (error) {
    if (!isCode(error, "conflict")) throw error;
  }
  const issuer = `${issuerDocument}#issuer`;
  const key = await generateKeyPairForSuite(`${issuerDocument}#key`, "Ed25519");
  const published = await publishVerificationMethod({ controller: issuer, key });
  const current = await storage.head(issuerDocument, { revalidate: true });
  if (!current.etag) throw new Error("The sample issuer needs a version");
  await storage.write(issuerDocument, published.turtle, {
    contentType: "text/turtle",
    ifMatch: current.etag,
  });
  const signed = await issue({
    credential: {
      issuer,
      type: ["https://schema.org/EducationalOccupationalCredential"],
      validFrom: date(-7).toISOString(),
      validUntil: date(365).toISOString(),
      credentialSubject: {
        id: session.webId,
        "https://schema.org/name": "Rowan Meadow",
        "https://schema.org/description": "Completed the fictional Woodland First Aid course",
      },
    },
    key,
    options: { created: now },
  });
  const source = JSON.stringify({ ...credentialToJsonLd(signed), proof: signed.proof }, null, 2);
  try {
    return await repository.storeCredential(source, "demo-credential.json");
  } catch (error) {
    // Another seed stored it first; its issuer key was written before it.
    if (!isCode(error, "conflict")) throw error;
    return stored;
  }
}

/**
 * Create each sample once. An empty or invalid record left by an interrupted seed is
 * replaced only at the version observed before it was read, never a concurrent valid one.
 */
async function seedRecord(
  storage: StorageClient,
  repository: WalletRepository,
  name: string,
  data: WalletItemData,
) {
  const url = new URL(name, repository.base).href;
  for (let attempt = 0; attempt < 3; attempt++) {
    let etag: string | null = null;
    try {
      etag = (await storage.head(url, { revalidate: true })).etag;
      await repository.read(url);
      return;
    } catch (error) {
      if (isCode(error, "not-found")) {
        try {
          await repository.save(data, undefined, name);
          return;
        } catch (error) {
          // Another seed may have won the create-only deterministic name.
          if (!isCode(error, "conflict")) throw error;
          continue;
        }
      }
      if (!(error instanceof TypeError) && !isCode(error, "not-rdf")) throw error;
    }
    if (!etag) throw new Error("Couldn't repair the Wallet sample data");
    try {
      await repository.save(data, { ...data, url, etag });
      return;
    } catch (error) {
      if (!isCode(error, "precondition-failed")) throw error;
    }
  }
  throw new Error("Couldn't prepare the Wallet sample data");
}
