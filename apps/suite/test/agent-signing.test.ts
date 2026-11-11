// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { issueApproval, verifyApproval } from "@jeswr/agent-mandate/approval";
import { issueControlStatement } from "@jeswr/agent-mandate/control";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { createWebIdKeyResolver } from "@jeswr/solid-vc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentClient, isLoaded } from "../src/apps/agent/lib/client";
import { archivedMessages } from "../src/apps/agent/lib/inbox";
import {
  ApprovalKeyStore,
  approvalKeyStatus,
  publishApprovalKey,
  setupApprovalKey,
  withApprovalKey,
} from "../src/apps/agent/lib/keys";
import { metadataNode } from "../src/apps/agent/lib/paths";
import { loadedRecords, readApprovals, readControl } from "../src/apps/agent/lib/readers";
import { createAgentSigner } from "../src/apps/agent/lib/sign";
import { agentStatus } from "../src/apps/agent/lib/status";
import { createAgentVerifier } from "../src/apps/agent/lib/verify";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";

const { IDBFactory, IDBObjectStore } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as {
  IDBFactory: new () => IDBFactory;
  IDBObjectStore: { prototype: IDBObjectStore };
};
const now = new Date("2026-11-01T12:00:00Z");
const PREF = "agent.approvalKey";
const profile = DEMO_WEBID.split("#")[0] as string;
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(now.getTime()) });
  const session = { fetch: pod.fetch, webId: DEMO_WEBID };
  const client = createAgentClient({
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    workspace: `${DEMO_ROOT}agent/`,
  });
  return { pod, session, client };
}
const proposal = {
  ...exampleRecords["action-proposal"],
  id: `${DEMO_ROOT}agent/proposals/test.ttl`,
  validUntil: new Date(now.getTime() + 86400000).toISOString(),
};

describe("device approval keys", () => {
  it("persists non-extractable private keys only in IndexedDB, publishes assertionMethod and resolves P-256", async () => {
    const { session } = await fixture();
    const store = new ApprovalKeyStore();
    expect(await store.get(DEMO_WEBID)).toBeUndefined();
    expect(await approvalKeyStatus(session)).toBe("none");
    const key = await store.generate(DEMO_WEBID, now);
    expect(key.verificationMethod).toMatch(/#agent-approval-20261101-[a-f0-9]{8}$/);
    expect(key.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("jwk", key.privateKey)).rejects.toThrow();
    expect(await crypto.subtle.exportKey("jwk", key.publicKey)).toMatchObject({
      kty: "EC",
      crv: "P-256",
    });
    const restored = await store.get(key.verificationMethod);
    expect(restored?.privateKey.extractable).toBe(false);
    await publishApprovalKey(session, key);
    const response = await session.fetch(profile);
    const graph = await parseRdf(await response.text(), "text/turtle");
    expect(
      metadataNode(graph, DEMO_WEBID).iris("https://w3id.org/security#assertionMethod"),
    ).toContain(key.verificationMethod);
    const resolver = createWebIdKeyResolver({ fetch: session.fetch });
    expect(await resolver.resolveKey(key.verificationMethod)).toMatchObject({
      algorithm: { name: "ECDSA", namedCurve: "P-256" },
    });
    localStorage.setItem(PREF, key.verificationMethod);
    expect(await approvalKeyStatus(session)).toBe("ready");
    expect(await withApprovalKey(session, async (saved) => saved.verificationMethod)).toBe(
      key.verificationMethod,
    );
    localStorage.setItem(PREF, "missing");
    expect(await approvalKeyStatus(session)).toBe("unavailable");
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await approvalKeyStatus(session)).toBe("unavailable");
    await expect(withApprovalKey(session, async () => true)).rejects.toThrow("Set up");
  });
  it("appends new keys without removing old audit keys; both approvals still verify", async () => {
    const { session, client } = await fixture();
    await setupApprovalKey(session);
    const firstKey = localStorage.getItem(PREF) as string;
    const first = await createAgentSigner(session, client, () => now).signApproval(
      proposal,
      "approve",
    );
    await setupApprovalKey(session);
    const secondKey = localStorage.getItem(PREF) as string;
    expect(secondKey).not.toBe(firstKey);
    const store = new ApprovalKeyStore();
    expect((await store.get(firstKey))?.verificationMethod).toBe(firstKey);
    expect((await store.get(secondKey))?.verificationMethod).toBe(secondKey);
    expect(await withApprovalKey(session, async (key) => key.verificationMethod)).toBe(secondKey);
    const second = await createAgentSigner(session, client, () => now).signApproval(
      proposal,
      "deny",
    );
    const approvals = loadedRecords(
      await readApprovals(
        client,
        createAgentVerifier(session, () => now),
      ),
    );
    expect(approvals.filter((a) => a.verification === "verified").map((a) => a.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    for (const approval of [first, second]) {
      const doc = await client.graph(approval.id);
      expect(
        await verifyApproval(doc.text, {
          id: approval.id,
          ownerWebId: DEMO_WEBID,
          proposal: proposal.id,
          termsDigest: proposal.intent.termsDigest,
          now: () => now,
          webIdKeyResolver: createWebIdKeyResolver({ fetch: session.fetch }),
        }),
      ).toMatchObject({ valid: true });
      expect(approvals.find((a) => a.id === approval.id)?.createdAt).toBe(now.toISOString());
    }
  });
  it("reads an off-storage profile only through the public fetch for keys and verification", async () => {
    const { session, client } = await fixture();
    await setupApprovalKey(session);
    const approval = await createAgentSigner(session, client, () => now).signApproval(
      proposal,
      "approve",
    );
    // The extension grants credentials only for the chosen storage, which here excludes the profile.
    const credentialed = vi.fn(async (input: RequestInfo | URL) => {
      throw new Error(`credentialed read of ${String(input)}`);
    });
    const external = {
      webId: DEMO_WEBID,
      storageUrl: "https://storage.example/",
      fetch: credentialed as unknown as typeof session.fetch,
      publicFetch: vi.fn(session.fetch),
    };
    expect(await approvalKeyStatus(external)).toBe("ready");
    expect(await withApprovalKey(external, async (key) => key.verificationMethod)).toBe(
      localStorage.getItem(PREF),
    );
    const doc = await client.graph(approval.id);
    expect(
      await createAgentVerifier(external, () => now).verifyApproval(doc.text, {
        id: approval.id,
        approves: proposal.id,
        termsDigest: proposal.intent.termsDigest,
      }),
    ).toBe("verified");
    expect(credentialed).not.toHaveBeenCalled();
    expect(external.publicFetch).toHaveBeenCalled();
    await expect(setupApprovalKey(external)).rejects.toThrow("outside the storage you shared");
    expect(credentialed).not.toHaveBeenCalled();
  });
  it.each([
    "PUT",
    "readback",
    "pointer",
  ])("keeps the old key usable and removes the orphan after a failed replacement (%s)", async (failure) => {
    const { session, client } = await fixture();
    await setupApprovalKey(session);
    const old = localStorage.getItem(PREF);
    const store = new ApprovalKeyStore();
    const generate = vi.spyOn(store, "generate");
    const fetch: typeof globalThis.fetch = async (input, init) =>
      init?.method === "PUT"
        ? new Response(null, { status: failure === "PUT" ? 403 : 205 })
        : session.fetch(input, init);
    if (failure === "pointer")
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("storage full");
      });
    await expect(
      setupApprovalKey({ ...session, fetch: failure === "pointer" ? session.fetch : fetch }, store),
    ).rejects.toThrow();
    const orphan = await generate.mock.results[0]?.value;
    expect(orphan).toBeDefined();
    expect(await store.get(orphan.verificationMethod)).toBeUndefined();
    expect(localStorage.getItem(PREF)).toBe(old);
    expect(await approvalKeyStatus(session)).toBe("ready");
    expect(await withApprovalKey(session, async (key) => key.verificationMethod)).toBe(old);
    const approval = await createAgentSigner(session, client, () => now).signApproval(
      proposal,
      "approve",
    );
    expect(
      (
        await readApprovals(
          client,
          createAgentVerifier(session, () => now),
        )
      ).find((row) => row.url === approval.id),
    ).toMatchObject({ verified: "verified" });
  });
  it("ignores a published but inactive key after a crash before the pointer switch", async () => {
    const { session } = await fixture();
    const store = new ApprovalKeyStore();
    const inactive = await store.generate(DEMO_WEBID);
    await publishApprovalKey(session, inactive);
    expect(await approvalKeyStatus(session)).toBe("none");
    await expect(withApprovalKey(session, async () => true)).rejects.toThrow("Set up");
    await setupApprovalKey(session);
    const old = localStorage.getItem(PREF);
    const replacement = await store.generate(DEMO_WEBID);
    await publishApprovalKey(session, replacement);
    // Simulate a reload: new store/resolver instances only consult the saved pointer.
    expect(await approvalKeyStatus(session, new ApprovalKeyStore())).toBe("ready");
    expect(await withApprovalKey(session, async (key) => key.verificationMethod)).toBe(old);
    expect((await store.get(replacement.verificationMethod))?.privateKey.extractable).toBe(false);
    expect(
      await createWebIdKeyResolver({ fetch: session.fetch }).isControlledBy(
        replacement.verificationMethod,
        session.webId,
      ),
    ).toBe(true);
  });
  it("keeps an existing owner-keyed device record usable and retains it when rotating", async () => {
    const { session } = await fixture();
    const store = new ApprovalKeyStore();
    const key = await store.generate(session.webId);
    await publishApprovalKey(session, key);
    await store.delete(key.verificationMethod);
    // Recreate the previous on-disk format without migrating or exporting private material.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("solid-suite-agent-keys", 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(key, session.webId);
      tx.oncomplete = () => resolve();
    });
    db.close();
    localStorage.setItem(PREF, key.verificationMethod);
    expect(await approvalKeyStatus(session)).toBe("ready");
    expect(await withApprovalKey(session, async (saved) => saved.verificationMethod)).toBe(
      key.verificationMethod,
    );
    await setupApprovalKey(session);
    expect(localStorage.getItem(PREF)).not.toBe(key.verificationMethod);
    expect((await store.get(session.webId))?.verificationMethod).toBe(key.verificationMethod);
    const response = await session.fetch(profile);
    await session.fetch(profile, {
      method: "PUT",
      body: "",
      headers: { "content-type": "text/turtle" },
    });
    await expect(withApprovalKey(session, async () => true)).rejects.toThrow("Set up");
    expect(await response.text()).toContain("assertionMethod");
  });
  it("retries three profile conflicts, retaining concurrent profile changes and validators", async () => {
    const { session } = await fixture();
    const key = await new ApprovalKeyStore().generate(DEMO_WEBID);
    let conflicts = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PUT" && conflicts++ < 3) {
        const old = await session.fetch(profile);
        // Same complete graph but a new ETag, like another device updating the profile.
        const graph = await parseRdf(await old.text(), "text/turtle");
        metadataNode(graph, DEMO_WEBID).setText(
          "http://xmlns.com/foaf/0.1/name",
          "Alice from another device",
        );
        await session.fetch(profile, {
          method: "PUT",
          headers: { "content-type": "text/turtle" },
          body: await serialize([...graph]),
        });
      }
      return session.fetch(input, init);
    };
    await publishApprovalKey({ ...session, fetch }, key);
    expect(conflicts).toBe(4);
    expect(
      metadataNode(
        await parseRdf(await (await session.fetch(profile)).text(), "text/turtle"),
        DEMO_WEBID,
      ).text("http://xmlns.com/foaf/0.1/name"),
    ).toBe("Alice from another device");
    expect(
      await createWebIdKeyResolver({ fetch }).isControlledBy(key.verificationMethod, DEMO_WEBID),
    ).toBe(true);
    await expect(
      publishApprovalKey(
        {
          ...session,
          fetch: async (input, init) =>
            init?.method === "PUT"
              ? new Response(null, { status: 412 })
              : session.fetch(input, init),
        },
        key,
      ),
    ).rejects.toThrow("kept changing");
  });
  it("fails safely on profile errors, missing validators and publication not retained", async () => {
    const { session } = await fixture();
    const key = await new ApprovalKeyStore().generate(DEMO_WEBID);
    for (const response of [
      new Response(null, { status: 403 }),
      new Response("", { headers: { "content-type": "text/turtle" } }),
    ])
      await expect(
        publishApprovalKey({ ...session, fetch: async () => response }, key),
      ).rejects.toThrow();
    await expect(
      publishApprovalKey(
        {
          ...session,
          fetch: async (input, init) =>
            init?.method === "PUT"
              ? new Response(null, { status: 403 })
              : session.fetch(input, init),
        },
        key,
      ),
    ).rejects.toThrow("update");
    await expect(
      publishApprovalKey(
        {
          ...session,
          fetch: async (input, init) =>
            init?.method === "PUT"
              ? new Response(null, { status: 205 })
              : session.fetch(input, init),
        },
        key,
      ),
    ).rejects.toThrow("confirmed");
    await setupApprovalKey(session);
    const saved = await session.fetch(profile);
    await session.fetch(profile, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "",
    });
    expect(await approvalKeyStatus(session)).toBe("unavailable");
    expect(await saved.text()).toContain("assertionMethod");
  });
  it("surfaces IndexedDB open, read and transaction failures", async () => {
    const { session } = await fixture();
    const store = new ApprovalKeyStore();
    const open = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      const request = { error: new Error("blocked") } as IDBOpenDBRequest;
      queueMicrotask(() => request.onerror?.(new Event("error")));
      return request;
    });
    await expect(store.get(DEMO_WEBID)).rejects.toThrow("blocked");
    open.mockRestore();
    const get = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(() => {
      const request = { error: new Error("read failed") } as IDBRequest;
      queueMicrotask(() => request.onerror?.(new Event("error")));
      return request;
    });
    await expect(store.get(DEMO_WEBID)).rejects.toThrow("read failed");
    get.mockRestore();
    const put = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (
      this: IDBObjectStore,
    ) {
      this.transaction.abort();
      return {} as IDBRequest;
    });
    await expect(store.generate(DEMO_WEBID)).rejects.toBeNull();
    put.mockRestore();
    await setupApprovalKey(session);
    await store.delete(localStorage.getItem(PREF) as string);
    await expect(withApprovalKey(session, async () => true)).rejects.toThrow("Set up");
    const remove = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
    ) {
      this.transaction.abort();
      return {} as IDBRequest;
    });
    await expect(store.delete("missing")).rejects.toBeNull();
    remove.mockRestore();
  });
});

describe("signed approvals and controls", () => {
  it("rejects expired/prohibited approvals and verifies control status including unverified records", async () => {
    const { session, client } = await fixture();
    await setupApprovalKey(session);
    const signer = createAgentSigner(session, client, () => now);
    await expect(
      signer.signApproval({ ...proposal, validUntil: now.toISOString() }, "approve"),
    ).rejects.toThrow("expired");
    await expect(
      signer.signApproval(
        { ...proposal, intent: { ...proposal.intent, parameters: { prohibited: true } } },
        "approve",
      ),
    ).rejects.toThrow("never");
    const realTime = new Date();
    const live = { ...proposal, validUntil: new Date(realTime.getTime() + 86400000).toISOString() };
    const liveApproval = await createAgentSigner(session, client).signApproval(live, "approve");
    const liveControl = await createAgentSigner(session, client).signControl("Resume");
    const defaultVerifier = createAgentVerifier(session);
    expect(
      await defaultVerifier.verifyApproval(
        (await client.graph(liveApproval.id)).text,
        liveApproval,
      ),
    ).toBe("verified");
    expect(
      await defaultVerifier.verifyControl(
        (await client.graph(liveControl.id)).text,
        liveControl.id,
      ),
    ).toBe("verified");
    const halt = await signer.signControl("Halt");
    expect(Date.parse(halt.expires) - now.getTime()).toBe(365 * 86400000);
    await signer.signControl("SetBindingState", {
      target: `${client.paths.accounts}direct.ttl`,
      binding: "direct",
      bindingState: "disabled",
      restrictions: { read: true, triage: false, draft: false, send: false },
    });
    const controls = loadedRecords(
      await readControl(
        client,
        createAgentVerifier(session, () => now),
      ),
    );
    expect(agentStatus({ controls, now: now.getTime(), owner: DEMO_WEBID }).state).toBe("stopped");
    const resume = await createAgentSigner(
      session,
      client,
      () => new Date(now.getTime() + 1),
    ).signControl("Resume");
    expect(resume.createdAt).not.toBe(halt.createdAt);
    const resumed = loadedRecords(
      await readControl(
        client,
        createAgentVerifier(session, () => new Date(now.getTime() + 2)),
      ),
    );
    expect(
      agentStatus({ controls: resumed, heartbeatAt: now.toISOString(), now: now.getTime() + 2 })
        .state,
    ).toBe("running");
    const unverified = resumed.map((c) => ({ ...c, verification: "unchecked" as const }));
    expect(
      agentStatus({ controls: unverified, heartbeatAt: now.toISOString(), now: now.getTime() + 2 })
        .state,
    ).toBe("running");
    expect(await createAgentVerifier(session).verifyControl("bad", "urn:bad")).toEqual({
      invalid: "malformed",
    });
    expect(
      await createAgentVerifier(session).verifyApproval("bad", {
        id: "urn:bad",
        approves: "urn:p",
        termsDigest: "x",
      }),
    ).toEqual({ invalid: "malformed" });
  });
  it("signs Archive into archive/, apart from authority controls, and hides only verified owner archives", async () => {
    const { session, client } = await fixture();
    await setupApprovalKey(session);
    const signer = createAgentSigner(session, client, () => now);
    const target = `${client.paths.inbox}gmail/gmail/message-1.ttl`;
    const authority = (await readControl(client)).length;
    const archive = await signer.signControl("Archive", { target });
    expect(archive.id.startsWith(client.paths.archive)).toBe(true);
    expect(Date.parse(archive.expires) - now.getTime()).toBe(365 * 86400000);
    await expect(signer.signControl("Archive")).rejects.toThrow(/target/);
    // Authority reads (status pill, executor) never page through archive volume.
    expect(await readControl(client)).toHaveLength(authority);
    const verified = loadedRecords(
      await readControl(
        client,
        createAgentVerifier(session, () => now),
        client.paths.archive,
      ),
    );
    expect(verified.map((c) => [c.kind, c.target, c.verification])).toEqual([
      ["Archive", target, "verified"],
    ]);
    const at = now.getTime();
    expect([...archivedMessages(verified, DEMO_WEBID, at)]).toEqual([target]);
    const [row] = verified;
    if (!row) throw new Error("Missing archive");
    for (const control of [
      { ...row, verification: "unchecked" as const },
      { ...row, verification: { invalid: "signature" } },
      { ...row, attributedTo: "https://other.example/#me" },
      { ...row, kind: "Forget" as const },
      { ...row, target: undefined },
      { ...row, createdAt: new Date(at + 1).toISOString() },
      { ...row, expires: new Date(at).toISOString() },
    ])
      expect(archivedMessages([control], DEMO_WEBID, at).size).toBe(0);
  });
  it("keeps malformed claims as error rows and unsigned records unchecked", async () => {
    const { client, session } = await fixture();
    await client.create(`${client.paths.approvals}bad.trig`, "bad", "application/trig");
    await client.create(`${client.paths.control}bad.trig`, "bad", "application/trig");
    await client.create(`${client.paths.approvals}empty.trig`, "", "application/trig");
    await client.create(`${client.paths.control}empty.trig`, "", "application/trig");
    await client.create(`${client.paths.approvals}folder/`, "");
    await client.create(`${client.paths.control}folder/`, "");
    expect((await readApprovals(client)).filter((r) => !isLoaded(r))).toHaveLength(2);
    expect((await readControl(client)).filter((r) => !isLoaded(r))).toHaveLength(2);
    const rows = loadedRecords(
      await readControl(
        client,
        createAgentVerifier(session, () => now),
      ),
    );
    expect(rows[0]?.verification).not.toBe("verified");
    await setupApprovalKey(session);
    const key = await new ApprovalKeyStore().get(localStorage.getItem(PREF) as string);
    if (!key) throw new Error("Missing test key");
    const id = `${client.paths.approvals}without-created.trig`;
    const plain = { ...exampleRecords.approval, id };
    const graph = await parseRdf(await issueApproval(plain, key, now), "application/trig");
    await client.create(
      id,
      await serialize(
        [...graph].filter(
          (q) =>
            q.graph.termType === "DefaultGraph" &&
            q.predicate.value !== "https://w3id.org/security#proof" &&
            q.predicate.value !== "http://purl.org/dc/terms/created",
        ),
      ),
      "application/trig",
    );
    expect(loadedRecords(await readApprovals(client)).find((a) => a.id === id)).toMatchObject({
      createdAt: "",
      verification: "unchecked",
    });
    const signedId = `${client.paths.approvals}signed.trig`;
    const doc = await issueApproval(
      {
        id: signedId,
        approves: proposal.id,
        termsDigest: "x",
        expires: proposal.validUntil,
        decision: "approve",
      },
      key,
      now,
    );
    await client.create(signedId, doc, "application/trig");
    const wrong = await issueControlStatement(
      {
        id: `${client.paths.control}wrong.trig`,
        kind: "Halt",
        attributedTo: "https://other.example/#me",
        createdAt: now.toISOString(),
        expires: proposal.validUntil,
      },
      key,
      now,
    );
    await client.create(`${client.paths.control}wrong.trig`, wrong, "application/trig");
    expect(
      loadedRecords(
        await readControl(
          client,
          createAgentVerifier(session, () => now),
        ),
      ).some((r) => typeof r.verification === "object" && r.verification.invalid === "attribution"),
    ).toBe(true);
  });
});
