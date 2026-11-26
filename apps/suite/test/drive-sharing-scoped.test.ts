// AUTHORED-BY Claude Opus 5.5
// Drive's scope-aware sharing (sst-uo4.4) through the SDK role layer against the demo pod.
import { serialize } from "@jeswr/rdf-serialize";
import { expect, it, vi } from "vitest";
import {
  applyScopedSharing,
  isPartialScope,
  loadScopedSharing,
  loadSharing,
  ScopedSharingIncompleteError,
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

/** A rule that applies to the items inside the folder only. */
function inside(doc: ReturnType<typeof document>, webId: string, modes: string[]) {
  const rule = authorization(doc, webId, modes);
  properties(rule).values(`${ACL}accessTo`).clear();
  rule.default = FOLDER;
}

/**
 * A folder Alice owns on both scopes, whose items inside (only) Bob can read, unless `rules`
 * writes other access.
 */
async function setup(
  webId = ALICE,
  rules = (doc: ReturnType<typeof document>) => {
    authorization(doc, ALICE, ["Read", "Write", "Control"]).default = FOLDER;
    inside(doc, BOB, ["Read"]);
  },
) {
  const pod = createDemoPod({ root: ROOT });
  await pod.fetch(FOLDER, { method: "PUT" });
  const doc = document("wac", false, FOLDER);
  rules(doc);
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
  expect(scoped.ownsContents).toBe(true);
  expect(roles(scoped.folder)).toEqual([[[ALICE, "owner"]], "none"]);
  expect(roles(scoped.contents)).toEqual([
    [
      [ALICE, "owner"],
      [BOB, "viewer"],
    ],
    "none",
  ]);
  // Change one scope only: Carol edits the items inside.
  const { snapshot: split, changed } = await applyScopedSharing(env.session, scoped, {
    folder: scoped.folder,
    contents: {
      ...scoped.contents,
      people: [...scoped.contents.people, { webId: CAROL, role: "editor" }],
    },
  });
  expect(changed).toBe(true);
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
  ).toEqual({ snapshot: split, changed: false });
  expect(puts()).toBe(before);
  // Making the items inside match the folder returns it to the ordinary dialog.
  const { snapshot: matched } = await applyScopedSharing(env.session, split, {
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
  const { snapshot: shared } = await applyScopedSharing(env.session, scoped, {
    folder: { ...scoped.folder, link: "viewer", public: "viewer" },
    contents: scoped.contents,
  });
  expect(shared.folder.link).toBe("viewer");
  expect(shared.contents.link).toBe("none");
  const puts = () => env.fetch.mock.calls.filter(([, init]) => init?.method === "PUT").length;
  const before = puts();
  const refused = applyScopedSharing(env.session, shared, {
    folder: shared.folder,
    contents: { ...shared.contents, people: [{ webId: BOB, role: "viewer" }] },
  });
  await expect(refused).rejects.toThrow("You cannot remove your own owner access or Control");
  // Refused before any request: an ordinary error, so the dialog keeps its controls.
  await expect(refused).rejects.not.toBeInstanceOf(SharingRefreshError);
  expect(puts()).toBe(before);
});

it("fails closed when one scope grants access its roles would drop", async () => {
  // Read with Append inside has no role: showing Bob as a viewer would hide the Append.
  const env = await setup(ALICE, (doc) => {
    authorization(doc, ALICE, ["Read", "Write", "Control"]).default = FOLDER;
    authorization(doc, BOB, ["Read"]);
    inside(doc, BOB, ["Read", "Append"]);
  });
  await expect(loadScopedSharing(env.session, FOLDER)).rejects.toThrow(UNMAPPED);
});

it("marks a folder whose items inside its owner doesn't own", async () => {
  const env = await setup(ALICE, (doc) => {
    authorization(doc, ALICE, ["Read", "Write", "Control"]);
    inside(doc, BOB, ["Read", "Write", "Control"]);
  });
  const scoped = await loadScopedSharing(env.session, FOLDER);
  expect(scoped.canManage).toBe(true);
  expect(scoped.ownsContents).toBe(false);
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
  ).rejects.toSatisfy(
    (error) =>
      error instanceof ScopedSharingIncompleteError &&
      error.message.startsWith(
        `Sharing wasn't saved as chosen for ${BOB} (this folder), ${CAROL} (items inside).`,
      ) &&
      roles(error.snapshot.contents).length === 2,
  );
  expect(await (await env.pod.fetch(env.doc.source)).text()).toBe(original);
  // The PUT lands, then access can't be read back.
  let wrote = false;
  env.intercept((url, init) => {
    if (init?.method === "PUT") wrote = true;
    else if (wrote && url === env.doc.source) return new Response(null, { status: 500 });
    return undefined;
  });
  const unconfirmed = applyScopedSharing(env.session, scoped, {
    folder: scoped.contents,
    contents: scoped.contents,
  });
  await expect(unconfirmed).rejects.toBeInstanceOf(SharingRefreshError);
  await expect(unconfirmed).rejects.toMatchObject({ committed: true });
});

it("treats a failed write as an unknown outcome, never as nothing saved", async () => {
  const env = await setup();
  const scoped = await loadScopedSharing(env.session, FOLDER);
  env.intercept((url, init) =>
    url === env.doc.source && init?.method === "PUT"
      ? new Response(null, { status: 500 })
      : undefined,
  );
  const failed = applyScopedSharing(env.session, scoped, {
    folder: scoped.contents,
    contents: scoped.contents,
  });
  await expect(failed).rejects.toBeInstanceOf(SharingRefreshError);
  await expect(failed).rejects.toMatchObject({ committed: false });
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
