// AUTHORED-BY Claude Opus 5.5
// End-to-end privacy: the REAL checkOwnerOnly (no module mocks) against a faithful fake
// Solid server. Memory storage holds real WAC documents; the fake adds the server's Link
// headers (rel=acl on every resource, rel=type pim:Storage on the true storage root only)
// and hides ACL documents from container listings, as Solid servers do.
import type { LinkTarget, StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, it, vi } from "vitest";
import { createTripsStore, verifiedOwnerOnly } from "../src/index.js";

const POD = "https://pod.example/";
const OWNER = "https://id.example/alice#me";
const OTHER = "https://id.example/bob#me";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const aclOf = (url: string) => `${url}.acl`;
const authorization = (target: string, agent: string, folder: boolean) =>
  `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
[] a acl:Authorization; acl:agent <${agent}>; acl:accessTo <${target}>;${
    folder ? ` acl:default <${target}>;` : ""
  } acl:mode acl:Read, acl:Write, acl:Control.`;

async function fakeSolidServer(root = POD) {
  const memory = createMemoryStorage({ protocol: "solid", root: POD });
  // The storage root's own ACL: owner-only, inherited by every descendant.
  await memory.create(POD, authorization(POD, OWNER, true), {
    name: ".acl",
    contentType: "text/turtle",
  });
  if (root !== POD) await memory.create(POD, null, { name: "alice", kind: "container" });
  const isAcl = (url: string) => url.endsWith(".acl");
  const storage: StorageClient = {
    ...memory,
    root,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
    },
    async head(url, options) {
      const head = await memory.head(url, options);
      if (isAcl(url)) return head;
      const links = new Map<string, readonly LinkTarget[]>(head.links);
      links.set("acl", [{ target: aclOf(url), params: {} }]);
      if (url === POD) links.set("type", [{ target: PIM_STORAGE, params: {} }]);
      else links.delete("type");
      return { ...head, links };
    },
    async list(url, options) {
      const page = await memory.list(url, options);
      return { ...page, items: page.items.filter((item) => !isAcl(item.url)) };
    },
  };
  return { storage, memory };
}
/** Stand-in for setGrants (covered by pod-access): writes or skips the resource's own ACL. */
function establishWith(memory: StorageClient, agent: string | null, written: string[]) {
  return async (url: string, folder: boolean) => {
    if (!agent) return true; // Already a manager by inheritance: no write needed.
    const parent = folder ? url : url.slice(0, url.lastIndexOf("/") + 1);
    const name = aclOf(url).slice(parent.length);
    await memory.create(parent, authorization(url, agent, folder), {
      name,
      contentType: "text/turtle",
    });
    written.push(aclOf(url));
    return true;
  };
}
function tripsStore(
  storage: StorageClient,
  establish: (u: string, f: boolean) => Promise<boolean>,
) {
  const register = vi.fn(async () => undefined);
  const store = createTripsStore({
    storage,
    index: { register, findAll: vi.fn(async () => new Map()) },
    protect: verifiedOwnerOnly(storage, OWNER, establish),
  });
  return { store, register };
}

it("verifies inherited and own owner-only ACLs, then saves a private trip and booking", async () => {
  const inherited = await fakeSolidServer();
  const one = tripsStore(inherited.storage, establishWith(inherited.memory, null, []));
  await one.store.initialise();
  expect(one.register).toHaveBeenCalledOnce();

  const own = await fakeSolidServer();
  const written: string[] = [];
  const two = tripsStore(own.storage, establishWith(own.memory, OWNER, written));
  await two.store.initialise();
  const booking = await two.store.addReservation({ kind: "TrainReservation", title: "Train" });
  const trip = await two.store.saveTrip({
    id: "pending:new",
    name: "Example",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    reservations: [booking.id],
  });
  expect(written).toEqual([
    `${POD}trips/.acl`,
    `${POD}trips/reservations/.acl`,
    aclOf(booking.id.split("#")[0] as string),
    aclOf(trip.id.split("#")[0] as string),
  ]);
  const loaded = await two.store.load();
  expect(loaded.trips.map((t) => t.name)).toEqual(["Example"]);
  expect(loaded.reservations).toEqual([
    expect.objectContaining({ id: booking.id, origin: "manual" }),
  ]);
  expect(loaded.notice).toEqual({ skipped: 0, capped: false });
});

it("refuses a non-owner ACL before registering or writing private data", async () => {
  const { storage, memory } = await fakeSolidServer();
  const { store, register } = tripsStore(storage, establishWith(memory, OTHER, []));
  const write = vi.spyOn(storage, "write");
  await expect(store.initialise()).rejects.toThrow("verify owner-only");
  expect(register).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});

it("refuses a caller-supplied sub-root that the server does not type as pim:Storage", async () => {
  const { storage, memory } = await fakeSolidServer(`${POD}alice/`);
  const { store, register } = tripsStore(storage, establishWith(memory, null, []));
  const { checkOwnerOnly } = await import("@jeswr/pod-access");
  // The inheritance walk reaches the supplied root, which lacks rel=type pim:Storage.
  await memory.create(`${POD}alice/`, null, { name: "trips", kind: "container" });
  expect(await checkOwnerOnly({ storage, url: `${POD}alice/trips/`, ownerWebId: OWNER })).toEqual({
    private: false,
    reasons: [{ subject: "unknown", modes: [], reason: "not-storage-root" }],
  });
  await expect(store.initialise()).rejects.toThrow("verify owner-only");
  expect(register).not.toHaveBeenCalled();
});
