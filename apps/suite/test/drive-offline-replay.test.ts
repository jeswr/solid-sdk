// AUTHORED-BY Claude Opus 5.5
import { StorageError } from "@jeswr/storage-client";
import type { GuardedDelivery } from "@jeswr/suite-sdk/offline";
import { expect, it, vi } from "vitest";
import { isEndpointCapture } from "../src/apps/drive/lib/client/access";
import {
  createSolidDriveClient,
  type DriveClient,
  DriveError,
} from "../src/apps/drive/lib/client/client";
import {
  DRIVE_FOLDER_TAG,
  DRIVE_TEXT_TAG,
  driveGuardPolicy,
  folderGuard,
  textGuard,
} from "../src/apps/drive/lib/offline/guards";
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

it("guard policies cover only what Drive queues, inside this storage", () => {
  const text = driveGuardPolicy(DRIVE_TEXT_TAG, ROOT);
  expect(text({ op: "write", url: FILE })).toBe(true);
  expect(text({ op: "write", url: DRIVE })).toBe(false);
  expect(text({ op: "write", url: `${FILE}.acl` })).toBe(false);
  expect(text({ op: "write", url: `${DRIVE}.meta` })).toBe(false);
  expect(text({ op: "write", url: "https://elsewhere.test/drive/a.txt" })).toBe(false);
  expect(text({ op: "write", url: `${DRIVE}a%2Fb.txt` })).toBe(false);
  expect(text({ op: "write", url: "https://user:pw@wac.test/drive/a.txt" })).toBe(false);
  expect(text({ op: "write", url: `${DRIVE}a.txt?x=1` })).toBe(false);
  expect(text({ op: "write", url: "not a url" })).toBe(false);
  expect(text({ op: "create", url: DRIVE, container: DRIVE })).toBe(true);
  expect(text({ op: "create", url: FILE, container: FILE })).toBe(false);
  expect(text({ op: "delete", url: FILE })).toBe(false);
  const folder = driveGuardPolicy(DRIVE_FOLDER_TAG, `${ROOT}`);
  expect(folder({ op: "create", url: DRIVE, container: DRIVE })).toBe(true);
  expect(folder({ op: "create", url: DRIVE })).toBe(false);
  expect(folder({ op: "write", url: FILE })).toBe(false);
  expect(driveGuardPolicy("other.tag", ROOT)({ op: "write", url: FILE })).toBe(false);
  // A storage root given without its trailing slash still bounds paths.
  expect(
    driveGuardPolicy(DRIVE_TEXT_TAG, "https://wac.test/drive")({ op: "write", url: FILE }),
  ).toBe(true);
  expect(folderGuard).toEqual({ tag: DRIVE_FOLDER_TAG });
});

it("text guards carry the captured discovery as plain JSON", async () => {
  const f = await wacPod();
  const { version } = await opened(f);
  expect(isEndpointCapture(version.discovery)).toBe(true);
  const guard = textGuard(version.discovery as NonNullable<typeof version.discovery>);
  expect(JSON.parse(JSON.stringify(guard))).toEqual(guard);
  expect(guard).toMatchObject({
    tag: DRIVE_TEXT_TAG,
    assertions: { discovery: version.discovery },
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
  const delegate = driveReplayDelegate(DRIVE_TEXT_TAG)(session(f));
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
  const delegate = driveReplayDelegate(DRIVE_TEXT_TAG)(session(f));
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
  const delegate = driveReplayDelegate(DRIVE_TEXT_TAG)(session(f));
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
  const delegate = driveReplayDelegate(DRIVE_TEXT_TAG)(session(f));
  const assertions = textGuard(version.discovery as never).assertions;
  for (const delivery of [
    textDelivery(FILE, undefined, assertions),
    textDelivery(FILE, version.etag, { discovery: { endpoint: 5 } }),
    textDelivery(FILE, version.etag, undefined),
    textDelivery("https://elsewhere.test/a.txt", version.etag, assertions),
    { ...textDelivery(FILE, version.etag, assertions), op: "delete" as const },
  ])
    await expect(delegate(delivery, ctx())).rejects.toMatchObject({ code: "bad-request" });
  expect(await (await f.pod.fetch(FILE)).text()).toBe("public");
});

it("stores a kept copy as a new file through Drive's upload", async () => {
  const f = await wacPod();
  const delegate = driveReplayDelegate(DRIVE_TEXT_TAG)(session(f));
  const result = await delegate(
    {
      op: "create",
      url: PUBLIC,
      container: PUBLIC,
      contentType: "text/plain",
      body: encode("kept"),
      createOptions: { name: "placeholder (copy).txt", contentType: "text/plain" },
      purpose: "resolve-both",
    },
    ctx(),
  );
  expect(result).toMatchObject({ url: `${PUBLIC}placeholder%20(copy).txt`, created: true });
  expect(await (await f.pod.fetch(`${PUBLIC}placeholder%20(copy).txt`)).text()).toBe("kept");
  await expect(
    delegate(
      { op: "create", url: PUBLIC, container: PUBLIC, body: null, purpose: "resolve-both" },
      ctx(),
    ),
  ).rejects.toMatchObject({ code: "bad-request" });
});

it("replays a queued folder as an inherit-verified create", async () => {
  const f = await wacPod();
  const delegate = driveReplayDelegate(DRIVE_FOLDER_TAG)(session(f));
  const result = await delegate(
    {
      op: "create",
      url: PRIVATE,
      container: PRIVATE,
      body: null,
      createOptions: { name: "Plans", kind: "container" },
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
          purpose: "replay",
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: "bad-request" });
});

it("maps Drive failures onto the outbox's classification", async () => {
  const delivery = textDelivery(FILE, '"v1"', {
    discovery: { endpoint: null, wacHeaders: [], mode: "[]" },
  });
  const network = new TypeError("Failed to fetch");
  const existing = new StorageError("forbidden", { url: FILE, method: "PUT", status: 403 });
  const cases: [unknown, Partial<StorageError> | unknown][] = [
    [network, network],
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
    const delegate = driveReplayDelegate(
      DRIVE_TEXT_TAG,
      () => client,
    )({
      fetch,
      storageUrl: ROOT,
      webId: OWNER,
    });
    const error = await delegate(delivery, ctx()).catch((cause: unknown) => cause);
    if (expected === network || expected === existing) expect(error).toBe(expected);
    else expect(error).toMatchObject(expected as object);
  }
});

it("returns the write receipt's ETag when the server sends one, and none otherwise", async () => {
  const delivery = textDelivery(FILE, '"v1"', {
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
    const delegate = driveReplayDelegate(
      DRIVE_TEXT_TAG,
      () => client,
    )({
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
