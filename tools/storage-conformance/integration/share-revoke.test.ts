// AUTHORED-BY Claude Sonnet 5.5
import { createAccessClient } from "@jeswr/pod-access";
import type { StorageClient } from "@jeswr/storage-client";
import { expect, test } from "vitest";
import { container, text } from "../src/case-helpers.js";
import { cssTarget } from "../src/targets/css.js";

// Opt-in, socket-based. Authentication is reactive (anonymous first, upgraded on a 401), so once
// a public rule exists the HEAD succeeds anonymously and `allow` describes the anonymous caller,
// not the owner. revoke() must still work, because the server (not that header) is the authority
// on whether the conditional write is allowed.
test("revoke() after the package's own share() succeeds on CSS, for a public read grant", async () => {
  const running = await cssTarget.start();
  try {
    const folder = await container(running, `share-revoke-${Date.now()}`);
    const note = await text(running.storage, folder);
    // CSS advertises no access-control model, so the caller states it (a WAC pod).
    const storage = {
      ...running.storage,
      features: {
        ...running.storage.features,
        accessControl: { state: "available", evidence: "test", detail: { model: "wac" } },
      },
    } as StorageClient;
    // createAccessClient edits an existing own ACL and never creates one (documented), so the
    // owner's own ACL, keeping Control, is installed first.
    const aclUrl = (await running.storage.head(note.url)).links.get("acl")?.[0]?.target as string;
    const created = await running.fetch(aclUrl, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:agent <${running.webId}>; acl:accessTo <${note.url}>;
  acl:mode acl:Read, acl:Write, acl:Append, acl:Control.`,
    });
    await created.body?.cancel();
    expect(created.status).toBeLessThan(300);
    const client = createAccessClient({ storage, identity: () => running.webId });

    const grant = await client.share(note.url, { agent: { public: true }, modes: ["read"] }, {});
    expect(grant.id).toBeDefined();
    const anonymous = await fetch(note.url);
    await anonymous.body?.cancel();
    expect(anonymous.status).toBe(200);

    await client.revoke(note.url, { public: true });
    const after = await fetch(note.url);
    await after.body?.cancel();
    expect([401, 403]).toContain(after.status);
    expect((await client.grants(note.url)).some((g) => g.id === grant.id)).toBe(false);

    // The owner keeps read access and still edits the ACL: a further share/revoke round trip.
    const owner = await running.storage.head(note.url, { revalidate: true });
    expect(owner.status).toBe(200);
    const again = await client.share(note.url, { agent: { public: true }, modes: ["read"] }, {});
    await client.revoke(note.url, { public: true });
    expect((await client.grants(note.url)).some((g) => g.id === again.id)).toBe(false);
  } finally {
    await running.stop();
  }
}, 120_000);
