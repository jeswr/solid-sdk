// AUTHORED-BY Codex
import { expect, it } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash, restoreItems, trashItems } from "../src/apps/drive/lib/operations/operations";
import { rdfPod } from "./drive-rdf-pod";
import { aclBody, DRIVE, OWNER, PRIVATE, ROOT } from "./drive-wac-pod";

it.each(
  ["file", "folder"].flatMap((kind) =>
    ["own", "inherited"].flatMap((sharing) =>
      [403, 412].map((status) => ({ kind, sharing, status })),
    ),
  ),
)("round 70: partial Restore compares archived $sharing sharing for a $kind after Trash DELETE $status", async ({
  kind,
  sharing,
  status,
}) => {
  const f = await rdfPod();
  const source = `${PRIVATE}shared${kind === "folder" ? "/" : ""}`;
  const content = kind === "folder" ? `${source}child` : source;
  await f.pod.fetch(content, { method: "PUT", body: "shared contents" });
  const governed = sharing === "own" ? source : PRIVATE;
  const policy = await aclBody(governed, true);
  f.policies.set(`${governed}.policy`, policy);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, webId: OWNER });
  f.intercept(async (url, init) =>
    url === content && init?.method === "DELETE" ? new Response(null, { status }) : undefined,
  );
  const trashed = await trashItems(client, DRIVE, [await client.stat(source)], { webId: OWNER });
  expect(trashed.failed).toHaveLength(1);
  f.intercept(undefined);
  const entries = await listTrash(client, DRIVE);
  expect(entries).toHaveLength(1);
  const entry = entries[0];
  if (!entry) throw new Error("Missing recovery entry");
  expect(entry.status).toBe("partial");
  expect((await f.anonymous(entry.url)).status).toBe(403);
  expect(await (await f.anonymous(content)).text()).toBe("shared contents");
  const restored = await restoreItems(client, DRIVE, entries);
  expect(restored.failed).toEqual([]);
  expect(restored.done).toHaveLength(1);
  expect(f.pod.has(entry.url)).toBe(false);
  expect(await listTrash(client, DRIVE)).toEqual([]);
  expect(f.policies.get(`${governed}.policy`)).toBe(policy);
  expect(await (await f.anonymous(content)).text()).toBe("shared contents");
});
