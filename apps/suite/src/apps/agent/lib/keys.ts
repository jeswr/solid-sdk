// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { createWebIdKeyResolver, type KeyPair, publishVerificationMethod } from "@jeswr/solid-vc";
import { Store } from "n3";
import type { PodSession } from "../../../lib/session/pod-session";

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
  async get(owner: string): Promise<KeyPair | undefined> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction("keys").objectStore("keys").get(owner);
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
        tx.objectStore("keys").put(key, owner);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    return key;
  }
}

export async function publishApprovalKey(
  session: Pick<PodSession, "fetch" | "webId">,
  key: KeyPair,
) {
  const profile = new URL(session.webId);
  profile.hash = "";
  const publication = await publishVerificationMethod({
    controller: session.webId,
    verificationMethod: key.verificationMethod,
    key: key.publicKey,
  });
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
    store.addQuads([...publication.quads]);
    const put = await session.fetch(profile.href, {
      method: "PUT",
      redirect: "error",
      headers: { "content-type": "text/turtle", "if-match": etag },
      body: await serialize([...store]),
    });
    if (put.status === 412) continue;
    if (!put.ok) throw new Error("Couldn't update your account profile. Try again.");
    // A fresh resolver re-reads and confirms assertionMethod AND the key's controller binding.
    const resolver = createWebIdKeyResolver({ fetch: session.fetch });
    if (!(await resolver.isControlledBy(key.verificationMethod, session.webId)))
      throw new Error("Your account profile hasn't confirmed this key. Try again.");
    return;
  }
  throw new Error("Your account profile kept changing. Try again.");
}

export async function approvalKeyStatus(
  session: Pick<PodSession, "fetch" | "webId">,
  store = new ApprovalKeyStore(),
): Promise<KeyStatus> {
  const id = localStorage.getItem(PREFERENCE);
  if (!id) return "none";
  const key = await store.get(session.webId);
  if (!key || key.verificationMethod !== id) return "unavailable";
  const resolver = createWebIdKeyResolver({ fetch: session.fetch });
  return (await resolver.isControlledBy(id, session.webId)) ? "ready" : "unavailable";
}
export async function setupApprovalKey(
  session: Pick<PodSession, "fetch" | "webId">,
  store = new ApprovalKeyStore(),
) {
  const key = await store.generate(session.webId);
  await publishApprovalKey(session, key);
  localStorage.setItem(PREFERENCE, key.verificationMethod);
}
/** Signing always rechecks device storage and the current profile, including after a restore. */
export async function withApprovalKey<T>(
  session: Pick<PodSession, "fetch" | "webId">,
  sign: (key: KeyPair) => Promise<T>,
): Promise<T> {
  const store = new ApprovalKeyStore();
  if ((await approvalKeyStatus(session, store)) !== "ready")
    throw new Error("Set up this device before approving.");
  const key = await store.get(session.webId);
  if (!key) throw new Error("This device cannot approve.");
  return sign(key);
}
