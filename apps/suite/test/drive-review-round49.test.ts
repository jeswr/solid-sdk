// AUTHORED-BY Codex

import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { expect, it, vi } from "vitest";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import {
  ACL,
  aclBody,
  OWNER,
  PRIVATE,
  PUBLIC,
  ROOT,
  turtle,
  WacFields,
  wacPod,
} from "./drive-wac-pod";

it.each([
  "before first write",
  "between files",
  "after last write",
  "before source deletion",
])("inherited move stops when destination defaults widen %s", async (timing) => {
  const f = await wacPod();
  const from = `${PRIVATE}tree/`;
  const to = `${PUBLIC}tree/`;
  await f.pod.fetch(`${from}a`, { method: "PUT", body: "secret contents" });
  await f.pod.fetch(`${from}b`, { method: "PUT", body: "secret contents" });
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  expect((await f.anonymous(`${from}a`)).status).toBe(403);
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    webId: OWNER,
    confirmAccess,
  });
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      response.ok &&
      method === "PUT" &&
      (timing === "before first write"
        ? url === to
        : timing === "between files"
          ? url === `${to}b` && (await (await f.pod.fetch(url)).text()) === ""
          : timing === "after last write" &&
            url === `${to}b` &&
            (await (await f.pod.fetch(url)).text()) === "secret contents")
    ) {
      changed = true;
      f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
    }
    return response;
  });
  const outcome = await client
    .move(
      from,
      to,
      { kind: "confirm-move" },
      {
        beforeDelete: async () => {
          if (timing === "before source deletion" && !changed) {
            changed = true;
            f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
          }
        },
      },
    )
    .catch((error: unknown) => error);
  expect(changed).toBe(true);
  expect(outcome).toBeInstanceOf(Error);
  expect(confirmAccess).toHaveBeenCalledWith(
    expect.objectContaining({ gains: ["Everyone (public)"] }),
  );
  for (const name of ["a", "b"]) {
    expect(f.pod.has(`${from}${name}`)).toBe(true);
    expect((await f.anonymous(`${to}${name}`)).status).not.toBe(200);
  }
  expect(f.calls.filter(({ url, method }) => url.startsWith(from) && method === "DELETE")).toEqual(
    [],
  );
});

it.each([
  "keep",
  "move",
] as const)("late access confirmation can %s after removing the unchecked copy", async (choice) => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const confirmAccess = vi.fn(async () => {
    expect(f.pod.has(from)).toBe(true);
    expect(f.pod.has(to)).toBe(false);
    return choice;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      changed = true;
      f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
    }
    return response;
  });
  await client.move(from, to, { kind: "confirm-move" });
  expect(confirmAccess).toHaveBeenCalledTimes(1);
  expect(f.pod.has(from)).toBe(false);
  expect((await f.anonymous(to)).status).toBe(choice === "keep" ? 403 : 200);
});

it.each([
  "unknown",
  "different governing ACL",
  "wider without a handler",
])("inherited move refuses %s after its last write", async (mode) => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const confirmAccess = vi.fn(async () => "move" as const);
  const client = createSolidDriveClient({
    storageUrl: ROOT,
    fetch: f.fetch,
    ...(mode === "wider without a handler" ? {} : { confirmAccess }),
  });
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      changed = true;
      if (mode === "unknown") f.policies.set(`${PUBLIC}.policy`, "invalid RDF");
      else if (mode === "different governing ACL")
        f.policies.set(`${to}.policy`, await aclBody(to));
      else f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
    }
    return response;
  });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow();
  expect(changed).toBe(true);
  expect(f.pod.has(from)).toBe(true);
  if (mode === "different governing ACL") {
    expect(f.pod.has(to)).toBe(true);
    expect(f.policies.get(`${to}.policy`)).toBe(await aclBody(to));
    expect((await f.anonymous(to)).status).toBe(403);
  } else expect(f.pod.has(to)).toBe(false);
  expect(confirmAccess).not.toHaveBeenCalled();
});

it.each([
  "equivalent",
  "narrower",
])("inherited move accepts a newer %s parsed policy", async (mode) => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, mode === "narrower"));
  if (mode === "narrower") f.policies.set(`${PRIVATE}.policy`, await aclBody(PRIVATE, true));
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  let changed = false;
  f.after(async (url, method, response) => {
    if (!changed && url === to && method === "PUT" && response.ok) {
      changed = true;
      f.policies.set(`${PUBLIC}.policy`, `${await aclBody(PUBLIC)}\n# new validator`);
    }
    return response;
  });
  await client.move(from, to, { kind: "confirm-move" });
  expect(changed).toBe(true);
  expect(confirmAccess).not.toHaveBeenCalled();
  expect(f.pod.has(from)).toBe(false);
});

it("copied own access is checked again before sending file bytes", async () => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}own-race`;
  f.policies.set(`${from}.policy`, await aclBody(from));
  const confirmAccess = vi.fn(async () => "cancel" as const);
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  let installed = false;
  let changed = false;
  f.after(async (url, method, response) => {
    if (url === `${to}.policy` && method === "PUT" && response.ok) installed = true;
    if (!changed && installed && url === `${to}.policy` && method === "GET" && response.ok) {
      changed = true;
      f.policies.set(`${to}.policy`, await aclBody(to, true));
    }
    return response;
  });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow();
  expect(changed).toBe(true);
  expect(confirmAccess).not.toHaveBeenCalled();
  expect(f.pod.has(from)).toBe(true);
  expect(f.policies.get(`${to}.policy`)).toBe(await aclBody(to, true));
  expect(await (await f.pod.fetch(to)).text()).toBe("");
  expect(f.calls.filter(({ url, method }) => url === to && method === "PUT")).toHaveLength(2);
});

it.each([
  "new governing ACL",
  "more access",
])("late confirmation is bound to its policy despite %s while the dialog is open", async (mode) => {
  const f = await wacPod();
  const from = `${PRIVATE}secret`;
  const to = `${PUBLIC}secret`;
  f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC));
  const confirmAccess = vi.fn(async () => {
    if (confirmAccess.mock.calls.length > 1) return "cancel" as const;
    if (mode === "new governing ACL") f.policies.delete(`${PUBLIC}.policy`);
    else {
      const data = await parseRdf(await aclBody(PUBLIC, true), "text/turtle");
      new WacFields(`${PUBLIC}#public`, data, DataFactory).iris(`${ACL}mode`).add(`${ACL}Write`);
      f.policies.set(`${PUBLIC}.policy`, await turtle(data));
    }
    return "move" as const;
  });
  const client = createSolidDriveClient({ storageUrl: ROOT, fetch: f.fetch, confirmAccess });
  let changed = false;
  f.after(async (url, method, response) => {
    if (
      !changed &&
      url === to &&
      method === "PUT" &&
      response.ok &&
      (await (await f.pod.fetch(to)).text()) === "secret contents"
    ) {
      changed = true;
      f.policies.set(`${PUBLIC}.policy`, await aclBody(PUBLIC, true));
    }
    return response;
  });
  await expect(client.move(from, to, { kind: "confirm-move" })).rejects.toThrow("cancelled");
  expect(confirmAccess).toHaveBeenCalledTimes(2);
  expect(f.pod.has(from)).toBe(true);
  expect(f.pod.has(to)).toBe(false);
});
