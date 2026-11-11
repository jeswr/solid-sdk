// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openPublishRepository } from "@jeswr/solid-publish";
import { toast } from "@jeswr/suite-ui";
import { describe, expect, it, vi } from "vitest";
import { ensureSample } from "../src/apps/publish/demo/sample";
import { connectPublish } from "../src/apps/publish/lib/data/connect";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const root = "https://publish.demo.example/";
const owner = `${root}profile/card#me`;
function sessionFixture() {
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: `<${owner}> <http://www.w3.org/ns/pim/space#storage> <${root}>.`,
      },
      {
        path: ".acl",
        contentType: "text/turtle",
        body: `@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#owner> a acl:Authorization; acl:agent <${owner}>; acl:accessTo <${root}>; acl:default <${root}>; acl:mode acl:Read,acl:Write,acl:Control.`,
      },
    ],
  });
  const session: PodSession = {
    mode: "demo",
    fetch: pod.fetch,
    webId: owner,
    displayName: "Robin Fiction",
    storageUrl: root,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return { pod, session };
}
describe("Publish session and demo seeding", () => {
  it("uses the real shared repository to seed one fictional blog, three posts and About", async () => {
    const { session, pod } = sessionFixture();
    const repo = await connectPublish(session);
    const { items: sites } = await repo.listSites();
    expect(sites).toHaveLength(1);
    const site = sites[0];
    if (!site) throw new Error("No sample site");
    expect(site.data.author).toBe("Rowan Fern");
    expect(site.data.publicUrl).toBeDefined();
    const { items: pages } = await repo.listPages(site);
    expect(pages.filter((p) => p.data.kind === "post")).toHaveLength(3);
    expect(pages.filter((p) => p.data.kind === "page")).toHaveLength(1);
    expect(pages.filter((p) => p.data.status === "draft")).toHaveLength(1);
    const html = await pod.fetch(`${repo.publicUrl(site)}index.html`);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(await html.text()).toContain("A slower Sunday");
    await Promise.all([ensureSample(session, repo), ensureSample(session, repo)]);
    expect((await repo.listSites()).items).toHaveLength(1);
    // A new session transport still finds the existing site instead of seeding twice.
    const other = { ...session, fetch: ((input, init) => pod.fetch(input, init)) as typeof fetch };
    await ensureSample(other, repo);
    expect((await repo.listSites()).items).toHaveLength(1);
    const privateSource = await pod.fetch(`${root}publish/.acl`);
    expect(await privateSource.text()).not.toContain("foaf/0.1/Agent");
  });
  it("connects and creates another site against the real suite demo seed with an inherited Type Index ACL", async () => {
    const seed = await buildDemoSeed(Date.now(), { calendar: false });
    const pod = createDemoPod({ root: DEMO_ROOT, seed });
    expect(pod.has(`${DEMO_ROOT}settings/privateTypeIndex.ttl.acl`)).toBe(false);
    const session: PodSession = {
      mode: "demo",
      fetch: pod.fetch,
      webId: DEMO_WEBID,
      displayName: "Alice Wilder",
      storageUrl: DEMO_ROOT,
      subscribe: pod.subscribe,
      reset: async () => {},
    };
    const repository = await connectPublish(session);
    await ensureSample(session, repository);
    const sample = (await repository.listSites()).items[0];
    if (!sample) throw new Error("Missing sample site");
    const created = await repository.createSite("another", {
      ...sample.data,
      name: "Another site",
    });
    const index = await (await pod.fetch(`${DEMO_ROOT}settings/privateTypeIndex.ttl`)).text();
    expect(index).toContain(sample.url);
    expect(index).toContain(created.url);
    expect((await repository.listSites()).items).toHaveLength(2);
  });
  it("shows registration warnings through the global suite toast without aborting the demo", async () => {
    const { session, pod } = sessionFixture();
    const warning = vi.spyOn(toast, "warning").mockReturnValue("registration-warning");
    const unavailable: PodSession = {
      ...session,
      fetch: async (input, init) => {
        if (String(input).endsWith("privateTypeIndex.ttl") && init?.method === "PUT")
          return new Response(null, { status: 403 });
        return pod.fetch(input, init);
      },
    };
    const repository = await connectPublish(unavailable);
    expect((await repository.listSites()).items).toHaveLength(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("site was saved"));
    warning.mockRestore();
  });
  it("never seeds live accounts and retries a failed seed on the same session", async () => {
    const { session } = sessionFixture();
    const repo = await openPublishRepository(session.fetch, root, owner, { protocol: "solid" });
    const inspect = vi.spyOn(repo, "listSites");
    await ensureSample({ ...session, mode: "solid", publicFetch: session.fetch }, repo);
    expect(inspect).not.toHaveBeenCalled();
    inspect.mockRejectedValueOnce(new Error("offline"));
    await expect(ensureSample(session, repo)).rejects.toThrow("offline");
    await ensureSample(session, repo);
    expect((await repo.listSites()).items).toHaveLength(1);
  });
});
