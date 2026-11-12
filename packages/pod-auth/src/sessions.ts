// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
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
/**
 * A login's observed ownership no longer holds: another sign-in changed the remembered account or the
 * stored grant owner. Nothing from the rejected attempt remains stored.
 */
export class OwnershipChangedError extends Error {
  constructor() {
    super("Another sign-in changed the remembered account");
    this.name = "OwnershipChangedError";
  }
}

/** Ownership a login observed; the pointer as `remembered()` reports it. */
export interface LoginOwnership {
  expectRemembered?: readonly { webId: string; issuer: string }[];
  /** Replace, rather than renew, the stored grant of this WebID. */
  reauthorize?: string;
}

/**
 * A grant this attempt installed, or a stored grant its reauthorization displaced without a
 * replacement record, with what it displaced, so a rejection can restore exactly that.
 */
interface Install {
  key: string;
  grantId?: string;
  credential?: string;
  previous?: Account;
  alias?: string;
}
interface Attempt {
  /** Whether publications are checked against the observed pointer and owner. */
  guarded: boolean;
  /** Serialized pointer and owner the attempt may still commit over. */
  expected: { pointer: string; owner: string };
  /** The engine key whose stored credential a reauthorization authorizes instead of redeeming. */
  bypass?: string;
  installs: Install[];
  /** The owner each grant this attempt owned replaced, captured immediately before its write. */
  owners: Map<string, unknown>;
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
  let attempt: Attempt | undefined;
  /** Logout and retirement read every stored credential, including one a reauthorization bypasses. */
  let rawReads = 0;
  const pointerKey = (value: { webId: string; issuer: string } | null | undefined) =>
    JSON.stringify(value ? [value.webId, value.issuer] : null);
  /** Records a grant this attempt installed; a reauthorization's bypass ends with its new grant. */
  const installed = (install: Install) => {
    if (attempt === undefined) return;
    attempt.installs.push(install);
    delete attempt.bypass;
  };
  const ownerKey = async () => JSON.stringify((await store.getItem("owner")) ?? null);
  /**
   * Runs under the namespace mutation lock, immediately before this attempt publishes a grant owner or
   * the pointer. On a mismatch, it discards only what this attempt installed.
   */
  const check = async (writing?: ActiveAccount) => {
    if (!attempt?.guarded) return;
    const expected = attempt.expected;
    const pointer = await active();
    // Another tab renewing this attempt's own grant may already have written the identical pointer.
    const written =
      writing !== undefined &&
      pointer?.webId === writing.webId &&
      pointer.issuer === writing.issuer &&
      pointer.context === writing.context;
    if (
      (pointerKey(pointer) !== expected.pointer && !written) ||
      (await ownerKey()) !== expected.owner
    ) {
      await discardLocked();
      throw new OwnershipChangedError();
    }
  };
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
    await check();
    const owner = {
      webId: record.identity?.webId ?? null,
      issuer: record.authorizationServer.issuer,
      grantId,
    };
    // A rejection restores exactly this value, never one observed when the attempt began.
    const replaced = (await store.getItem("owner")) ?? null;
    await store.setItem("owner", owner);
    if (attempt !== undefined) {
      // knownGrants makes each grant's ownership write happen at most once per instance, so the
      // replaced value never names this grant and the rejection walk below cannot cycle.
      attempt.owners.set(grantId, replaced);
      attempt.expected.owner = JSON.stringify(owner);
    }
  };
  const credentials: KvStore<DPoPTokenCacheEntry> = {
    ...cache,
    setItem: async (key, entry) => {
      const grantId = await grantOf(entry);
      // Access-only grants have no refresh record. Record their ownership at the fenced cache
      // commit too. Invalidation and refresh of an older grant must never reclaim the namespace.
      if (!knownGrants.has(grantId)) {
        await own(entry, grantId);
        installed({ key, grantId });
      }
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
      // Reauthorization authorizes instead of redeeming the one stored credential it replaces.
      if (rawReads === 0 && attempt?.bypass === key) return null;
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
          if (!knownGrants.has(grantId)) {
            await own(record, grantId);
            installed({ key, grantId });
          }
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
        const installing = ![...accounts.values()].some((a) => a.credential === credential);
        if (installing || (await store.getItem("owner")) === null) await own(record, grantId);
        const previous = accounts.get(key);
        let alias: string | undefined;
        if (previous !== undefined && previous.credential !== credential) {
          // Engine keys use oidc:<hash>; keep a separate alias solely for logout cleanup.
          const cleanupKey = "superseded:" + previous.credential;
          alias = cleanupKey;
          accounts.set(cleanupKey, { ...previous, key: cleanupKey, superseded: true });
        }
        if (installing)
          installed({
            key,
            grantId,
            credential,
            ...(previous === undefined ? {} : { previous }),
            ...(alias === undefined ? {} : { alias }),
          });
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
      const accounts = await catalog();
      const account = accounts.find((a) => a.key === key);
      if (account === undefined) return;
      if (attempt?.bypass === key) {
        // A reauthorization without a refresh token replaces this grant: keep it catalogued under a
        // cleanup alias so logout still revokes it, instead of deleting its record unrevoked.
        const alias = "superseded:" + account.credential;
        const next = new Map(accounts.map((a) => [a.key, a]));
        next.delete(key);
        next.set(alias, { ...account, key: alias, superseded: true });
        await store.setItem("accounts", [...next.values()]);
        attempt.installs.push({ key, previous: account, alias });
        return;
      }
      await store.removeItem(account.credential);
    },
  };
  /** Removes only this attempt's grants and restores what they displaced. Caller holds the lock. */
  async function discardLocked() {
    const current = attempt!;
    if (current.installs.length === 0) return;
    const accounts = new Map((await catalog()).map((a) => [a.key, a]));
    for (const install of [...current.installs].reverse()) {
      // Memory copies only; a durable record the attempt displaced is restored below.
      transient.delete(install.key);
      await cache.removeItem(install.key);
      if (install.credential !== undefined) await store.removeItem(install.credential);
      if (install.credential !== undefined || install.previous !== undefined) {
        // Another context may have replaced this key since; never restore over its newer grant.
        // The displaced grant's cleanup alias goes only once the grant is reachable by its key again.
        if (accounts.get(install.key)?.credential === install.credential) {
          if (install.previous === undefined) accounts.delete(install.key);
          else accounts.set(install.key, install.previous);
          if (install.alias !== undefined) accounts.delete(install.alias);
        }
        accounts.delete("superseded:" + install.credential);
      }
      if (install.grantId !== undefined) knownGrants.delete(install.grantId);
    }
    if (accounts.size === 0) await store.removeItem("accounts");
    else await store.setItem("accounts", [...accounts.values()]);
    // Walk back through owners this attempt wrote, only while the stored owner is still one of them;
    // another tab's later owner stays. Each value predates the write that replaced it, so this ends.
    let owner = (await store.getItem("owner")) as { grantId?: unknown } | null;
    let restored = false;
    while (typeof owner?.grantId === "string" && current.owners.has(owner.grantId)) {
      owner = current.owners.get(owner.grantId) as { grantId?: unknown } | null;
      restored = true;
    }
    if (restored) {
      if (owner === null) await store.removeItem("owner");
      else await store.setItem("owner", owner);
    }
    current.installs = [];
    current.owners.clear();
  }

  return {
    sessions,
    credentials,
    /**
     * Starts one login attempt under the mutation lock. `expectRemembered` must still match the pointer;
     * `reauthorize` may only replace a grant of that WebID. Both guard every later publication.
     */
    begin: async (ownership: LoginOwnership) => {
      const pointer = await active();
      const owner = (await store.getItem("owner")) as { webId?: unknown } | null;
      const expected = ownership.expectRemembered;
      if (expected !== undefined && pointerKey(pointer) !== pointerKey(expected[0])) {
        throw new OwnershipChangedError();
      }
      const replacing = ownership.reauthorize;
      if (
        replacing !== undefined &&
        ((pointer !== null && pointer.webId !== replacing) ||
          (owner !== null && owner.webId !== replacing))
      )
        throw new OwnershipChangedError();
      attempt = {
        guarded: expected !== undefined || replacing !== undefined,
        expected: { pointer: pointerKey(pointer), owner: JSON.stringify(owner) },
        installs: [],
        owners: new Map(),
      };
    },
    /** Scopes a reauthorization's bypass to the engine key of its own login context. */
    bypass: (key: string) => {
      attempt!.bypass = key;
    },
    raw: async <T>(work: () => Promise<T>) => {
      ++rawReads;
      try {
        return await work();
      } finally {
        --rawReads;
      }
    },
    end: () => {
      attempt = undefined;
    },
    attempting: () => attempt !== undefined,
    discard: async () => await exclusive(discardLocked),
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
    /**
     * `publishing` is false for another upgrade in this instance during a login attempt (same
     * account): it is not checked, and it moves the pointer the attempt may commit over.
     */
    remember: async (value: ActiveAccount, publishing = true) => {
      if (publishing) await check(value);
      await store.setItem("active", value);
      if (!publishing) attempt!.expected.pointer = pointerKey(value);
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
