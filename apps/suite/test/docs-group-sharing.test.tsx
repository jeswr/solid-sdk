// AUTHORED-BY Codex GPT-6
// @vitest-environment jsdom
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { readGrants } from "@jeswr/pod-access/roles";
import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { useDocumentSharing } from "../src/apps/docs/hooks/use-document-sharing";
import { docContainerUrls } from "../src/apps/docs/lib/model/layout";
import type { SharingSession } from "../src/apps/drive/lib/sharing/adapter";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { groupDirectory } from "../src/shell/groups/client";

const layout = docContainerUrls(`${DEMO_ROOT}docs/launch.ttl`);
function DocsSharing({ session }: { session: SharingSession }) {
  const { button, dialog } = useDocumentSharing(
    session,
    layout.resource,
    "Launch plan",
    true,
    false,
  );
  return (
    <>
      {button}
      {dialog}
    </>
  );
}

afterEach(cleanup);

it.each([
  "inherited",
  "explicit",
])("shares and removes a group in Docs with %s child policies", async (policies) => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  const session = { fetch: pod.fetch, storageUrl: DEMO_ROOT, webId: DEMO_WEBID };
  const group = await (await groupDirectory(session)).create("Reviewers", []);
  const version = `${layout.versions}first.ttl`;
  await pod.fetch(version, { method: "PUT", body: "" });
  const children = [layout.updateLog, layout.assets, layout.comments, layout.versions];
  if (policies === "explicit") {
    for (const url of children) {
      const acl = `${url}.acl`;
      await pod.fetch(acl, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body: await writeWac(ownerPolicy(DEMO_WEBID, true), url, acl),
      });
    }
  }
  async function checkGrants(shared: boolean) {
    for (const url of [layout.resource, layout.container, ...children, version]) {
      const { grants } = await readGrants(url, {
        fetch: pod.fetch,
        root: DEMO_ROOT,
        kind: url.endsWith("/") ? "folder" : "resource",
      });
      const held = grants.filter(
        (grant) => grant.agent.type === "group" && grant.agent.id === group.id,
      );
      const inherited = url === version || (policies === "inherited" && children.includes(url));
      expect(held, url).toMatchObject(shared ? [{ role: "viewer", inherited }] : []);
    }
  }
  render(<DocsSharing session={session} />);
  const share = screen.getByRole("button", { name: "Share" });
  await waitFor(() => expect(share.getAttribute("aria-disabled")).toBe("false"));
  fireEvent.click(share);
  const picker = await screen.findByRole("combobox", { name: "Add groups" });
  await waitFor(() => expect(picker.matches(":disabled")).toBe(false));
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: "Reviewers" } });
  fireEvent.click(await screen.findByRole("option", { name: /Reviewers/ }));
  fireEvent.click(screen.getByRole("button", { name: "Share with group" }));
  const remove = await screen.findByRole("button", { name: "Remove group access" });
  await checkGrants(true);
  expect(remove.matches(":disabled")).toBe(false);
  fireEvent.click(remove);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Remove group access" })).toBeNull(),
  );
  await checkGrants(false);
});
