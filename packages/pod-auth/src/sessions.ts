// AUTHORED-BY Codex GPT-6.1-Sol
import { type RefreshSessionRecord, withLock } from "@jeswr/reactive-authentication";
import { protectStore, scopedStore } from "./kv.js";
import { secureUrl } from "./options.js";
import type { KvStore, LoginHint, PodAuthOptions } from "./types.js";

/** Public metadata only. The engine key locates the credential; it contains no token or key material. */
interface Account {
  key: string;
  credential: string;
  webId: string;
  issuer: string;
  clientId: string;
}
export interface ActiveAccount {
  webId: string;
  issuer: string;
  selected: LoginHint;
  requestUrl: string;
  context: string;
}

export function memoryStore<T extends {} = {}>(): KvStore<T> {
  const values = new Map<string, T>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

/** Translate engine context keys to the canonical (issuer, WebID, actual client_id) credential key. */
export function sessionStorage(raw: KvStore, namespace: string, options: PodAuthOptions) {
  const store = protectStore(scopedStore(raw, namespace + ":sessions"));
  const transient = new Map<string, RefreshSessionRecord>();
  const catalog = async () => ((await store.getItem("accounts")) ?? []) as Account[];
  const active = async (): Promise<ActiveAccount | null> => {
    const value = (await store.getItem("active")) as ActiveAccount | null;
    if (value === null) return null;
    try {
      if (
        typeof value.webId !== "string" ||
        typeof value.issuer !== "string" ||
        typeof value.requestUrl !== "string" ||
        typeof value.context !== "string"
      )
        return null;
      secureUrl(value.webId, options.allowInsecureLoopback === true, "WebID");
      secureUrl(value.issuer, options.allowInsecureLoopback === true, "issuer");
      secureUrl(value.requestUrl, options.allowInsecureLoopback === true, "session context");
      if (typeof value.selected !== "object" || value.selected === null) return null;
      return value;
    } catch {
      return null;
    }
  };
  const valid = async (record: RefreshSessionRecord, account: Account) => {
    try {
      const { privateKey, publicKey } = record.dpopKey ?? {};
      const es256 = (key: CryptoKey | undefined, type: KeyType, usage: KeyUsage) =>
        key instanceof CryptoKey &&
        key.type === type &&
        key.algorithm.name === "ECDSA" &&
        (key.algorithm as EcKeyAlgorithm).namedCurve === "P-256" &&
        key.usages.includes(usage);
      if (
        !es256(privateKey, "private", "sign") ||
        privateKey.extractable ||
        !es256(publicKey, "public", "verify") ||
        !publicKey.extractable ||
        typeof record.refreshToken !== "string" ||
        record.refreshToken.length === 0 ||
        record.identity?.webId !== account.webId ||
        record.identity.issuer !== account.issuer ||
        record.authorizationServer.issuer !== account.issuer ||
        record.client.client_id !== account.clientId ||
        (typeof options.clientId === "string" &&
          account.clientId !== new URL(options.clientId).href)
      )
        return false;
      // Ensure the loaded pair matches before any credential is sent to the token endpoint.
      const data = new TextEncoder().encode("pod-auth DPoP key validation");
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        data,
      );
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signature,
        data,
      );
    } catch {
      return false;
    }
  };
  const sessions: KvStore<RefreshSessionRecord> = {
    getItem: async (key) => {
      const memory = transient.get(key);
      if (memory !== undefined) return memory;
      const account = (await catalog()).find((a) => a.key === key);
      if (account === undefined) return null;
      const record = (await store.getItem(account.credential)) as RefreshSessionRecord | null;
      if (record === null) return null;
      if (!(await valid(record, account))) {
        await store.removeItem(account.credential);
        return null;
      }
      return record;
    },
    setItem: async (key, record) =>
      await withLock(namespace + ":catalog", async () => {
        const webId = record.identity?.webId;
        // Issuer-only identities cannot supply the WebID-scoped restore guarantee.
        if (webId === undefined) {
          transient.set(key, record);
          return;
        }
        const issuer = record.authorizationServer.issuer;
        secureUrl(webId, options.allowInsecureLoopback === true, "WebID");
        secureUrl(issuer, options.allowInsecureLoopback === true, "issuer");
        const clientId = record.client.client_id;
        const credential = JSON.stringify([issuer, webId, clientId]);
        const account = { key, credential, webId, issuer, clientId };
        if (!(await valid(record, account)))
          throw new Error("Invalid persisted session credential");
        const accounts = (await catalog()).filter((a) => a.key !== key);
        accounts.push(account);
        // Catalog first: a failed credential write is discoverable for later cleanup, never usable.
        await store.setItem("accounts", accounts);
        await store.setItem(credential, record);
        transient.delete(key);
      }),
    removeItem: async (key) => {
      transient.delete(key);
      const account = (await catalog()).find((a) => a.key === key);
      if (account !== undefined) await store.removeItem(account.credential);
    },
  };
  return {
    sessions,
    lock: async (key: string) =>
      namespace + ":session:" + ((await catalog()).find((a) => a.key === key)?.credential ?? key),
    active,
    present: async (account: ActiveAccount) => {
      for (const entry of await catalog()) {
        if (
          entry.webId === account.webId &&
          entry.issuer === account.issuer &&
          (await sessions.getItem(entry.key)) !== null
        )
          return true;
      }
      return false;
    },
    remember: async (value: ActiveAccount) => {
      await store.setItem("active", value);
    },
    forgetPointer: async () => await store.removeItem("active"),
    keys: async () => (await catalog()).map((a) => a.key),
    clear: async () => {
      transient.clear();
      for (const account of await catalog()) await store.removeItem(account.credential);
      await store.removeItem("accounts");
      await store.removeItem("active");
    },
  };
}
