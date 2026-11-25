// AUTHORED-BY Claude Sonnet 5.5
import { checkOwnerOnly, checkOwnerOnlyAuto } from "@jeswr/pod-access";
import { expect, test } from "vitest";
import { container, text } from "../src/case-helpers.js";
import { cssAcpTarget } from "../src/targets/css.js";

// Opt-in, socket-based. CSS in its ACP configuration advertises ACRs with rel="acl" too and
// accepts any RDF there. A WAC-shaped "owner only" document in a note's ACR grants nothing,
// while an ancestor's public member policy still applies: the note is publicly readable and
// must never be reported private. CSS-ACP sends no WAC-Allow header, which is why it cannot be
// mistaken for a WAC server.
test("a WAC-shaped owner-only ACR under a public member policy is never private", async () => {
  const running = await cssAcpTarget.start();
  try {
    const folder = await container(running, `owner-only-acp-${Date.now()}`);
    const note = await text(running.storage, folder);
    const acrOf = async (url: string) => {
      const target = (await running.storage.head(url)).links.get("acl")?.[0]?.target;
      expect(target).toBeDefined();
      return target as string;
    };
    const put = async (url: string, body: string) => {
      const response = await running.fetch(url, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body,
      });
      await response.body?.cancel();
      expect(response.status).toBeLessThan(300);
    };
    // The note's ACR first: the owner keeps access through the storage root's member policy.
    await put(
      await acrOf(note.url),
      `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
<#owner> a acl:Authorization; acl:accessTo <${note.url}>; acl:agent <${running.webId}>;
  acl:mode acl:Read, acl:Write, acl:Control.`,
    );
    await put(
      await acrOf(folder),
      `@prefix acp: <http://www.w3.org/ns/solid/acp#>. @prefix acl: <http://www.w3.org/ns/auth/acl#>.
<> a acp:AccessControlResource; acp:resource <${folder}>; acp:memberAccessControl <#members>.
<#members> acp:apply <#public>.
<#public> acp:allow acl:Read; acp:anyOf <#anyone>.
<#anyone> acp:agent acp:PublicAgent.`,
    );
    const anonymous = await fetch(note.url, { redirect: "error" });
    await anonymous.body?.cancel();
    expect(anonymous.status).toBe(200);

    const options = { storage: running.storage, url: note.url, ownerWebId: running.webId };
    const auto = await checkOwnerOnlyAuto(options);
    expect(auto.private).toBe(false);
    expect(auto.detected).toEqual({ model: "undecided", reason: "no-wac-evidence" });
    expect(await checkOwnerOnly({ ...options, accessModel: "wac" })).toMatchObject({
      private: false,
      reasons: [{ reason: "no-wac-evidence" }],
    });
  } finally {
    await running.stop();
  }
}, 120_000);

// A resource without its own ACR has no usable verdict on CSS-ACP (never inherited): not private.
test("a fresh resource without its own ACR is not reported private", async () => {
  const running = await cssAcpTarget.start();
  try {
    const folder = await container(running, `owner-only-acp-fresh-${Date.now()}`);
    const note = await text(running.storage, folder);
    const result = await checkOwnerOnlyAuto({
      storage: running.storage,
      url: note.url,
      ownerWebId: running.webId,
    });
    expect(result.private).toBe(false);
  } finally {
    await running.stop();
  }
}, 120_000);
