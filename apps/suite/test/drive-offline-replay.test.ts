// AUTHORED-BY Claude Opus 5.5
import { StorageError } from "@jeswr/storage-client";
import type { GuardedDelivery } from "@jeswr/suite-sdk/offline";
import { expect, it, vi } from "vitest";
import { DriveAccessError, isEndpointCapture } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
} from "../src/apps/drive/lib/client/client";
import {
  DRIVE_TAG,
  driveGuardPolicy,
  folderGuard,
  textGuard,
} from "../src/apps/drive/lib/offline/guards";
import { isNetworkFailure } from "../src/apps/drive/lib/offline/network";
import { driveReplayDelegate } from "../src/apps/drive/lib/offline/replay";
import { DRIVE, OWNER, PRIVATE, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

const FILE = `${PUBLIC}placeholder`;
const encode = (text: string) => new TextEncoder().encode(text);
const ctx = () => ({ storage: {} as never, signal: new AbortController().signal });

async function opened(f: Awaited<ReturnType<typeof wacPod>>, url = FILE) {
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  const version = await client.readVersion(url);
  return { client, version };
}
function textDelivery(
  url: string,
  ifMatch: string | undefined,
  assertions: GuardedDelivery["assertions"],
  body = "edited offline",
): GuardedDelivery {
  return {
    op: "write",
    url,
    contentType: "text/plain",
    body: encode(body),
    ...(ifMatch ? { ifMatch } : {}),
    ...(assertions === undefined ? {} : { assertions }),
    purpose: "replay",
  };
}
const session = (f: Awaited<ReturnType<typeof wacPod>>) => ({
  fetch: f.fetch,
  storageUrl: ROOT,
  webId: OWNER,
});

it("the guard policy claims every change inside Drive's root and nothing outside it", () => {
  const policy = driveGuardPolicy(DRIVE);
  expect(policy({ op: "write", url: FILE })).toBe(true);
  expect(policy({ op: "write", url: `${FILE}.acl` })).toBe(true);
  expect(policy({ op: "delete", url: FILE })).toBe(true);
  expect(policy({ op: "create", url: DRIVE, container: DRIVE })).toBe(true);
  expect(policy({ op: "create", url: `${ROOT}notes/`, container: `${ROOT}notes/` })).toBe(false);
  expect(policy({ op: "write", url: `${ROOT}notes/a.txt` })).toBe(false);
  expect(policy({ op: "write", url: "https://elsewhere.test/drive/a.txt" })).toBe(false);
  expect(policy({ op: "write", url: `${DRIVE}a%2Fb.txt` })).toBe(false);
  expect(policy({ op: "write", url: "https://user:pw@wac.test/drive/a.txt" })).toBe(false);
  expect(policy({ op: "write", url: `${DRIVE}a.txt?x=1` })).toBe(false);
  expect(policy({ op: "write", url: "not a url" })).toBe(false);
  // A root given without its trailing slash still bounds paths.
  expect(driveGuardPolicy("https://wac.test/drive")({ op: "write", url: FILE })).toBe(true);
  expect(driveGuardPolicy("https://wac.test/drive")({ op: "write", url: `${ROOT}drivex/a` })).toBe(
    false,
  );
  expect(folderGuard).toEqual({ tag: DRIVE_TAG, assertions: { kind: "folder" } });
});

it("counts only fetch failures as network failures, through Drive's wrapping", () => {
  for (const message of [
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ]) {
    expect(isNetworkFailure(new TypeError(message))).toBe(true);
    expect(isNetworkFailure(new DriveAccessError(new TypeError(message)))).toBe(true);
  }
  expect(isNetworkFailure(new StorageError("network", { url: FILE, method: "PUT" }))).toBe(true);
  expect(isNetworkFailure(new TypeError("The private Type Index needs a strong ETag."))).toBe(
    false,
  );
  expect(isNetworkFailure(new DriveAccessError(new Error("denied")))).toBe(false);
  expect(isNetworkFailure(undefined)).toBe(false);
  const loop: { cause?: unknown } = {};
  loop.cause = loop;
  expect(isNetworkFailure(loop)).toBe(false);
});

it("text guards carry the captured discovery as plain JSON", async () => {
  const f = await wacPod();
  const { version } = await opened(f);
  expect(isEndpointCapture(version.discovery)).toBe(true);
  const guard = textGuard(version.discovery as NonNullable<typeof version.discovery>);
  expect(JSON.parse(JSON.stringify(guard))).toEqual(guard);
  expect(guard).toMatchObject({
    tag: DRIVE_TAG,
    assertions: { kind: "text", discovery: version.discovery },
  });
  for (const bad of [
    null,
    [],
    "x",
    { endpoint: 1, wacHeaders: [], mode: "" },
    { endpoint: null, wacHeaders: "wac-allow", mode: "" },
    { endpoint: null, wacHeaders: ["link"], mode: "" },
    { endpoint: null, wacHeaders: [1], mode: "" },
    { endpoint: null, wacHeaders: [], mode: 1 },
    { endpoint: null, wacHeaders: [], mode: "", extra: true },
  ])
    expect(isEndpointCapture(bad)).toBe(false);
});

it("replays a queued text save through Drive's guarded write", async () => {
  const f = await wacPod();
  const { version } = await opened(f);
  const delegate = driveReplayDelegate()(session(f));
  const result = await delegate(
    textDelivery(FILE, version.etag, textGuard(version.discovery as never).assertions),
    ctx(),
  );
  expect(result).toMatchObject({ url: FILE, created: false });
  expect(await (await f.pod.fetch(FILE)).text()).toBe("edited offline");
});

it("turns a changed file into an outbox conflict", async () => {
  const f = await wacPod();
  const { version } = await opened(f);
  await f.pod.fetch(FILE, {
    method: "PUT",
    body: "someone else",
    headers: { "content-type": "text/plain" },
  });
  const delegate = driveReplayDelegate()(session(f));
  const error = await delegate(
    textDelivery(FILE, version.etag, textGuard(version.discovery as never).assertions),
    ctx(),
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect(error).toMatchObject({ code: "precondition-failed", status: 412 });
  expect(await (await f.pod.fetch(FILE)).text()).toBe("someone else");
});

it("refuses a replay whose access discovery changed since the file was opened", async () => {
  const f = await wacPod();
  const { version } = await opened(f);
  f.endpoints.set(FILE, `${FILE}.moved-policy`);
  const delegate = driveReplayDelegate()(session(f));
  const error = await delegate(
    textDelivery(FILE, version.etag, textGuard(version.discovery as never).assertions),
    ctx(),
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(StorageError);
  expect((error as StorageError).code).not.toBe("network");
  expect(await (await f.pod.fetch(FILE)).text()).toBe("public");
});

it("fails closed on tampered or incomplete queued saves", async () => {
  const f = await wacPod();
  const { version } = await opened(f);
  const delegate = driveReplayDelegate()(session(f));
  const assertions = textGuard(version.discovery as never).assertions;
  for (const delivery of [
    textDelivery(FILE, undefined, assertions),
    textDelivery(FILE, version.etag, { kind: "text", discovery: { endpoint: 5 } }),
    textDelivery(FILE, version.etag, undefined),
    textDelivery(FILE, version.etag, ["text"]),
    textDelivery(FILE, version.etag, { kind: "folder" }),
    textDelivery("https://elsewhere.test/a.txt", version.etag, assertions),
    textDelivery(`${FILE}.acl`, version.etag, assertions),
    textDelivery(PUBLIC, version.etag, assertions),
    { ...textDelivery(FILE, version.etag, assertions), purpose: "resolve-both" as const },
    { ...textDelivery(FILE, version.etag, assertions), op: "delete" as const },
    // Text creates exist only as a conflict's "keep both" copy.
    {
      op: "create" as const,
      url: PUBLIC,
      container: PUBLIC,
      body: encode("x"),
      createOptions: { name: "x.txt" },
      assertions: assertions ?? null,
      purpose: "replay" as const,
    },
  ])
    await expect(delegate(delivery, ctx())).rejects.toMatchObject({ code: "bad-request" });
  expect(await (await f.pod.fetch(FILE)).text()).toBe("public");
});

it("stores a kept copy as a new file through Drive's upload", async () => {
  const f = await wacPod();
  const delegate = driveReplayDelegate()(session(f));
  const result = await delegate(
    {
      op: "create",
      url: PUBLIC,
      container: PUBLIC,
      contentType: "text/plain",
      body: encode("kept"),
      createOptions: { name: "placeholder (copy).txt", contentType: "text/plain" },
      assertions: { kind: "text" },
      purpose: "resolve-both",
    },
    ctx(),
  );
  expect(result).toMatchObject({ url: `${PUBLIC}placeholder%20(copy).txt`, created: true });
  expect(await (await f.pod.fetch(`${PUBLIC}placeholder%20(copy).txt`)).text()).toBe("kept");
  await expect(
    delegate(
      {
        op: "create",
        url: PUBLIC,
        container: PUBLIC,
        body: null,
        assertions: { kind: "text" },
        purpose: "resolve-both",
      },
      ctx(),
    ),
  ).rejects.toMatchObject({ code: "bad-request" });
});

it("replays a queued folder as an inherit-verified create", async () => {
  const f = await wacPod();
  const delegate = driveReplayDelegate()(session(f));
  const result = await delegate(
    {
      op: "create",
      url: PRIVATE,
      container: PRIVATE,
      body: null,
      createOptions: { name: "Plans", kind: "container" },
      assertions: { kind: "folder" },
      purpose: "replay",
    },
    ctx(),
  );
  expect(result).toEqual({ url: `${PRIVATE}Plans/`, etag: null, created: true });
  expect((await f.pod.fetch(`${PRIVATE}Plans/`, { method: "HEAD" })).ok).toBe(true);
  // Inherits the private folder's policy: anonymous readers still see nothing.
  expect((await f.anonymous(`${PRIVATE}Plans/`)).status).toBe(403);
  for (const createOptions of [{ kind: "container" as const }, { name: "Plans" }])
    await expect(
      delegate(
        {
          op: "create",
          url: PRIVATE,
          container: PRIVATE,
          body: null,
          createOptions,
          assertions: { kind: "folder" },
          purpose: "replay",
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
  // A folder conflict has no "mine": a write or a resolve delivery is not a folder change.
  for (const purpose of ["resolve-mine", "resolve-both"] as const)
    await expect(
      delegate(
        {
          op: "create",
          url: PRIVATE,
          container: PRIVATE,
          body: null,
          createOptions: { name: "Other", kind: "container" },
          assertions: { kind: "folder" },
          purpose,
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
});

it("treats a queued folder that now exists as done, and still refuses a clash it can't confirm", async () => {
  const f = await wacPod();
  const delegate = driveReplayDelegate()(session(f));
  const delivery: GuardedDelivery = {
    op: "create",
    url: PRIVATE,
    container: PRIVATE,
    body: null,
    createOptions: { name: "Plans", kind: "container" },
    assertions: { kind: "folder" },
    purpose: "replay",
  };
  expect(await delegate(delivery, ctx())).toMatchObject({ created: true });
  expect(await delegate(delivery, ctx())).toEqual({
    url: `${PRIVATE}Plans/`,
    etag: null,
    created: false,
  });
  const client = {
    createFolder: vi.fn(async () => {
      throw new DriveError("conflict", 412, `${PRIVATE}Gone/`);
    }),
  } as unknown as DriveClient;
  const head = vi.fn(async () => new Response(null, { status: 404 }));
  const clashing = driveReplayDelegate(() => client)({
    fetch: head as unknown as typeof fetch,
    storageUrl: ROOT,
    webId: OWNER,
  });
  await expect(
    clashing({ ...delivery, createOptions: { name: "Gone", kind: "container" } }, ctx()),
  ).rejects.toMatchObject({ code: "precondition-failed" });
  expect(head).toHaveBeenCalledWith(`${PRIVATE}Gone/`, expect.objectContaining({ method: "HEAD" }));
});

it("maps Drive failures onto the outbox's classification", async () => {
  const delivery = textDelivery(FILE, '"v1"', {
    kind: "text",
    discovery: { endpoint: null, wacHeaders: [], mode: "[]" },
  });
  const existing = new StorageError("forbidden", { url: FILE, method: "PUT", status: 403 });
  const cases: [unknown, Partial<StorageError> | unknown][] = [
    // Network failures stay queued whatever the browser calls them, and however Drive wraps them.
    [new TypeError("Load failed"), { code: "network" }],
    [new DriveAccessError(new TypeError("Failed to fetch")), { code: "network" }],
    [existing, existing],
    [new DriveError("forbidden", 403, FILE), { code: "forbidden", status: 403 }],
    [new DriveError("conflict", 409, FILE), { code: "conflict", status: 409 }],
    [new DriveError("unknown" as never, 503, FILE), { code: "server", status: 503 }],
    [new DriveError("unknown" as never, 418, FILE), { code: "bad-request", status: 418 }],
    [new Error("boom"), { code: "bad-request", status: null, message: "boom" }],
    ["odd", { code: "bad-request", message: "Drive refused the queued change" }],
  ];
  for (const [thrown, expected] of cases) {
    const client = {
      discoveryVerifier: () => () => undefined,
      write: vi.fn(async () => {
        throw thrown;
      }),
    } as unknown as DriveClient;
    const delegate = driveReplayDelegate(() => client)({
      fetch,
      storageUrl: ROOT,
      webId: OWNER,
    });
    const error = await delegate(delivery, ctx()).catch((cause: unknown) => cause);
    if (expected === existing) expect(error).toBe(expected);
    else expect(error).toMatchObject(expected as object);
  }
  // A delivery cut off by the session ending stays queued, whatever Drive made of it.
  const controller = new AbortController();
  controller.abort();
  const client = {
    discoveryVerifier: () => () => undefined,
    write: vi.fn(async () => {
      throw new Error("The outbox account is no longer active");
    }),
  } as unknown as DriveClient;
  await expect(
    driveReplayDelegate(() => client)({ fetch, storageUrl: ROOT, webId: OWNER })(delivery, {
      storage: {} as never,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: "network" });
});

it("returns the write receipt's ETag when the server sends one, and none otherwise", async () => {
  const delivery = textDelivery(FILE, '"v1"', {
    kind: "text",
    discovery: { endpoint: null, wacHeaders: [], mode: "[]" },
  });
  for (const [etag, expected] of [
    ['"v2"', '"v2"'],
    [undefined, null],
  ] as const) {
    const client = {
      discoveryVerifier: () => () => undefined,
      write: vi.fn(async () => (etag ? { etag } : {})),
    } as unknown as DriveClient;
    const delegate = driveReplayDelegate(() => client)({
      fetch,
      storageUrl: ROOT,
      webId: OWNER,
    });
    expect(
      await delegate({ ...delivery, contentType: undefined, body: null } as never, ctx()),
    ).toEqual({
      url: FILE,
      etag: expected,
      created: false,
    });
    expect(client.write).toHaveBeenCalledWith(
      FILE,
      expect.any(Blob),
      expect.objectContaining({ contentType: "application/octet-stream", ifMatch: '"v1"' }),
      { kind: "protect-ancestors" },
    );
  }
});
