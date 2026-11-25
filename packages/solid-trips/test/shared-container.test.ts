// AUTHORED-BY Claude Sonnet 5.5
// Security review finding C1/C15: Trips seals only containers it created, never rewrites the
// access of a pre-existing folder (a shared one is refused for private writes, not narrowed),
// and a failed Type Index registration never stops the store from opening. The real
// checkOwnerOnly runs against a faithful fake Solid server (no module mocks).
import type { TypeIndex } from "@jeswr/pod-type-index";
import type { LinkTarget, StorageClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { describe, expect, it, vi } from "vitest";
import {
  createTripsStore,
  TripsPrivacyError,
  TypeIndexSetupError,
  verifiedOwnerOnly,
} from "../src/index.js";

const POD = "https://pod.example/";
const OWNER = "https://id.example/alice#me";
const BOB = "https://id.example/bob#me";
const PIM_STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const aclOf = (url: string) => `${url}.acl`;
const rule = (target: string, agent: string, modes: string, folder: boolean) =>
  `[] a acl:Authorization; acl:agent <${agent}>; acl:accessTo <${target}>;${
    folder ? ` acl:default <${target}>;` : ""
  } acl:mode ${modes}.`;
const ownerOnly = (target: string, folder = true) =>
  `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n${rule(target, OWNER, "acl:Read, acl:Write, acl:Control", folder)}`;
const sharedWithBob = (target: string) =>
  `${ownerOnly(target)}\n${rule(target, BOB, "acl:Read", true)}`;

async function server(protocol: "solid" | "lws") {
  const memory = createMemoryStorage({ protocol, root: POD });
  if (protocol === "solid")
    await memory.create(POD, ownerOnly(POD), { name: ".acl", contentType: "text/turtle" });
  const isAcl = (url: string) => url.endsWith(".acl");
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl:
        protocol === "solid"
          ? { state: "available", detail: { model: "wac" }, evidence: "fixture" }
          : memory.features.accessControl,
    },
    async head(url, options) {
      const head = await memory.head(url, options);
      if (isAcl(url) || protocol !== "solid") return head;
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
  const aclWrites: string[] = [];
  for (const method of ["create", "write", "writeRdf", "delete"] as const) {
    const original = memory[method].bind(memory) as (...args: unknown[]) => Promise<unknown>;
    (memory as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      const [first, , options] = args as [string, unknown, { name?: string }?];
      const target = method === "create" ? new URL(options?.name ?? "", first).href : first;
      if (isAcl(target)) aclWrites.push(`${method} ${target}`);
      return original(...args);
    };
  }
  return { memory, storage, aclWrites };
}
/** Stand-in for the role writer (covered by pod-access): records and performs the seal. */
function sealer(memory: StorageClient, sealed: string[]) {
  return async (url: string, folder: boolean) => {
    const parent = folder ? url : url.slice(0, url.lastIndexOf("/") + 1);
    await memory.create(parent, ownerOnly(url, folder), {
      name: aclOf(url).slice(parent.length),
      contentType: "text/turtle",
    });
    sealed.push(url);
    return true;
  };
}
function open(
  storage: StorageClient,
  establish: (url: string, folder: boolean) => Promise<boolean>,
) {
  const register = vi.fn<TypeIndex["register"]>(async () => undefined);
  const store = createTripsStore({
    storage,
    index: { register, findAll: vi.fn(async () => new Map()) },
    protect: verifiedOwnerOnly(storage, OWNER, establish),
  });
  return { store, register };
}
const aclBody = async (memory: StorageClient, url: string) =>
  (await memory.read(aclOf(url))).text();
async function rewriteAcl(memory: StorageClient, url: string, body: string) {
  const acl = aclOf(url);
  await memory.write(acl, body, {
    contentType: "text/turtle",
    ifMatch: (await memory.head(acl)).etag ?? "*",
  });
}
const newTrip = {
  id: "pending:new",
  name: "Example",
  startDate: "2026-12-01",
  endDate: "2026-12-02",
  reservations: [],
};

describe("solid pod", () => {
  it("leaves a pre-existing owner-only folder's ACL bytes untouched and still works", async () => {
    const { memory, storage, aclWrites } = await server("solid");
    await memory.create(POD, null, { name: "trips", kind: "container" });
    await memory.create(`${POD}trips/`, ownerOnly(`${POD}trips/`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    const before = await aclBody(memory, `${POD}trips/`);
    aclWrites.length = 0;
    const sealed: string[] = [];
    const { store, register } = open(storage, sealer(memory, sealed));
    await store.initialise();
    // Only the folder Trips created (reservations/) is sealed; trips/ is never written.
    expect(sealed).toEqual([`${POD}trips/reservations/`]);
    expect(aclWrites).toEqual([`create ${POD}trips/reservations/.acl`]);
    expect(await aclBody(memory, `${POD}trips/`)).toBe(before);
    expect(store.sharedFolders).toEqual([]);
    expect(store.registration).toEqual({ status: "registered" });
    expect(register).toHaveBeenCalledOnce();
    const booking = await store.addReservation({ kind: "TrainReservation", title: "Train" });
    const trip = await store.saveTrip({ ...newTrip, reservations: [booking.id] });
    expect((await store.load()).trips.map((t) => t.id)).toEqual([trip.id]);
    // Reopening a fully private pre-existing tree writes no access document at all.
    aclWrites.length = 0;
    sealed.length = 0;
    const again = open(storage, sealer(memory, sealed));
    await again.store.initialise();
    expect(sealed).toEqual([]);
    expect(aclWrites).toEqual([]);
  });

  it("seals exactly the containers it created, then verifies them", async () => {
    const { memory, storage } = await server("solid");
    const sealed: string[] = [];
    const { store } = open(storage, sealer(memory, sealed));
    await store.initialise();
    expect(sealed).toEqual([`${POD}trips/`, `${POD}trips/reservations/`]);
    expect(store.sharedFolders).toEqual([]);
    expect(store.registration).toEqual({ status: "registered" });
  });

  it("refuses a created folder it cannot establish, removing it again", async () => {
    const { storage } = await server("solid");
    const { store, register } = open(storage, async () => false);
    await expect(store.initialise()).rejects.toMatchObject({
      name: "TripsPrivacyError",
      reason: "unestablished",
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("refuses a created folder that verifies as not private", async () => {
    const { memory, storage } = await server("solid");
    // The role writer claims success, but the effective access is shared.
    const establish = async (url: string, folder: boolean) => {
      const parent = folder ? url : url.slice(0, url.lastIndexOf("/") + 1);
      await memory.create(parent, sharedWithBob(url), {
        name: aclOf(url).slice(parent.length),
        contentType: "text/turtle",
      });
      return true;
    };
    const { store } = open(storage, establish);
    await expect(store.initialise()).rejects.toMatchObject({ reason: "unverified" });
  });

  it("does not rewrite a pre-existing shared folder; private writes are refused with a typed error", async () => {
    const { memory, storage, aclWrites } = await server("solid");
    await memory.create(POD, null, { name: "trips", kind: "container" });
    await memory.create(`${POD}trips/`, sharedWithBob(`${POD}trips/`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    await memory.create(`${POD}trips/`, "", { name: "kept.ttl", contentType: "text/turtle" });
    const before = await aclBody(memory, `${POD}trips/`);
    aclWrites.length = 0;
    const establish = vi.fn(async () => true);
    const { store, register } = open(storage, establish);
    await store.initialise();
    // Never widened, never silently narrowed: no ACL read-modify-write, no establish call at all.
    expect(establish).not.toHaveBeenCalled();
    expect(aclWrites).toEqual([]);
    expect(await aclBody(memory, `${POD}trips/`)).toBe(before);
    expect(store.sharedFolders).toEqual([`${POD}trips/`]);
    // No new folder is added inside a folder the user shares.
    await expect(memory.head(`${POD}trips/reservations/`)).rejects.toMatchObject({
      code: "not-found",
    });
    // Discovery metadata is skipped, not failed.
    expect(store.registration).toMatchObject({ status: "skipped" });
    expect(register).not.toHaveBeenCalled();
    // Reading still works.
    expect((await store.load()).trips).toEqual([]);
    // Private writes refuse with a typed, user-explainable error and write nothing.
    const create = vi.spyOn(storage, "create");
    const write = vi.spyOn(storage, "write");
    const failure = await store.saveTrip(newTrip).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TripsPrivacyError);
    expect(failure).toMatchObject({ reason: "shared" });
    expect((failure as Error).message).toContain("has not changed its sharing");
    await expect(store.addReservation({ kind: "FlightReservation" })).rejects.toBeInstanceOf(
      TripsPrivacyError,
    );
    expect(create).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(aclWrites).toEqual([]);
  });

  it("adopts an existing reservations/ folder inside a shared trips/ folder, verifying it only", async () => {
    const { memory, storage, aclWrites } = await server("solid");
    await memory.create(POD, null, { name: "trips", kind: "container" });
    await memory.create(`${POD}trips/`, sharedWithBob(`${POD}trips/`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    await memory.create(`${POD}trips/`, null, { name: "reservations", kind: "container" });
    await memory.create(`${POD}trips/reservations/`, ownerOnly(`${POD}trips/reservations/`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    aclWrites.length = 0;
    const sealed: string[] = [];
    const { store } = open(storage, sealer(memory, sealed));
    await store.initialise();
    expect(store.sharedFolders).toEqual([`${POD}trips/`]);
    // Manual bookings in the owner-only folder are still writable; trips themselves are not.
    const booking = await store.addReservation({ kind: "TrainReservation" });
    expect(sealed).toEqual([booking.id.split("#")[0]]);
    await expect(store.saveTrip(newTrip)).rejects.toBeInstanceOf(TripsPrivacyError);
    // Only the new booking document got an access document; neither folder was rewritten.
    expect(aclWrites).toEqual([`create ${booking.id.split("#")[0]}.acl`]);
  });

  it("re-verifies before every private write: a folder shared after opening is refused", async () => {
    const { memory, storage } = await server("solid");
    const sealed: string[] = [];
    const { store } = open(storage, sealer(memory, sealed));
    await store.initialise();
    await store.saveTrip(newTrip);
    // The user later shares the folder; Trips must neither follow it nor reset it.
    await rewriteAcl(memory, `${POD}trips/`, sharedWithBob(`${POD}trips/`));
    const before = await aclBody(memory, `${POD}trips/`);
    await expect(store.saveTrip(newTrip)).rejects.toMatchObject({ reason: "shared" });
    expect(await aclBody(memory, `${POD}trips/`)).toBe(before);
  });

  it("retries registration after the folder is made private by the user", async () => {
    const { memory, storage } = await server("solid");
    await memory.create(POD, null, { name: "trips", kind: "container" });
    await memory.create(`${POD}trips/`, sharedWithBob(`${POD}trips/`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    const { store, register } = open(storage, sealer(memory, []));
    await store.initialise();
    expect(store.registration.status).toBe("skipped");
    expect((await store.retryRegistration()).status).toBe("skipped");
    expect(register).not.toHaveBeenCalled();
    await rewriteAcl(memory, `${POD}trips/`, ownerOnly(`${POD}trips/`));
    expect(await store.retryRegistration()).toEqual({ status: "registered" });
    expect(store.sharedFolders).toEqual([]);
    expect(register).toHaveBeenCalledOnce();
  });

  it("propagates a verification transport error for a pre-existing folder from the retry", async () => {
    const { memory, storage } = await server("solid");
    await memory.create(POD, null, { name: "trips", kind: "container" });
    await memory.create(`${POD}trips/`, sharedWithBob(`${POD}trips/`), {
      name: ".acl",
      contentType: "text/turtle",
    });
    let outage = false;
    const store = createTripsStore({
      storage,
      index: { register: vi.fn(), findAll: vi.fn() },
      protect: async (url, folder, created) => {
        if (outage) throw new Error("offline");
        await verifiedOwnerOnly(storage, OWNER, async () => true)(url, folder, created);
      },
    });
    await store.initialise();
    outage = true;
    await expect(store.retryRegistration()).rejects.toThrow("offline");
  });
});

describe("lws pod", () => {
  it("never rewrites a pre-existing container: unverifiable access refuses private writes", async () => {
    const { memory, storage } = await server("lws");
    await memory.create(POD, null, { name: "trips", kind: "container" });
    await memory.create(`${POD}trips/`, null, { name: "reservations", kind: "container" });
    const establish = vi.fn(async () => true);
    const { store, register } = open(storage, establish);
    await store.initialise();
    expect(establish).not.toHaveBeenCalled();
    expect(store.sharedFolders).toEqual([`${POD}trips/`, `${POD}trips/reservations/`]);
    expect(register).not.toHaveBeenCalled();
    await expect(store.saveTrip(newTrip)).rejects.toBeInstanceOf(TripsPrivacyError);
    await expect(store.addReservation({ kind: "TrainReservation" })).rejects.toBeInstanceOf(
      TripsPrivacyError,
    );
  });

  it("seals a container it created, but the shared verifier fails closed on lws", async () => {
    const { storage } = await server("lws");
    const establish = vi.fn(async () => true);
    const { store, register } = open(storage, establish);
    await expect(store.initialise()).rejects.toMatchObject({ reason: "unverified" });
    expect(establish).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
  });
});

describe("Type Index registration is non-fatal", () => {
  for (const protocol of ["solid", "lws"] as const)
    it(`opens, reads and writes when registration fails (${protocol})`, async () => {
      const storage = createMemoryStorage({ protocol, root: POD });
      const register = vi
        .fn()
        .mockRejectedValueOnce(new Error("no preferences document"))
        .mockResolvedValue(undefined);
      const store = createTripsStore({
        storage,
        index: { register, findAll: vi.fn(async () => new Map()) },
        protect: async () => {},
      });
      await store.initialise();
      expect(store.registration).toMatchObject({
        status: "failed",
        message: expect.stringContaining("try again later"),
        cause: expect.objectContaining({ message: "no preferences document" }),
      });
      const saved = await store.saveTrip(newTrip);
      expect((await store.load()).trips.map((t) => t.id)).toEqual([saved.id]);
      expect(await store.retryRegistration()).toEqual({ status: "registered" });
      expect(store.registration).toEqual({ status: "registered" });
      expect(register).toHaveBeenCalledTimes(2);
    });

  it("explains a missing or non-private Type Index and skips registration when verification fails", async () => {
    const storage = createMemoryStorage({ protocol: "solid", root: POD });
    const register = vi.fn();
    const verifyPrivateIndex = vi
      .fn()
      .mockRejectedValueOnce(new TypeIndexSetupError("Set up a private Type Index first"))
      .mockResolvedValue(undefined);
    const store = createTripsStore({
      storage,
      index: { register, findAll: vi.fn() },
      verifyPrivateIndex,
      protect: async () => {},
    });
    await store.initialise();
    expect(store.registration).toMatchObject({
      status: "failed",
      message: "Set up a private Type Index first",
    });
    expect(register).not.toHaveBeenCalled();
    expect(store.registration.status).toBe("failed");
    expect((await store.retryRegistration()).status).toBe("registered");
    expect(register).toHaveBeenCalledOnce();
  });
});

describe("verifiedOwnerOnly", () => {
  it("only establishes what was created and never calls the role writer for existing resources", async () => {
    const { memory, storage } = await server("solid");
    const establish = vi.fn(async () => true);
    const protect = verifiedOwnerOnly(storage, OWNER, establish);
    await memory.create(POD, null, { name: "mine", kind: "container" });
    await protect(`${POD}mine/`, true, false);
    expect(establish).not.toHaveBeenCalled();
    await memory.create(POD, null, { name: "new", kind: "container" });
    await protect(`${POD}new/`, true, true);
    expect(establish).toHaveBeenCalledExactlyOnceWith(`${POD}new/`, true);
  });
});
