// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  credentialToJsonLd,
  generateKeyPairForSuite,
  issue,
  publishVerificationMethod,
} from "@jeswr/solid-vc";
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
  // Keep issuer and public key in the pod so demo verification also survives reloads.
  const issuerDocument = (
    await storage.create(repository.credentials, null, { contentType: "text/turtle" })
  ).url;
  const issuer = `${issuerDocument}#issuer`;
  const key = await generateKeyPairForSuite(`${issuerDocument}#key`, "Ed25519");
  const published = await publishVerificationMethod({ controller: issuer, key });
  const empty = await storage.read(issuerDocument);
  if (!empty.etag) throw new Error("The sample issuer needs a version");
  await storage.write(issuerDocument, published.turtle, {
    contentType: "text/turtle",
    ifMatch: empty.etag,
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
  const credential = await repository.storeCredential(source);
  for (const data of [
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
  ])
    await repository.save(data);
  await storage.create(repository.credentials, "seeded", {
    name: "demo-seeded.txt",
    contentType: "text/plain",
  });
}
