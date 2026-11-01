// AUTHORED-BY Codex GPT-6.1-Sol
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  isInRealm,
  parseLinks,
  resolveStorageContext,
  selfIdentifiedSolidRoot,
  storageContextKey,
} from "../src/StorageContext.js";

const resource = "https://pod.example/alice/a";
const storage = "https://pod.example/storage";
const root = "https://pod.example/alice/";
const relation = "https://www.w3.org/ns/lws#storage";
const solidRelation = "http://www.w3.org/ns/solid/terms#storageDescription";
const challenge = (target = storage, rel = relation) =>
  new Response(null, { status: 401, headers: { link: `<${target}>; rel="${rel}"` } });
const description = () => ({
  id: storage,
  type: ["Storage"],
  service: [{ type: ["StorageRoot"], serviceEndpoint: root }],
});

test("storage context probing can be disabled or use the pristine global transport", async () => {
  assert.equal(await storageContextKey({ probe: false })(new Request(resource)), resource);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 401 }));
  assert.equal(await storageContextKey()(new Request(resource)), resource);
  assert.equal(fetch.mock.calls[0][1].credentials, "omit");
});

test("LWS discovery refuses foreign descriptions, HTTP failures and malformed storage shapes", async () => {
  const fetch = vi.fn(async () => Response.json(description()));
  assert.equal(
    (
      await resolveStorageContext(resource, challenge("https://foreign.example/storage"), {
        http: { fetch },
      })
    ).source,
    "exact",
  );
  assert.equal(fetch.mock.calls.length, 0);
  for (const body of [
    { ...description(), type: "wrong" },
    { ...description(), service: {} },
    { ...description(), service: [{ type: "Other", serviceEndpoint: root }] },
    { ...description(), service: [{ type: "StorageRoot", serviceEndpoint: 4 }] },
    {
      ...description(),
      service: [
        { type: "StorageRoot", serviceEndpoint: `${root}?q=1` },
        { type: "StorageRoot", serviceEndpoint: `${root}#fragment` },
      ],
    },
  ]) {
    assert.equal(
      (
        await resolveStorageContext(resource, challenge(), {
          http: { fetch: async () => Response.json(body) },
        })
      ).source,
      "exact",
    );
  }
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(null, { status: 302 }),
    Object.defineProperty(Response.json(description()), "url", {
      value: "https://other.example/storage",
    }),
  ]) {
    assert.equal(
      (
        await resolveStorageContext(resource, challenge(), {
          http: { fetch: async () => response },
        })
      ).source,
      "exact",
    );
  }
});

test("LWS roots must independently confirm their description", async () => {
  for (const confirmation of [
    undefined,
    new Response(null, { status: 302 }),
    new Response(),
    challenge("https://pod.example/wrong"),
  ]) {
    const fetch = async (url) => {
      if (String(url) === storage) return Response.json(description());
      if (confirmation === undefined) throw new Error("offline");
      return confirmation;
    };
    assert.equal(
      (await resolveStorageContext(resource, challenge(), { http: { fetch } })).source,
      "exact",
    );
  }
  const fetch = async (url) =>
    String(url) === storage ? Response.json(description()) : challenge();
  assert.equal(await isInRealm(resource, new URL(storage), { http: { fetch } }), true);
  assert.equal(
    await isInRealm(resource, new URL("https://foreign.example/storage"), {
      http: {
        fetch: async () => {
          throw new Error("offline");
        },
      },
    }),
    false,
  );
});

test("Solid descriptions and self-identification must describe the actual requested resource", async () => {
  const desc = "https://pod.example/description";
  assert.equal(
    (
      await resolveStorageContext(resource, challenge(desc, solidRelation), {
        http: { fetch: async () => new Response(null, { status: 404 }) },
      })
    ).source,
    "exact",
  );
  const redirected = Object.defineProperty(challenge(), "url", { value: "https://other.example/" });
  assert.equal(selfIdentifiedSolidRoot(root, redirected), undefined);
  const ttl =
    "<https://pod.example/alice/> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/ns/pim/space#Storage> .";
  const fetch = async (url) => (String(url) === desc ? new Response(ttl) : new Response());
  assert.equal(
    (await resolveStorageContext(resource, challenge(desc, solidRelation), { http: { fetch } }))
      .source,
    "exact",
  );
});

test("malformed Link headers cannot contribute discovery evidence", () => {
  assert.deepEqual(parseLinks("<unterminated", resource), []);
});
