// AUTHORED-BY Codex GPT-6.1-Sol
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { DataFactory as df, Parser, Store } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { auditSpecialRead } from "../src/audit.js";
import { MAX_CONTENT_BYTES } from "../src/content.js";
import { purposeDenied } from "../src/personal-policy.js";
import type { PodPort } from "../src/pod-port.js";

const ROOT = "https://example.org/pod/";
const OWNER = `${ROOT}profile/card#me`;
const CLIENT = "urn:example:client";
const PD = "https://w3id.org/dpv/pd#";
const PROV = "http://www.w3.org/ns/prov#";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
afterEach(() => vi.restoreAllMocks());
function fixture() {
  return createMemoryPodPort({ root: ROOT, webId: OWNER });
}
function url() {
  return `${ROOT}private/pkg/audit/${new Date().toISOString().slice(0, 7)}.ttl`;
}
function audit(pod: PodPort, categories = [`${PD}MedicalHealth`]) {
  return auditSpecialRead(pod, false, CLIENT, "Personalisation", categories);
}
async function activities(pod: PodPort) {
  return new Parser()
    .parse(decoder.decode((await pod.read(url())).body))
    .filter((q) => q.object.value === `${PROV}Activity`);
}
function conflict() {
  return Object.assign(new Error("HTTP 412"), { status: 412 });
}

it("does not write an audit for ordinary data", async () => {
  const pod = fixture();
  const write = vi.spyOn(pod, "write");
  await auditSpecialRead(pod, true, CLIENT, "Personalisation", [`${PD}Contact`]);
  expect(write).not.toHaveBeenCalled();
  expect(purposeDenied([]).isError).toBe(true);
});

it("protects missing ancestors and replaces orphan public ACLs before writing data", async () => {
  const pod = fixture();
  for (const target of [`${ROOT}private/pkg/audit/`, url()]) {
    await pod.write(`${target}.acl`, encoder.encode("public orphan ACL"), "text/turtle", {});
  }
  const write = vi.spyOn(pod, "write");
  await audit(pod, [`${PD}MedicalHealth`, `${PD}Financial`, `${PD}MedicalHealth`]);
  for (const target of [
    `${ROOT}private/`,
    `${ROOT}private/pkg/`,
    `${ROOT}private/pkg/audit/`,
    url(),
  ]) {
    const acl = new Store(
      new Parser().parse(decoder.decode((await pod.read(`${target}.acl`)).body)),
    );
    expect(
      acl
        .getObjects(null, df.namedNode("http://www.w3.org/ns/auth/acl#agent"), null)
        .map((term) => term.value),
    ).toEqual([OWNER]);
    expect(
      acl.getObjects(null, df.namedNode("http://www.w3.org/ns/auth/acl#agentClass"), null),
    ).toEqual([]);
    const aclIndex = write.mock.calls.findIndex(([address]) => address === `${target}.acl`);
    expect(aclIndex).toBeLessThan(write.mock.calls.findIndex(([address]) => address === target));
  }
  const body = decoder.decode((await pod.read(url())).body);
  expect(body).toContain(`${PD}Financial`);
  expect(body).toContain("https://w3id.org/dpv#Personalisation");
  expect(await activities(pod)).toHaveLength(1);
});

it("retries a conflicting monthly append without losing another writer's entry", async () => {
  const pod = fixture();
  await audit(pod);
  const write = pod.write;
  let raced = false;
  pod.write = async (target, ...rest) => {
    if (target === url() && !raced) {
      raced = true;
      const previous = await pod.read(target);
      const body = `${decoder.decode(previous.body)}\n<urn:example:concurrent> a <${PROV}Activity> .`;
      await write(target, encoder.encode(body), "text/turtle", { ifMatch: previous.etag });
    }
    return write(target, ...rest);
  };
  await audit(pod);
  const logged = await activities(pod);
  expect(logged).toHaveLength(3);
  expect(logged.some((entry) => entry.subject.value === "urn:example:concurrent")).toBe(true);
});

it("allows concurrent calls to commit distinct activities", async () => {
  const pod = fixture();
  await audit(pod);
  const results = await Promise.allSettled([audit(pod), audit(pod)]);
  expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  expect(await activities(pod)).toHaveLength(3);
});

it("stops after bounded CAS retries", async () => {
  const pod = fixture();
  await audit(pod);
  const write = pod.write;
  let attempts = 0;
  pod.write = async (target, ...rest) => {
    if (target === url()) {
      attempts++;
      throw conflict();
    }
    return write(target, ...rest);
  };
  await expect(audit(pod)).rejects.toMatchObject({ status: 412 });
  expect(attempts).toBe(3);
  expect(await activities(pod)).toHaveLength(1);
});

it.each([
  undefined,
  'W/"1"',
  "invalid",
  '"bad\r\nheader"',
])("refuses replacement without a strong ETag (%s)", async (etag) => {
  const pod = fixture();
  await audit(pod);
  const read = pod.read;
  pod.read = async (target) => ({ ...(await read(target)), ...(target === url() ? { etag } : {}) });
  const write = vi.spyOn(pod, "write");
  await expect(audit(pod)).rejects.toThrow("Strong ETag");
  expect(write.mock.calls.some(([target]) => target === url())).toBe(false);
});

it.each([
  "text/plain",
  "text/turtle",
])("refuses unreadable or malformed audit history (%s)", async (contentType) => {
  const pod = fixture();
  await pod.write(url(), encoder.encode("malformed PRIVATE history"), contentType, {});
  const write = vi.spyOn(pod, "write");
  await expect(audit(pod)).rejects.toThrow();
  expect(write.mock.calls.some(([target]) => target === url())).toBe(false);
  expect(decoder.decode((await pod.read(url())).body)).toBe("malformed PRIVATE history");
});

it("does not treat an unreadable monthly log as absent", async () => {
  const pod = fixture();
  const read = pod.read;
  pod.read = async (target) => {
    if (target === url()) throw new Error("HTTP 403 PRIVATE");
    return read(target);
  };
  const write = vi.spyOn(pod, "write");
  await expect(audit(pod)).rejects.toThrow("HTTP 403");
  expect(write.mock.calls.some(([target]) => target === url())).toBe(false);
});

it("verifies that a successful write actually persisted the activity", async () => {
  const pod = fixture();
  const write = pod.write;
  pod.write = async (target, body, ...rest) =>
    write(target, target === url() ? encoder.encode("") : body, ...rest);
  await expect(audit(pod)).rejects.toThrow("not persisted");
});

it("handles ACL writes that implicitly create the protected container", async () => {
  const pod = fixture();
  const write = pod.write;
  pod.write = async (target, ...rest) => {
    const receipt = await write(target, ...rest);
    if (target.endsWith("/.acl"))
      await write(target.slice(0, -4), encoder.encode(""), "text/turtle", {});
    return receipt;
  };
  await audit(pod);
  expect(await activities(pod)).toHaveLength(1);
});

it("bounds previous audit input and refuses overflow", async () => {
  const pod = fixture();
  await pod.write(url(), encoder.encode(" ".repeat(MAX_CONTENT_BYTES + 1)), "text/turtle", {});
  const write = vi.spyOn(pod, "write");
  await expect(audit(pod)).rejects.toThrow();
  expect(write.mock.calls.some(([target]) => target === url())).toBe(false);
});
