// AUTHORED-BY Claude Opus 5.5
// Drive's scope-aware sharing (sst-uo4.4) through the SDK role layer against the demo pod.
import { serialize } from "@jeswr/rdf-serialize";
import { expect, it, vi } from "vitest";
import {
  applyScopedSharing,
  isPartialScope,
  loadScopedSharing,
  loadSharing,
  SharingConflictError,
  SharingRefreshError,
  type SharingSession,
} from "../src/apps/drive/lib/sharing/adapter";
import { SharingError } from "../src/apps/drive/lib/sharing/rdf";
import { UNMAPPED, verifyScopedAccess } from "../src/apps/drive/lib/sharing/verify";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import {
  ACL,
  ALICE,
  authorization,
  BOB,
  CAROL,
  document,
  PUBLIC,
  properties,
} from "./sharing-fixtures";

const ROOT = "https://example.org/";
const FOLDER = `${ROOT}drive/drop/`;

/** A folder Alice owns on both scopes, whose items inside (only) Bob can read. */
async function setup(webId = ALICE) {
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(FOLDER, { method: "PUT" });
  const doc = document("wac", false, FOLDER);
  authorization(doc, ALICE, ["Read", "Write", "Control"]).default = FOLDER;
  const rule = authorization(doc, BOB, ["Read"]);
  properties(rule).values(`${ACL}accessTo`).clear();
  rule.default = FOLDER;
  const write = async () =>
    pod.fetch(doc.source, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: await serialize([...doc.dataset]),
    });
  await write();
  let hook: ((url: string, init?: RequestInit) => Response | undefined) | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(
    async (url, init) => hook?.(String(url), init) ?? pod.fetch(url, init),
  );
  const session: SharingSession = { fetch, webId, storageUrl: ROOT };
  return {
    pod,
    doc,
    session,
    write,
    fetch,
    intercept: (next: typeof hook) => {
      hook = next;
    },
  };
}
const roles = (state: { people: { webId: string; role: string }[]; link: string }) => [
  state.people.map((p) => [p.webId, p.role]),
  state.link,
];

it("opens a WAC folder with different contents access per scope, and makes them match", async () => {
  const env = await setup();
  const plain = await loadSharing(env.session, FOLDER).catch((error: unknown) => error);
  expect(isPartialScope(plain)).toBe(true);
  expect(isPartialScope(new SharingError("other"))).toBe(false);
  const scoped = await loadScopedSharing(env.session, FOLDER);
  expect(scoped.canManage).toBe(true);
  expect(roles(scoped.folder)).toEqual([[[ALICE, "owner"]], "none"]);
  expect(roles(scoped.contents)).toEqual([
    [
      [ALICE, "owner"],
      [BOB, "viewer"],
    ],
    "none",
  ]);
  // Change one scope only: Carol edits the items inside.
  const split = await applyScopedSharing(env.session, scoped, {
    folder: scoped.folder,
    contents: {
      ...scoped.contents,
      people: [...scoped.contents.people, { webId: CAROL, role: "editor" }],
    },
  });
  expect(roles(split.folder)).toEqual([[[ALICE, "owner"]], "none"]);
  expect(split.contents.people.map((p) => p.webId)).toEqual([ALICE, BOB, CAROL]);
  // An unchanged selection writes nothing.
  const puts = () => env.fetch.mock.calls.filter(([, init]) => init?.method === "PUT").length;
  const before = puts();
  expect(
    await applyScopedSharing(env.session, split, {
      folder: split.folder,
      contents: split.contents,
    }),
  ).toBe(split);
  expect(puts()).toBe(before);
  // Making the items inside match the folder returns it to the ordinary dialog.
  const matched = await applyScopedSharing(env.session, split, {
    folder: split.folder,
    contents: split.folder,
  });
  expect(roles(matched.contents)).toEqual(roles(matched.folder));
  expect(roles((await loadSharing(env.session, FOLDER)).state)).toEqual([
    [[ALICE, "owner"]],
    "none",
  ]);
});

it("shares general access on one scope and refuses removing the owner's Control", async () => {
  const env = await setup();
  const scoped = await loadScopedSharing(env.session, FOLDER);
  const shared = await applyScopedSharing(env.session, scoped, {
    folder: { ...scoped.folder, link: "viewer", public: "viewer" },
    contents: scoped.contents,
  });
  expect(shared.folder.link).toBe("viewer");
  expect(shared.contents.link).toBe("none");
  await expect(
    applyScopedSharing(env.session, shared, {
      folder: shared.folder,
      contents: { ...shared.contents, people: [{ webId: BOB, role: "viewer" }] },
    }),
  ).rejects.toThrow("You cannot remove your own owner access or Control");
});

it("refuses a stale save, and a save by someone who can't manage the folder", async () => {
  const env = await setup();
  const scoped = await loadScopedSharing(env.session, FOLDER);
  authorization(env.doc, PUBLIC, ["Read"]).default = FOLDER;
  await env.write();
  await expect(
    applyScopedSharing(env.session, scoped, { folder: scoped.contents, contents: scoped.contents }),
  ).rejects.toBeInstanceOf(SharingConflictError);
  const bob = await setup(BOB);
  const viewer = await loadScopedSharing(bob.session, FOLDER);
  expect(viewer.canManage).toBe(false);
  await expect(
    applyScopedSharing(bob.session, viewer, { folder: viewer.contents, contents: viewer.contents }),
  ).rejects.toThrow("Only an owner can change sharing");
});

it("reports an unconfirmed save and one the pod did not apply as chosen", async () => {
  const env = await setup();
  const scoped = await loadScopedSharing(env.session, FOLDER);
  const original = await (await env.pod.fetch(env.doc.source)).text();
  // The PUT is acknowledged but not stored: the reload still shows the old access.
  env.intercept((url, init) =>
    url === env.doc.source && init?.method === "PUT"
      ? new Response(null, { status: 204 })
      : undefined,
  );
  const carol = {
    ...scoped.contents,
    people: [...scoped.contents.people, { webId: CAROL, role: "viewer" as const }],
  };
  await expect(
    applyScopedSharing(env.session, scoped, { folder: scoped.contents, contents: carol }),
  ).rejects.toThrow(
    `Sharing wasn't saved as chosen for ${BOB} (this folder), ${CAROL} (items inside)`,
  );
  expect(await (await env.pod.fetch(env.doc.source)).text()).toBe(original);
  // The PUT lands, then access can't be read back.
  let wrote = false;
  env.intercept((url, init) => {
    if (init?.method === "PUT") wrote = true;
    else if (wrote && url === env.doc.source) return new Response(null, { status: 500 });
    return undefined;
  });
  await expect(
    applyScopedSharing(env.session, scoped, { folder: scoped.contents, contents: scoped.contents }),
  ).rejects.toBeInstanceOf(SharingRefreshError);
});

it("maps scoped load failures to the dialog's copy", async () => {
  const env = await setup();
  await expect(loadScopedSharing(env.session, `${FOLDER}file.txt`)).rejects.toMatchObject({
    message: "This item's sharing uses access rules that this dialog can't show.",
  });
});

it("fails closed when a scope's raw access is not what its roles show", async () => {
  const env = await setup();
  const scoped = await loadScopedSharing(env.session, FOLDER);
  const capture = {
    resource: FOLDER,
    url: env.doc.source,
    dataset: env.doc.dataset,
  };
  await expect(
    verifyScopedAccess(FOLDER, async () => [capture], scoped.grants.folder, scoped.grants.folder),
  ).rejects.toThrow(UNMAPPED);
  await expect(
    verifyScopedAccess(
      FOLDER,
      async () => {
        throw new Error("unreadable");
      },
      scoped.grants.folder,
      scoped.grants.contents,
    ),
  ).rejects.toThrow(UNMAPPED);
});
