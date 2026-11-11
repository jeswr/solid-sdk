// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { protectionLedger } from "../src/apps/drive/lib/client/protection-ledger";
import { DRIVE_ROOT_CLASS } from "../src/apps/drive/lib/constants";
import { DriveProvider, useFolder } from "../src/apps/drive/state/drive-context";
import type { PodSession } from "../src/lib/session/types";
import { act, h, mount } from "./drive-ui-dom";
import { aclBody, OWNER, PUBLIC, ROOT, wacPod } from "./drive-wac-pod";

vi.mock("../src/apps/docs/lib/model/type-index", () => ({
  discoverProfileRegistrations: async () => [{ forClass: DRIVE_ROOT_CLASS, container: PUBLIC }],
}));

it.each([
  undefined,
  true,
  false,
])("automatic listing with provision=%s only repairs protection when provisioning is enabled", async (provision) => {
  const f = await wacPod();
  const ledger = protectionLedger(f.fetch);
  const etag = (await f.fetch(PUBLIC, { method: "HEAD" })).headers.get("etag") as string;
  const required = {
    acl: `${PUBLIC}.policy`,
    from: PUBLIC,
    turtle: await aclBody(PUBLIC),
    etag,
    ownAcl: { url: `${PUBLIC}.policy`, etag: null },
  };
  await ledger.set(PUBLIC, required);
  f.calls.length = 0;
  const session: PodSession = {
    mode: "solid",
    webId: OWNER,
    displayName: "Alice",
    storageUrl: ROOT,
    fetch: f.fetch,
    publicFetch: f.fetch,
    subscribe: () => () => {},
  };
  let listing!: ReturnType<typeof useFolder>;
  function Probe() {
    listing = useFolder(PUBLIC);
    return null;
  }
  await mount(
    h(DriveProvider, {
      session,
      ...(provision === undefined ? {} : { provision }),
      children: h(Probe),
    }),
  );
  if (provision === false) {
    expect(listing.status).toBe("error");
    if (listing.status !== "error") throw new Error("Expected a repair error");
    expect(listing.error).toMatchObject({
      message: expect.stringContaining("needs a protection repair"),
    });
    expect(await ledger.get(PUBLIC)).toEqual(required);
    await act(() => listing.reload());
    expect(listing.status).toBe("error");
    expect(f.calls.every(({ method }) => ["GET", "HEAD", "OPTIONS"].includes(method))).toBe(true);
    expect(f.policies.has(`${PUBLIC}.policy`)).toBe(false);

    // An explicit retry in the regular Drive client may repair the same receipt.
    await createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch }).list(PUBLIC);
    await act(() => listing.reload());
  }
  expect(listing.status).toBe("ready");
  if (listing.status !== "ready") throw new Error("Expected a verified listing");
  expect(listing.items.some((item) => item.url === `${PUBLIC}placeholder`)).toBe(true);
  expect(f.calls).toContainEqual({ url: `${PUBLIC}.policy`, method: "PUT" });
  expect(await ledger.get(PUBLIC)).toBeUndefined();
});
