// AUTHORED-BY Codex GPT-6.1-Sol

import { readGrants } from "@jeswr/pod-access/roles";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { GroupDirectory } from "@jeswr/suite-groups";
import { expect, it, vi } from "vitest";
import { applySharing, loadSharing, toGrants } from "../src/apps/drive/lib/sharing/adapter";
import { sharingSummary } from "../src/apps/drive/state/access";
import { applyRevoke, loadPermissions, planRevoke } from "../src/apps/home/lib/permissions";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { familySpaces } from "../src/shell/groups/family-spaces";
import { shareSubtitle } from "../src/shell/lib/share-options";
import { WacSharingAdapter } from "../src/shell/share/wac-adapter";

it("persists a group grant, preserves it across person edits, lists and revokes it in Permissions", async () => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  const session = { storageUrl: DEMO_ROOT, fetch: pod.fetch, webId: DEMO_WEBID };
  const { storage } = await createPodClient({
    storage: DEMO_ROOT,
    fetch: pod.fetch,
    capabilities: createMemoryCache(),
  });
  const notify = vi.fn().mockResolvedValue({ delivered: true, inbox: null });
  const directory = new GroupDirectory({ storage, fetch: pod.fetch, webId: DEMO_WEBID }, notify);
  expect((await directory.list()).map((group) => group.name)).toEqual(["Family", "Garden team"]);
  const group = await directory.create("Book club", ["https://bob.example.org/#me"]);
  const file = `${DEMO_ROOT}drive/notes.md`;
  await directory.share(group.id, file, "viewer");
  const first = await loadSharing(session, file);
  expect(first.state.groups).toEqual([group.id]);
  expect(sharingSummary(first.state, DEMO_WEBID)).toBe("Shared with groups");
  expect(
    shareSubtitle({
      people: [],
      groups: [group.id],
      general: { mode: "restricted" },
      canManage: true,
    }),
  ).toBe("Shared with groups");
  const selection = {
    ...first.state,
    people: [
      ...first.state.people,
      { webId: "https://carol.example/#me", role: "viewer" as const },
    ],
  };
  expect(toGrants(session, first, selection)?.grants).toEqual(
    expect.arrayContaining([expect.objectContaining({ agent: { type: "group", id: group.id } })]),
  );
  await applySharing(session, first, selection);
  const snapshot = await loadPermissions({
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
  });
  const row = snapshot.rows.find((row) => row.kind === "group" && row.id === group.id);
  expect(row?.lines.flatMap((line) => line.resources.map((resource) => resource.url))).toContain(
    file,
  );
  const adapter = new WacSharingAdapter({ fetch: pod.fetch, webId: DEMO_WEBID });
  await adapter.load(file, new AbortController().signal);
  await adapter.setPerson(file, "https://dana.example/#me", "viewer");
  expect((await readGrants(file, { fetch: pod.fetch, root: DEMO_ROOT })).grants).toEqual(
    expect.arrayContaining([expect.objectContaining({ agent: { type: "group", id: group.id } })]),
  );
  if (!row) throw new Error("Missing group row");
  await applyRevoke(planRevoke(row, "all"), {
    fetch: pod.fetch,
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
  });
  expect(
    (await readGrants(file, { fetch: pod.fetch, root: DEMO_ROOT })).grants.some(
      (grant) => grant.agent.type === "group",
    ),
  ).toBe(false);
  await directory.removeMember(group.id, "https://bob.example.org/#me");
  await directory.delete(await directory.grants(group.id));
  expect((await directory.list()).some((item) => item.id === group.id)).toBe(false);
});

it("creates actual Family calendar, photo and task resources and grants the group access", async () => {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(Date.now(), { calendar: false }),
  });
  const session = { storageUrl: DEMO_ROOT, fetch: pod.fetch, webId: DEMO_WEBID };
  const { storage } = await createPodClient({
    storage: DEMO_ROOT,
    fetch: pod.fetch,
    capabilities: createMemoryCache(),
  });
  const directory = new GroupDirectory(
    { storage, fetch: pod.fetch, webId: DEMO_WEBID },
    vi.fn().mockResolvedValue({ delivered: true, inbox: null }),
  );
  const group = await directory.create("Family Two", []);
  const spaces = familySpaces(session, ["calendar", "photos", "tasks"], "editor");
  await directory.setupFamily(group.id, spaces);
  expect(pod.has(`${DEMO_ROOT}calendar/family.ttl`)).toBe(true);
  expect(pod.has(`${DEMO_ROOT}photos/albums/family.ttl`)).toBe(true);
  expect(pod.has(`${DEMO_ROOT}tasks/projects/family.ttl`)).toBe(true);
  const calendarGrants = await readGrants(`${DEMO_ROOT}calendar/family/`, {
    fetch: pod.fetch,
    root: DEMO_ROOT,
    kind: "folder",
  });
  expect(calendarGrants.grants).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ agent: { type: "group", id: group.id }, role: "editor" }),
    ]),
  );
});
