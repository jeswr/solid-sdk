// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { createWebIdKeyResolver, type KeyPair, publishVerificationMethod } from "@jeswr/solid-vc";
import { DataFactory, Store } from "n3";
import { type ProfileSession, profileReader } from "./profile";

const PREFERENCE = "agent.approvalKey";
export type KeyStatus = "none" | "ready" | "unavailable";

/** CryptoKeys are structured-cloned directly into IndexedDB. Only the public key is exported. */
export class ApprovalKeyStore {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("solid-suite-agent-keys", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async get(id: string): Promise<KeyPair | undefined> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("keys").objectStore("keys").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }
  async generate(owner: string, now = new Date()): Promise<KeyPair> {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    const doc = new URL(owner);
    doc.hash = "";
    const date = now.toISOString().slice(0, 10).replaceAll("-", "");
    const key: KeyPair = {
      ...pair,
      verificationMethod: `${doc.href}#agent-approval-${date}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
    };
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("keys", "readwrite");
        tx.objectStore("keys").add(key, key.verificationMethod);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    return key;
  }
  async delete(id: string): Promise<void> {
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("keys", "readwrite");
        tx.objectStore("keys").delete(id);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
}

async function activeKey(owner: string, store: ApprovalKeyStore): Promise<KeyPair | undefined> {
  const id = localStorage.getItem(PREFERENCE);
  if (!id) return undefined;
  // Keep pre-rotation owner-keyed records usable without overwriting or removing them.
  const key = (await store.get(id)) ?? (await store.get(owner));
  return key?.verificationMethod === id ? key : undefined;
}

/** Conditionally rewrite the owner's profile, retrying conflicts on the winner's graph. */
async function editProfile(session: ProfileSession, edit: (store: Store) => void) {
  const profile = new URL(session.webId);
  profile.hash = "";
  // Initial attempt plus three conflict retries; each retry preserves the winner's graph.
  for (let attempt = 0; attempt <= 3; attempt++) {
    const response = await session.fetch(profile.href, {
      redirect: "error",
      headers: { accept: "text/turtle" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Couldn't read your account profile. Try again.");
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("Your account profile doesn't support safe updates.");
    const store = new Store([
      ...(await parseRdf(await response.text(), response.headers.get("content-type"), {
        baseIRI: profile.href,
      })),
    ]);
    edit(store);
    const put = await session.fetch(profile.href, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "text/turtle", "if-match": etag },
      body: await serialize([...store]),
    });
    if (put.status === 412) continue;
    if (!put.ok) throw new Error("Couldn't update your account profile. Try again.");
    return;
  }
  throw new Error("Your account profile kept changing. Try again.");
}

export async function publishApprovalKey(session: ProfileSession, key: KeyPair) {
  const publication = await publishVerificationMethod({
    controller: session.webId,
    verificationMethod: key.verificationMethod,
    key: key.publicKey,
  });
  await editProfile(session, (store) => store.addQuads([...publication.quads]));
  // A fresh resolver re-reads and confirms assertionMethod AND the key's controller binding.
  const resolver = createWebIdKeyResolver({ fetch: profileReader(session) });
  if (!(await resolver.isControlledBy(key.verificationMethod, session.webId)))
    throw new Error("Your account profile hasn't confirmed this key. Try again.");
}

/** Remove one key from the profile: its owner links and its own description. */
export async function removeApprovalKey(session: ProfileSession, id: string) {
  await editProfile(session, (store) => {
    const key = DataFactory.namedNode(id);
    store.removeQuads([
      ...store.match(DataFactory.namedNode(session.webId), null, key),
      ...store.match(key, null, null),
    ]);
  });
  const resolver = createWebIdKeyResolver({ fetch: profileReader(session) });
  if (await resolver.isControlledBy(id, session.webId))
    throw new Error("Your account profile still lists this key. Try again.");
}

/** This device's selected approval key id, if any. */
export const deviceKeyId = () => localStorage.getItem(PREFERENCE) ?? undefined;

export async function approvalKeyStatus(
  session: ProfileSession,
  store = new ApprovalKeyStore(),
): Promise<KeyStatus> {
  const id = localStorage.getItem(PREFERENCE);
  if (!id) return "none";
  const key = await activeKey(session.webId, store);
  if (!key) return "unavailable";
  const resolver = createWebIdKeyResolver({ fetch: profileReader(session) });
  return (await resolver.isControlledBy(id, session.webId)) ? "ready" : "unavailable";
}
export async function setupApprovalKey(session: ProfileSession, store = new ApprovalKeyStore()) {
  // Publishing writes the profile, which needs a credential the storage grant doesn't cover.
  if (profileReader(session) !== session.fetch)
    throw new Error(
      "Your profile is outside the storage you shared, so this device can't add its approval key there.",
    );
  const key = await store.generate(session.webId);
  try {
    await publishApprovalKey(session, key);
    // Publication and readback must finish before this device can select the new key.
    localStorage.setItem(PREFERENCE, key.verificationMethod);
  } catch (error) {
    await store.delete(key.verificationMethod);
    throw error;
  }
}
/** Signing always rechecks device storage and the current profile, including after a restore. */
export async function withApprovalKey<T>(
  session: ProfileSession,
  sign: (key: KeyPair) => Promise<T>,
): Promise<T> {
  const store = new ApprovalKeyStore();
  const key = await activeKey(session.webId, store);
  if (
    !key ||
    !(await createWebIdKeyResolver({ fetch: profileReader(session) }).isControlledBy(
      key.verificationMethod,
      session.webId,
    ))
  )
    throw new Error("Set up this device before approving.");
  return sign(key);
}
