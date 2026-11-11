// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  type Identity as Claims,
  contextKey,
  type DPoPTokenCacheEntry,
  type RefreshSessionRecord,
  withLock,
} from "@jeswr/reactive-authentication";
import { protectStore, scopedStore } from "./kv.js";
import { secureUrl } from "./options.js";
import type {
  GrantOwner,
  GrantRetirementResult,
  KvStore,
  LoginHint,
  PodAuthOptions,
} from "./types.js";

/** Public metadata only. The engine key locates the credential; it contains no token or key material. */
interface Account {
  key: string;
  credential: string;
  webId: string;
  issuer: string;
  clientId: string;
  superseded?: true;
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

/** Scope grants by issuer/WebID/client and DPoP key; contexts alias only the same grant. */
export function sessionStorage(raw: KvStore, namespace: string, options: PodAuthOptions) {
  const store = protectStore(scopedStore(raw, namespace + ":sessions"));
  const transient = new Map<string, RefreshSessionRecord>();
  const cache = memoryStore<DPoPTokenCacheEntry>();
  const knownGrants = new Set<string>();
  const claimsGrants = new WeakMap<Claims, string>();
  const exclusive = <T>(work: () => Promise<T>) => withLock(namespace + ":mutation", work);
  const credentialOf = async (record: RefreshSessionRecord | DPoPTokenCacheEntry) => {
    const { x, y } = await crypto.subtle.exportKey("jwk", record.dpopKey.publicKey);
    return JSON.stringify([
      record.authorizationServer.issuer,
      record.identity?.webId ?? null,
      record.client.client_id,
      x,
      y,
    ]);
  };
  const grantOf = async (record: RefreshSessionRecord | DPoPTokenCacheEntry) =>
    await contextKey("pod-auth-grant", [await credentialOf(record), String(record.generation)]);
  const own = async (record: RefreshSessionRecord | DPoPTokenCacheEntry, grantId: string) => {
    await store.setItem("owner", {
      webId: record.identity?.webId ?? null,
      issuer: record.authorizationServer.issuer,
      grantId,
    });
  };
  const credentials: KvStore<DPoPTokenCacheEntry> = {
    ...cache,
    setItem: async (key, entry) => {
      const grantId = await grantOf(entry);
      // Access-only grants have no refresh record. Record their ownership at the fenced cache
      // commit too. Invalidation and refresh of an older grant must never reclaim the namespace.
      if (!knownGrants.has(grantId)) await own(entry, grantId);
      knownGrants.add(grantId);
      if (entry.identity !== undefined) claimsGrants.set(entry.identity, grantId);
      await cache.setItem(key, entry);
    },
  };
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
  const valid = async (
    record: RefreshSessionRecord,
    account: Pick<Account, "webId" | "issuer" | "clientId">,
  ) => {
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
      knownGrants.add(await grantOf(record));
      return record;
    },
    setItem: async (key, record) =>
      await withLock(namespace + ":catalog", async () => {
        const webId = record.identity?.webId;
        // Issuer-only identities cannot supply the WebID-scoped restore guarantee.
        if (webId === undefined) {
          const grantId = await grantOf(record);
          if (!knownGrants.has(grantId)) await own(record, grantId);
          knownGrants.add(grantId);
          transient.set(key, record);
          return;
        }
        const issuer = record.authorizationServer.issuer;
        secureUrl(webId, options.allowInsecureLoopback === true, "WebID");
        secureUrl(issuer, options.allowInsecureLoopback === true, "issuer");
        const clientId = record.client.client_id;
        const account = { key, webId, issuer, clientId };
        if (!(await valid(record, account)))
          throw new Error("Invalid persisted session credential");
        // Authorization creates a fresh DPoP key; rotation retains it. Never replace another
        // outstanding grant for the same account, including one issued in another context.
        const credential = await credentialOf(record);
        const grantId = await grantOf(record);
        const accounts = new Map((await catalog()).map((a) => [a.key, a]));
        if (
          ![...accounts.values()].some((a) => a.credential === credential) ||
          (await store.getItem("owner")) === null
        )
          await own(record, grantId);
        const previous = accounts.get(key);
        if (previous !== undefined && previous.credential !== credential) {
          // Engine keys use oidc:<hash>; keep a separate alias solely for logout cleanup.
          const cleanupKey = "superseded:" + previous.credential;
          accounts.set(cleanupKey, { ...previous, key: cleanupKey, superseded: true });
        }
        accounts.delete("superseded:" + credential);
        accounts.set(key, { ...account, credential });
        // Catalog first: a failed credential write is discoverable for later cleanup, never usable.
        await store.setItem("accounts", [...accounts.values()]);
        await store.setItem(credential, record);
        knownGrants.add(grantId);
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
    credentials,
    grantFor: (claims: Claims) => claimsGrants.get(claims),
    exclusive,
    retirement: async (expected: GrantOwner): Promise<GrantRetirementResult> => {
      if (typeof expected.grantId !== "string" || expected.grantId.length === 0)
        return { retired: false, reason: "missing-grant" };
      const owner = (await store.getItem("owner")) as GrantOwner | null;
      if (owner === null || typeof owner.grantId !== "string" || owner.grantId.length === 0)
        return { retired: false, reason: "no-grant" };
      if (owner.webId !== expected.webId || owner.issuer !== expected.issuer)
        return { retired: false, reason: "owner-changed" };
      if (owner.grantId !== expected.grantId) return { retired: false, reason: "grant-changed" };
      return { retired: true };
    },
    lock: async (key: string) =>
      namespace + ":session:" + ((await catalog()).find((a) => a.key === key)?.credential ?? key),
    active,
    present: async (account: ActiveAccount) => {
      for (const entry of await catalog()) {
        if (
          entry.superseded !== true &&
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
      await store.removeItem("owner");
    },
  };
}
