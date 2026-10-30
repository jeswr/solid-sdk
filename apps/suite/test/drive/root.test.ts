// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory, Parser, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { DriveContainer, DriveResource } from "../../src/apps/drive/lib/model/model.js";
import {
  DriveRootInitializationError,
  ensureDriveRoot,
} from "../../src/apps/drive/lib/model/root.js";
import { quadsToTurtle } from "../../src/apps/drive/lib/model/serialize.js";
import {
  buildDriveRootRegistration,
  findDriveRoots,
} from "../../src/apps/drive/lib/model/type-index.js";
import { LDP, PODDRIVE, RDF, SOLID } from "../../src/apps/drive/lib/model/vocab.js";
import { turtle } from "./helpers.js";

const storage = "https://pod.example/alice/";
const root = `${storage}drive/`;
const metadata = `${root}description`;
const containerBody = containerDescription(root);
const index = `${storage}settings/private.ttl`;
const options = { storageUrl: storage, typeIndexUrl: index };

function containerDescription(url: string): string {
  const { namedNode, quad } = DataFactory;
  return new Writer().quadsToString([
    quad(namedNode(url), namedNode(RDF.type), namedNode(LDP.BasicContainer)),
  ]);
}

/** CSS-style storage, optionally advertising conditional container PATCH support. */
function memory(existingStatus: 409 | 412 = 409, storageUrl = storage, containerPatch = false) {
  const root = `${storageUrl}drive/`;
  const metadata = `${root}description`;
  const containerBody = containerDescription(root);
  const index = `${storageUrl}settings/private.ttl`;
  const files = new Map<string, { body: string; version: number }>([
    [index, { body: "", version: 1 }],
  ]);
  const calls: { url: string; method: string; headers: Headers; status: number }[] = [];
  let indexWrites = 0;
  let rootCreates = 0;
  let before: ((url: string, method: string) => Response | undefined) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let response =
      (method === "PUT" || method === "PATCH") &&
      !headers.has("If-Match") &&
      !headers.has("If-None-Match")
        ? new Response(null, { status: 428 })
        : before?.(url, method);
    if (!response) {
      const file = files.get(url);
      const preconditionFails = () =>
        (headers.get("If-None-Match") === "*" && files.has(url)) ||
        (headers.has("If-Match") && headers.get("If-Match") !== `"${files.get(url)?.version}"`);
      if (method === "HEAD") {
        response = new Response(null, { status: file ? 200 : 404 });
      } else if (method === "GET") {
        response = file
          ? new Response(file.body, {
              headers: {
                "Content-Type": "text/turtle",
                ETag: `"${file.version}"`,
                ...(url === root
                  ? {
                      Link: `<description>; rel="describedby"`,
                      ...(containerPatch
                        ? { "Accept-Patch": "application/sparql-update, text/n3; charset=utf-8" }
                        : {}),
                    }
                  : {}),
              },
            })
          : new Response(null, { status: 404 });
      } else if (method === "PUT") {
        if (url === root && file) {
          response = new Response(null, { status: existingStatus });
        } else if (preconditionFails()) {
          response = new Response(null, { status: 412 });
        } else {
          files.set(url, {
            body: url === root ? containerBody : String(init?.body),
            version: (file?.version ?? 0) + 1,
          });
          if (url === index) indexWrites++;
          if (url === root) rootCreates++;
          response = new Response(null, {
            status: 201,
            headers: { ETag: `"${(file?.version ?? 0) + 1}"` },
          });
        }
      } else if (method === "PATCH" && (url === metadata || (url === root && containerPatch))) {
        // A conforming server need only support N3 Patch, not SPARQL Update.
        if (preconditionFails()) {
          response = new Response(null, { status: 412 });
        } else if (headers.get("Content-Type") !== "text/n3") {
          response = new Response(null, { status: 415 });
        } else {
          // This is the mock server parsing a PATCH request. fetch-rdf parses
          // response representations and does not support N3 formula syntax.
          const patch = new Store(
            new Parser({ format: "N3", baseIRI: url })
              .parse(String(init?.body))
              // N3 2.0.3 emits a sentinel quad with a null predicate for {}.
              .filter((quad) => quad.predicate !== null),
          );
          const inserts = patch.getQuads(
            null,
            `${SOLID.ns}inserts`,
            null,
            DataFactory.defaultGraph(),
          );
          expect(inserts).toHaveLength(1);
          const insert = inserts[0];
          if (!insert) throw new Error("Missing insert formula");
          expect(
            patch.getQuads(
              insert.subject,
              RDF.type,
              `${SOLID.ns}InsertDeletePatch`,
              DataFactory.defaultGraph(),
            ),
          ).toHaveLength(1);
          const where = patch.getQuads(
            insert.subject,
            `${SOLID.ns}where`,
            null,
            DataFactory.defaultGraph(),
          );
          expect(where).toHaveLength(1);
          expect(patch.getQuads(null, null, null, where[0]?.object ?? null)).toHaveLength(0);
          expect(patch.getQuads(null, null, null, DataFactory.defaultGraph())).toHaveLength(3);
          const current = files.get(root);
          if (!current) throw new Error("Missing container");
          const dataset = turtle(current.body);
          const descriptionFile = files.get(metadata);
          const description = turtle(descriptionFile?.body ?? "");
          // Apply the parsed insertion formula to the target document's default graph.
          for (const quad of patch.match(null, null, null, insert.object)) {
            expect(quad.subject.termType).toBe("NamedNode");
            expect(quad.object.termType).toBe("NamedNode");
            dataset.addQuad(quad.subject, quad.predicate, quad.object);
            description.addQuad(quad.subject, quad.predicate, quad.object);
          }
          const rootBody = await quadsToTurtle(dataset);
          const metadataBody = await quadsToTurtle(description);
          // Check and commit atomically after async serialization: two callers
          // must not both pass If-None-Match before either write is persisted.
          if (preconditionFails()) {
            response = new Response(null, { status: 412 });
          } else {
            files.set(root, { body: rootBody, version: current.version + 1 });
            files.set(metadata, {
              body: metadataBody,
              version: (descriptionFile?.version ?? 0) + 1,
            });
            response = new Response(null, { status: 205 });
          }
        }
      } else if (method === "DELETE" && url === root) {
        if (!headers.has("If-Match")) throw new TypeError("Unconditional deletion");
        if (headers.get("If-Match") !== `"${file?.version}"`) {
          response = new Response(null, { status: 412 });
        } else if (
          turtle(file?.body ?? "").match(
            DataFactory.namedNode(root),
            DataFactory.namedNode(LDP.contains),
            null,
          ).size > 0
        ) {
          response = new Response(null, { status: 409 });
        } else {
          files.delete(root);
          files.delete(metadata);
          files.delete(`${root}.acl`);
          response = new Response(null, { status: 204 });
        }
      } else throw new Error(`Unexpected method ${method}`);
    }
    response.headers.set("x-solid-demo-access-control", "none");
    Object.defineProperty(response, "url", { value: url });
    calls.push({ url, method, headers, status: response.status });
    return response;
  };
  return {
    files,
    calls,
    fetch,
    setBefore(fn: typeof before) {
      before = fn;
    },
    get indexWrites() {
      return indexWrites;
    },
    get rootCreates() {
      return rootCreates;
    },
  };
}

async function registration(url = root) {
  return quadsToTurtle(buildDriveRootRegistration(`${index}#existing`, url));
}

async function initializationFailure(
  promise: Promise<string>,
): Promise<DriveRootInitializationError> {
  const error = await promise.catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(DriveRootInitializationError);
  if (!(error instanceof DriveRootInitializationError))
    throw new Error("Expected resumable failure");
  return error;
}

describe("ensureDriveRoot", () => {
  it("round-trips root IRIs containing replacement-string metacharacters in N3 formulae", async () => {
    const unusualStorage = `${storage}$&/`;
    const unusualRoot = `${unusualStorage}drive/`;
    const m = memory(409, unusualStorage);
    expect(
      await ensureDriveRoot(m.fetch, {
        storageUrl: unusualStorage,
        typeIndexUrl: `${unusualStorage}settings/private.ttl`,
      }),
    ).toBe(unusualRoot);
    expect(
      new DriveResource(unusualRoot, turtle(m.files.get(unusualRoot)?.body ?? ""), DataFactory)
        .isDriveRoot,
    ).toBe(true);
  });

  it("makes the server mock reject unconditional PATCHes", async () => {
    const m = memory();
    expect((await m.fetch(metadata, { method: "PATCH" })).status).toBe(428);
  });

  it.each([
    409, 412,
  ] as const)("recovers a committed creation with a lost response (%s)", async (status) => {
    const m = memory(status);
    const cause = new TypeError("Creation response lost");
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (String(input) === root && init?.method === "PUT") throw cause;
      return response;
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    expect(failure.cause).toBe(cause);
    expect(m.files.get(root)?.body).toBe(containerBody);
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(await failure.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
  });

  it("resumes directly after losing the container creation response", async () => {
    const m = memory();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (init?.method === "PUT" && String(input) === root) throw new TypeError("Disconnected");
      return response;
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    expect(await failure.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
  });

  it.each([1, 2])("retries creation after %s PUT failures before committing", async (failures) => {
    const m = memory();
    const cause = new TypeError("Disconnected before creation");
    const puts: Headers[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === root && init?.method === "PUT") {
        puts.push(new Headers(init.headers));
        if (puts.length <= failures) throw cause;
      }
      return m.fetch(input, init);
    };
    let failure = await initializationFailure(ensureDriveRoot(fetch, options));
    for (let attempt = 1; attempt < failures; attempt++) {
      failure = await initializationFailure(failure.resume());
    }
    expect(failure.cause).toBe(cause);
    expect(m.files.has(root)).toBe(false);
    expect(m.indexWrites).toBe(0);
    expect(await failure.resume()).toBe(root);
    expect(puts).toHaveLength(failures + 1);
    expect(puts.every((headers) => headers.get("If-None-Match") === "*")).toBe(true);
    expect(
      m.calls.filter((call) => call.url === root && call.method === "GET" && call.status === 404),
    ).toHaveLength(failures);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
    expect(await failure.resume()).toBe(root);
    expect(puts).toHaveLength(failures + 1);
  });

  it.each([403, 500])("keeps a failed creation retry (%s) resumable", async (status) => {
    const m = memory();
    let disconnected = true;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === root && init?.method === "PUT" && disconnected) {
        disconnected = false;
        throw new TypeError("Disconnected before creation");
      }
      return m.fetch(input, init);
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    m.setBefore((url, method) =>
      url === root && method === "PUT" ? new Response(null, { status }) : undefined,
    );
    const retried = await initializationFailure(failure.resume());
    expect(retried.cause).toMatchObject({ name: "DriveWriteError", status, url: root });
    expect(m.files.has(root)).toBe(false);
    expect(m.calls.filter((call) => call.url === root && call.method === "PUT")).toHaveLength(1);
    expect(m.indexWrites).toBe(0);
    m.setBefore(undefined);
    expect(await retried.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
  });

  it.each([
    409, 412,
  ] as const)("revalidates containers created concurrently with a retry (%s)", async (status) => {
    for (const populated of [false, true]) {
      const m = memory(status);
      m.setBefore((url, method) =>
        url === metadata && method === "PATCH" ? new Response(null, { status: 503 }) : undefined,
      );
      const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
      m.files.delete(root);
      const body = populated
        ? `${containerBody}\n<${root}> <${LDP.contains}> <${root}other.txt>.`
        : containerBody;
      m.setBefore((url, method) => {
        if (url === root && method === "PUT") {
          // A different container may reuse our deleted container's ETag.
          m.files.set(root, { body, version: 1 });
          return new Response(null, { status });
        }
        return undefined;
      });
      if (populated) {
        const rejected = await initializationFailure(failure.resume());
        expect(rejected.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
        expect(m.files.get(root)).toEqual({ body, version: 1 });
        expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
        expect(m.indexWrites).toBe(0);
      } else {
        expect(await failure.resume()).toBe(root);
        expect(m.indexWrites).toBe(1);
      }
      const puts = m.calls.filter((call) => call.url === root && call.method === "PUT");
      expect(puts.map((call) => call.status)).toEqual([201, status]);
      expect(puts.every((call) => call.headers.get("If-None-Match") === "*")).toBe(true);
      expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    }
  });

  it("bounds recreation when the following read still reports absence", async () => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "PATCH" ? new Response(null, { status: 503 }) : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    m.files.delete(root);
    m.setBefore((url, method) =>
      url === root && method === "GET" ? new Response(null, { status: 404 }) : undefined,
    );
    const retried = await initializationFailure(failure.resume());
    expect(retried.cause).toMatchObject({ name: "RdfFetchError", status: 404, url: root });
    expect(m.calls.filter((call) => call.url === root && call.method === "PUT")).toHaveLength(2);
    expect(
      m.calls.filter((call) => call.url === root && call.method === "GET" && call.status === 404),
    ).toHaveLength(2);
    expect(m.indexWrites).toBe(0);
    m.setBefore(undefined);
    expect(await retried.resume()).toBe(root);
    expect(m.rootCreates).toBe(2);
    expect(m.indexWrites).toBe(1);
  });

  it("does not retry creation when reading the container fails in transport", async () => {
    const m = memory();
    const cause = new TypeError("Disconnected while reading");
    let disconnected = true;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === root && (init?.method ?? "GET") === "GET" && disconnected) throw cause;
      return m.fetch(input, init);
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    const retried = await initializationFailure(failure.resume());
    expect(retried.cause).toMatchObject({ name: "RdfFetchError", cause, url: root });
    expect(m.calls.filter((call) => call.url === root && call.method === "PUT")).toHaveLength(1);
    expect(m.indexWrites).toBe(0);
    disconnected = false;
    expect(await retried.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
  });

  it.each([
    409, 412,
  ] as const)("adopts an existing empty, unmarked container (%s)", async (status) => {
    const m = memory(status);
    m.files.set(root, { body: containerBody, version: 3 });
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(m.rootCreates).toBe(0);
    expect(m.indexWrites).toBe(1);
  });

  it("refuses to adopt an existing container with children", async () => {
    const m = memory();
    const body = await serialize([
      ...turtle(containerBody),
      DataFactory.quad(
        DataFactory.namedNode(root),
        DataFactory.namedNode(LDP.contains),
        DataFactory.namedNode(`${root}keep.txt`),
      ),
    ]);
    m.files.set(root, { body, version: 7 });
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({
      status: 409,
      url: root,
    });
    expect(m.files.get(root)?.body).toBe(body);
    expect(m.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    "creation",
    "first read",
  ])("rejects a populated replacement using the %s validator", async (validator) => {
    const m = memory();
    m.setBefore((url, method) =>
      (
        validator === "creation"
          ? url === root && method === "GET"
          : url === metadata && method === "PATCH"
      )
        ? new Response(null, { status: 503 })
        : undefined,
    );
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (validator === "first read" && String(input) === root && init?.method === "PUT")
        response.headers.delete("ETag");
      return response;
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    const replacement = await serialize([
      ...turtle(containerBody),
      DataFactory.quad(
        DataFactory.namedNode(root),
        DataFactory.namedNode(LDP.contains),
        DataFactory.namedNode(`${root}replacement.txt`),
      ),
    ]);
    m.files.delete(root);
    m.files.set(root, { body: replacement, version: 9 });
    m.setBefore(undefined);
    const patches = m.calls.filter((call) => call.method === "PATCH").length;
    const rejected = await initializationFailure(failure.resume());
    expect(rejected.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
    expect(m.files.get(root)?.body).toBe(replacement);
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(patches);
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    undefined,
    null,
    'W/"1"',
    '"1"',
  ])("rejects a populated replacement even when the description PATCH succeeds (%s)", async (etag) => {
    const m = memory();
    const replacement = turtle(containerBody);
    new DriveContainer(root, replacement, DataFactory).contains.add(
      new DriveResource(`${root}unrelated.txt`, replacement, DataFactory),
    );
    const body = await quadsToTurtle(replacement);
    m.setBefore((url, method) => {
      if (url === metadata && method === "PATCH") {
        m.files.delete(root);
        m.files.set(root, { body, version: 9 });
      }
      return undefined;
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (String(input) === root && init?.method !== "PUT" && etag !== undefined) {
        if (etag === null) response.headers.delete("ETag");
        else response.headers.set("ETag", etag);
      }
      return response;
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    expect(m.calls.filter((call) => call.method === "PATCH").map((call) => call.status)).toEqual([
      205,
    ]);
    expect(failure.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
    expect(m.indexWrites).toBe(0);
    expect(
      new DriveResource(root, turtle(m.files.get(root)?.body ?? ""), DataFactory).isDriveRoot,
    ).toBe(true);
    m.setBefore(undefined);
    const retried = await initializationFailure(failure.resume());
    expect(retried.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
    expect(m.indexWrites).toBe(0);
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it.each([
    "lost PATCH response",
    "failed verification read",
  ])("retains pre-PATCH identity after a %s on a replacement", async (stage) => {
    const m = memory();
    const replacement = turtle(containerBody);
    new DriveContainer(root, replacement, DataFactory).contains.add(
      new DriveResource(`${root}unrelated.txt`, replacement, DataFactory),
    );
    const body = await quadsToTurtle(replacement);
    let reads = 0;
    m.setBefore((url, method) => {
      if (url === metadata && method === "PATCH") {
        m.files.set(root, { body, version: 9 });
      }
      if (stage === "failed verification read" && url === root && method === "GET" && ++reads === 2)
        return new Response(null, { status: 503 });
      return undefined;
    });
    const cause = new TypeError("PATCH response lost");
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (stage === "lost PATCH response" && init?.method === "PATCH") throw cause;
      return response;
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    if (stage === "lost PATCH response") expect(failure.cause).toBe(cause);
    else expect(failure.cause).toMatchObject({ name: "RdfFetchError", status: 503 });
    m.setBefore(undefined);
    const retried = await initializationFailure(failure.resume());
    expect(retried.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
    expect(m.calls.filter((call) => call.method === "PATCH").map((call) => call.status)).toEqual([
      205,
    ]);
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    false,
    true,
  ])("compares child identities after marking a created root (replaced: %s)", async (replaced) => {
    const m = memory();
    async function withChild(name: string) {
      const dataset = turtle(containerBody);
      new DriveContainer(root, dataset, DataFactory).contains.add(
        new DriveResource(`${root}${name}`, dataset, DataFactory),
      );
      return quadsToTurtle(dataset);
    }
    const original = await withChild("default.txt");
    const replacement = await withChild("unrelated.txt");
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      // Model a server-created child included in the creation representation/ETag.
      if (String(input) === root && init?.method === "PUT") {
        m.files.set(root, { body: original, version: 1 });
      }
      return response;
    };
    m.setBefore((url, method) => {
      if (replaced && url === metadata && method === "PATCH") {
        m.files.set(root, { body: replacement, version: 9 });
      }
      return undefined;
    });
    if (replaced) {
      const failure = await initializationFailure(ensureDriveRoot(fetch, options));
      expect(failure.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
      expect(m.indexWrites).toBe(0);
    } else {
      expect(await ensureDriveRoot(fetch, options)).toBe(root);
      expect(m.indexWrites).toBe(1);
    }
  });

  it.each([
    null,
    'W/"1"',
    '"1"',
  ])("conditions the advertised container PATCH on its strong validator (%s)", async (etag) => {
    const m = memory(409, storage, true);
    m.files.set(metadata, { body: "", version: 17 });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (String(input) === root && init?.method !== "PUT") {
        if (etag === null) response.headers.delete("ETag");
        else response.headers.set("ETag", etag);
      }
      return response;
    };
    expect(await ensureDriveRoot(fetch, options)).toBe(root);
    const patch = m.calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toBe(etag === '"1"' ? root : metadata);
    expect(patch?.headers.get("If-Match")).toBe(etag === '"1"' ? '"1"' : '"17"');
    expect(m.indexWrites).toBe(1);
  });

  it("keeps using the description when the container advertises only another PATCH format", async () => {
    const m = memory(409, storage, true);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (String(input) === root) response.headers.set("Accept-Patch", "application/sparql-update");
      return response;
    };
    expect(await ensureDriveRoot(fetch, options)).toBe(root);
    expect(m.calls.find((call) => call.method === "PATCH")?.url).toBe(metadata);
  });

  it("refuses a populated replacement when the container PATCH precondition fails", async () => {
    const m = memory(409, storage, true);
    const replacement = turtle(containerBody);
    new DriveContainer(root, replacement, DataFactory).contains.add(
      new DriveResource(`${root}unrelated.txt`, replacement, DataFactory),
    );
    const body = await quadsToTurtle(replacement);
    m.setBefore((url, method) => {
      if (url === root && method === "PATCH") m.files.set(root, { body, version: 9 });
      return undefined;
    });
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(failure.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
    const patches = m.calls.filter((call) => call.method === "PATCH");
    expect(patches.map((call) => call.status)).toEqual([412]);
    expect(patches[0]?.headers.get("If-Match")).toBe('"1"');
    expect(m.files.get(root)).toEqual({ body, version: 9 });
    expect(m.files.has(metadata)).toBe(false);
    expect(m.indexWrites).toBe(0);
  });

  it("bounds container PATCH precondition retries and resumes", async () => {
    const m = memory(409, storage, true);
    m.setBefore((url, method) =>
      url === root && method === "PATCH" ? new Response(null, { status: 412 }) : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(failure.cause).toMatchObject({ name: "DriveWriteError", status: 412, url: root });
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
    expect(m.indexWrites).toBe(0);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
    expect(m.indexWrites).toBe(1);
  });

  it("uses the description's strong ETag, independently of the container ETag", async () => {
    const m = memory();
    m.files.set(metadata, { body: "", version: 17 });
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    const patch = m.calls.find((call) => call.method === "PATCH");
    expect(patch?.headers.get("If-Match")).toBe('"17"');
    expect(patch?.headers.has("If-None-Match")).toBe(false);
  });

  it.each([
    "create",
    "update",
  ])("re-reads and retries once on a metadata %s race", async (operation) => {
    const m = memory();
    if (operation === "update") m.files.set(metadata, { body: "", version: 1 });
    const unrelated = DataFactory.quad(
      DataFactory.namedNode(root),
      DataFactory.namedNode("https://example.org/title"),
      DataFactory.literal("Keep me"),
    );
    const changed = await serialize([unrelated]);
    let race = true;
    m.setBefore((url, method) => {
      if (url === metadata && method === "PATCH" && race) {
        race = false;
        m.files.set(metadata, { body: changed, version: 12 });
      }
      return undefined;
    });
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    const patches = m.calls.filter((call) => call.method === "PATCH");
    expect(patches.map((call) => call.status)).toEqual([412, 205]);
    expect(patches[0]?.headers.get(operation === "create" ? "If-None-Match" : "If-Match")).toBe(
      operation === "create" ? "*" : '"1"',
    );
    expect(patches[1]?.headers.get("If-Match")).toBe('"12"');
    expect(turtle(m.files.get(metadata)?.body ?? "").has(unrelated)).toBe(true);
  });

  it("bounds metadata conflict retries and keeps the handle resumable", async () => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "PATCH" ? new Response(null, { status: 412 }) : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(failure.cause).toMatchObject({ status: 412, url: metadata });
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
    expect(m.indexWrites).toBe(0);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
  });

  it.each([403, 500])("does not treat unreadable metadata (%s) as absent", async (status) => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "GET" ? new Response(null, { status }) : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(failure.cause).toMatchObject({ name: "RdfFetchError", status });
    expect(m.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    null,
    'W/"1"',
    "unquoted",
  ])("refuses an unsafe description validator (%s)", async (etag) => {
    const m = memory();
    m.setBefore((url, method) => {
      if (url !== metadata || method !== "GET") return undefined;
      const headers = new Headers({ "Content-Type": "text/turtle" });
      if (etag !== null) headers.set("ETag", etag);
      return new Response("", { headers });
    });
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(String(failure.cause)).toContain("description needs a strong ETag");
    expect(m.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(m.indexWrites).toBe(0);
  });

  it.each([1, 2])("refuses a weak index validator at read %s", async (read) => {
    const m = memory();
    let reads = 0;
    m.setBefore((url, method) =>
      url === index && method === "GET" && ++reads === read
        ? new Response("", { headers: { "Content-Type": "text/turtle", ETag: 'W/"1"' } })
        : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow(
      "private Type Index needs a strong ETag",
    );
    expect(m.rootCreates).toBe(read - 1);
    expect(m.indexWrites).toBe(0);
    if (read === 1) expect(m.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("bootstraps against an N3-only server and does no writes on a second visit", async () => {
    const m = memory();
    expect(await ensureDriveRoot(m.fetch, { ...options, storageUrl: storage.slice(0, -1) })).toBe(
      root,
    );
    expect(
      new DriveResource(root, turtle(m.files.get(root)?.body ?? ""), DataFactory).isDriveRoot,
    ).toBe(true);
    expect(findDriveRoots(turtle(m.files.get(index)?.body ?? ""))).toEqual([root]);
    expect(
      m.calls
        .find((call) => call.url === root && call.method === "PUT")
        ?.headers.get("If-None-Match"),
    ).toBe("*");
    expect(
      m.calls.find((call) => call.url === index && call.method === "PUT")?.headers.get("If-Match"),
    ).toBe('"1"');
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    const patched = m.calls.findIndex((call) => call.method === "PATCH");
    const verified = m.calls.findIndex(
      (call, i) => i > patched && call.url === root && call.method === "GET",
    );
    const registered = m.calls.findIndex((call) => call.url === index && call.method === "PUT");
    expect(verified).toBeGreaterThan(patched);
    expect(registered).toBeGreaterThan(verified);
  });

  it.each([
    409, 412,
  ] as const)("converges under concurrent callers with %s conflicts", async (status) => {
    const m = memory(status);
    expect(
      await Promise.all(Array.from({ length: 8 }, () => ensureDriveRoot(m.fetch, options))),
    ).toEqual(Array(8).fill(root));
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
    const dataset = turtle(m.files.get(index)?.body ?? "");
    expect(dataset.match(null, DataFactory.namedNode(SOLID.instanceContainer), null).size).toBe(1);
    expect(m.calls.some((call) => call.url === root && call.status === status)).toBe(true);
  });

  it("finds legacy roots at non-default locations without creating drive/", async () => {
    const m = memory();
    const other = `${storage}old-drive/`;
    m.files.set(index, {
      body: `[] <${SOLID.forClass}> <https://w3id.org/jeswr/pod-drive#DriveRoot>; <${SOLID.instanceContainer}> <${other}>.`,
      version: 1,
    });
    expect(await ensureDriveRoot(m.fetch, options)).toBe(other);
    expect(m.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("preserves an occupied registration fragment and unrelated entries", async () => {
    const m = memory();
    const unrelated = `<${index}#poddrive> <${SOLID.forClass}> <https://example.org/Other>; <${SOLID.instanceContainer}> <${storage}other/>.`;
    m.files.set(index, { body: unrelated, version: 1 });
    await ensureDriveRoot(m.fetch, options);
    const dataset = turtle(m.files.get(index)?.body ?? "");
    expect(dataset.match(DataFactory.namedNode(`${index}#poddrive`), null, null).size).toBe(2);
    expect(dataset.match(DataFactory.namedNode(`${index}#poddrive-drive`), null, null).size).toBe(
      3,
    );
    expect(findDriveRoots(dataset)).toEqual([root]);
    expect(m.files.get(index)?.body).toContain(PODDRIVE.ns);
    expect(m.files.get(index)?.body).not.toContain("w3id.org");
  });

  it("re-reads and reapplies once on an index ETag race", async () => {
    const m = memory();
    let conflict = true;
    m.setBefore((url, method) => {
      if (url === index && method === "PUT" && conflict) {
        conflict = false;
        m.files.set(index, {
          body: `<${index}#unrelated> <https://example.org/name> "Keep me".`,
          version: 2,
        });
        return new Response(null, { status: 412 });
      }
      return undefined;
    });
    await ensureDriveRoot(m.fetch, options);
    expect(m.files.get(index)?.body).toContain("Keep me");
    expect(m.calls.filter((call) => call.url === index && call.method === "PUT")).toHaveLength(2);
  });

  it("accepts another caller's registration on the conflict re-read", async () => {
    const m = memory();
    const body = await registration();
    m.setBefore((url, method) => {
      if (url === index && method === "PUT") {
        m.files.set(index, { body, version: 2 });
        return new Response(null, { status: 412 });
      }
      return undefined;
    });
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(m.calls.filter((call) => call.url === index && call.method === "PUT")).toHaveLength(1);
  });

  it.each([412, 403, 500])("bounds index retry and propagates status %s", async (status) => {
    const m = memory();
    m.setBefore((url, method) =>
      url === index && method === "PUT" ? new Response(null, { status }) : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({
      name: "DriveWriteError",
      status,
      url: index,
    });
    expect(m.calls.filter((call) => call.url === index && call.method === "PUT")).toHaveLength(
      status === 412 ? 2 : 1,
    );
  });

  it.each([
    403, 409, 507,
  ])("propagates container creation failure %s without registration", async (status) => {
    const m = memory();
    m.setBefore((url, method) =>
      url === root && method === "PUT" ? new Response(null, { status }) : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({
      name: "DriveWriteError",
      status,
      url: root,
    });
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    409, 412,
  ] as const)("refuses a non-container at the root path after %s", async (status) => {
    const m = memory(status);
    m.files.set(root, { body: "", version: 1 });
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({
      status,
      url: root,
    });
    expect(m.indexWrites).toBe(0);
    expect(m.files.get(root)?.body).toBe("");
    expect(m.calls.some((call) => call.method === "PATCH" || call.method === "DELETE")).toBe(false);
  });

  it.each([
    409, 412,
  ] as const)("recovers after registration failure with %s on the next PUT", async (status) => {
    const m = memory(status);
    m.setBefore((url, method) =>
      url === index && method === "PUT" ? new Response(null, { status: 500 }) : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow();
    m.setBefore(undefined);
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it.each([403, 409, 500])("preserves a failed metadata PATCH (%s) and resumes", async (status) => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "PATCH" ? new Response(null, { status }) : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(failure.cause).toMatchObject({ name: "DriveWriteError", status, url: metadata });
    expect(m.indexWrites).toBe(0);
    expect(m.files.has(root)).toBe(true);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
    expect(await failure.resume()).toBe(root);
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
  });

  it.each([409, 412] as const)("resumes a failed initial GET with %s conflicts", async (status) => {
    const m = memory(status);
    let reads = 0;
    m.setBefore((url, method) =>
      url === root && method === "GET" && ++reads === 1
        ? new Response(null, { status: 503 })
        : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(failure.cause).toMatchObject({ name: "RdfFetchError", status: 503 });
    expect(reads).toBe(1);
    expect(m.files.has(root)).toBe(true);
    expect(await failure.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
  });

  it("keeps repeated initialization failures resumable", async () => {
    const m = memory();
    let reads = 0;
    m.setBefore((url, method) =>
      url === root && method === "GET"
        ? new Response(null, { status: ++reads === 1 ? 503 : 403 })
        : undefined,
    );
    const first = await initializationFailure(ensureDriveRoot(m.fetch, options));
    const second = await initializationFailure(first.resume());
    expect(first.cause).toMatchObject({ status: 503 });
    expect(second.cause).toMatchObject({ status: 403 });
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    m.setBefore(undefined);
    expect(await second.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
  });

  it("retains the original transport error as the resumable failure's cause", async () => {
    const m = memory();
    const cause = new TypeError("Disconnected");
    let disconnected = true;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.method === "PATCH" && disconnected) throw cause;
      return m.fetch(input, init);
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    expect(failure.cause).toBe(cause);
    expect(m.files.has(root)).toBe(true);
    disconnected = false;
    expect(await failure.resume()).toBe(root);
    expect(m.rootCreates).toBe(1);
  });

  it.each([
    "lost response",
    "verification read",
  ])("resumes a persisted marker after %s", async (stage) => {
    const m = memory();
    const cause = new TypeError("Response lost");
    let reads = 0;
    m.setBefore((url, method) =>
      stage === "verification read" && url === root && method === "GET" && ++reads === 2
        ? new Response(null, { status: 503 })
        : undefined,
    );
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (stage === "lost response" && init?.method === "PATCH") throw cause;
      return response;
    };
    const failure = await initializationFailure(ensureDriveRoot(fetch, options));
    expect(
      new DriveResource(root, turtle(m.files.get(root)?.body ?? ""), DataFactory).isDriveRoot,
    ).toBe(true);
    expect(await failure.resume()).toBe(root);
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it.each([
    "ACL",
    "description",
  ])("preserves independently changed %s despite a matching creation ETag", async (auxiliary) => {
    const m = memory();
    const url = auxiliary === "ACL" ? `${root}.acl` : metadata;
    const changed = {
      body: `<${root}> <https://example.org/value> "Keep auxiliary state".`,
      version: 2,
    };
    m.setBefore((target, method) => {
      if (target === metadata && method === "PATCH") {
        m.files.set(url, changed);
        return new Response(null, { status: 503 });
      }
      return undefined;
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await m.fetch(input, init);
      if (String(input) === root && init?.method === "PUT") response.headers.set("ETag", '"1"');
      return response;
    };
    const result: unknown = await ensureDriveRoot(fetch, options).catch((error: unknown) => error);
    // Auxiliary writes do not change the container representation or validator.
    expect(m.files.get(root)).toEqual({ body: containerBody, version: 1 });
    expect(
      [...turtle(changed.body)].every((quad) => turtle(m.files.get(url)?.body ?? "").has(quad)),
    ).toBe(true);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(m.indexWrites).toBe(0);
    expect(result).toBeInstanceOf(DriveRootInitializationError);
    if (!(result instanceof DriveRootInitializationError))
      throw new Error("Expected resume handle");
    m.setBefore(undefined);
    expect(await result.resume()).toBe(root);
    expect(
      [...turtle(changed.body)].every((quad) => turtle(m.files.get(url)?.body ?? "").has(quad)),
    ).toBe(true);
    expect(m.rootCreates).toBe(1);
  });

  it.each([
    "metadata",
    "child",
  ])("checks ownership after a concurrent %s change", async (change) => {
    const m = memory();
    const added =
      change === "metadata"
        ? `<${root}> <https://example.org/title> "Keep me".`
        : `<${root}> <${LDP.contains}> <${root}file.txt>.`;
    m.setBefore((url, method) => {
      if (url === metadata && method === "PATCH") {
        m.files.set(root, { body: `${containerBody}\n${added}`, version: 2 });
        return new Response(null, { status: 500 });
      }
      return undefined;
    });
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(m.files.get(root)?.body).toContain(added);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    m.setBefore(undefined);
    if (change === "child") {
      const rejected = await initializationFailure(failure.resume());
      expect(rejected.cause).toMatchObject({ name: "DriveWriteError", status: 409, url: root });
      expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
      expect(m.files.get(root)?.version).toBe(2);
      expect(m.indexWrites).toBe(0);
    } else {
      expect(await failure.resume()).toBe(root);
      expect(m.indexWrites).toBe(1);
    }
    const dataset = turtle(m.files.get(root)?.body ?? "");
    expect([...turtle(added)].every((quad) => dataset.has(quad))).toBe(true);
  });

  it.each([null, 'W/"1"'])("resumes without a strong container validator (%s)", async (etag) => {
    const m = memory();
    m.setBefore((url, method) => {
      if (url === root && method === "GET") {
        const headers = new Headers({
          "Content-Type": "text/turtle",
          Link: '<description>; rel="describedby"',
        });
        if (etag !== null) headers.set("ETag", etag);
        return new Response(containerBody, { headers });
      }
      return url === metadata && method === "PATCH"
        ? new Response(null, { status: 500 })
        : undefined;
    });
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(m.files.has(root)).toBe(true);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
  });

  it("verifies that a successful PATCH actually persisted the marker", async () => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "PATCH" ? new Response(null, { status: 204 }) : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(String(failure.cause)).toContain("marker was not persisted");
    expect(m.indexWrites).toBe(0);
    expect(m.files.has(root)).toBe(true);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
  });

  it.each([
    null,
    '<description>; title="rel=describedby"',
    "<description>; rel=type",
    '<description>; rel=""',
  ])("refuses missing metadata discovery (%s) and allows resuming", async (link) => {
    const m = memory();
    m.setBefore((url, method) => {
      if (url !== root || method !== "GET") return undefined;
      const headers = new Headers({ "Content-Type": "text/turtle", ETag: '"1"' });
      if (link !== null) headers.set("Link", link);
      return new Response(containerBody, { headers });
    });
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(String(failure.cause)).toContain("needs a describedby link");
    expect(m.calls.some((call) => call.method === "PATCH" || call.method === "DELETE")).toBe(false);
    expect(m.indexWrites).toBe(0);
    expect(m.files.has(root)).toBe(true);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
  });

  it("finds relative metadata links among other links and multi-valued relations", async () => {
    const m = memory();
    let reads = 0;
    m.setBefore((url, method) => {
      if (url !== root || method !== "GET" || reads++ > 0) return undefined;
      return new Response(containerBody, {
        headers: {
          "Content-Type": "text/turtle",
          Link: '<https://example.org/a,b>; rel=type; title="a,b", <description>; title="metadata"; rel="other describedby"',
        },
      });
    });
    expect(await ensureDriveRoot(m.fetch, options)).toBe(root);
    expect(m.calls.some((call) => call.url === metadata && call.method === "PATCH")).toBe(true);
  });

  it("rejects a foreign metadata link before sending a PATCH", async () => {
    const m = memory();
    m.setBefore((url, method) =>
      url === root && method === "GET"
        ? new Response(containerBody, {
            headers: {
              "Content-Type": "text/turtle",
              Link: "<https://evil.example/meta>; rel=describedby",
              ETag: '"1"',
            },
          })
        : undefined,
    );
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(m.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(m.indexWrites).toBe(0);
    expect(m.files.has(root)).toBe(true);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
  });

  it("converges when a second caller adopts an empty container during initialization", async () => {
    const m = memory();
    let release: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === metadata && init?.method === "PATCH") await waiting;
      const response = await m.fetch(input, init);
      if (
        String(input) === root &&
        init?.method !== "PUT" &&
        m.calls.some((call) => call.status === 409)
      ) {
        release?.();
      }
      return response;
    };
    expect(
      await Promise.all([ensureDriveRoot(fetch, options), ensureDriveRoot(fetch, options)]),
    ).toEqual([root, root]);
    expect(m.rootCreates).toBe(1);
    expect(m.indexWrites).toBe(1);
    expect(m.calls.filter((call) => call.method === "PATCH" && call.status === 205)).toHaveLength(
      1,
    );
  });

  it("propagates an unreadable existing container after a conflict", async () => {
    const m = memory();
    m.files.set(root, { body: containerBody, version: 1 });
    m.setBefore((url, method) =>
      url === root && method === "GET" ? new Response(null, { status: 403 }) : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({
      name: "RdfFetchError",
      status: 403,
    });
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    401, 403, 404, 500,
  ])("does not bootstrap an unreadable/missing private index (%s)", async (status) => {
    const m = memory();
    m.setBefore(() => new Response(null, { status }));
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toBeInstanceOf(RdfFetchError);
    expect(m.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it.each([1, 2])("refuses an index without a strong ETag at read %s", async (read) => {
    const m = memory();
    let reads = 0;
    m.setBefore((url, method) => {
      if (url === index && method === "GET" && ++reads === read) {
        return new Response("", { headers: { "Content-Type": "text/turtle" } });
      }
      return undefined;
    });
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow("needs a strong ETag");
    expect(m.indexWrites).toBe(0);
    expect(m.rootCreates).toBe(read - 1);
  });

  it("rejects foreign index URLs and registered roots before using credentials", async () => {
    const m = memory();
    await expect(
      ensureDriveRoot(m.fetch, { ...options, typeIndexUrl: "https://evil.example/index" }),
    ).rejects.toThrow();
    expect(m.calls).toEqual([]);
    m.files.set(index, { body: await registration("https://evil.example/root/"), version: 1 });
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow();
    expect(m.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("refuses redirects instead of following them outside the pod", async () => {
    const m = memory();
    m.setBefore(
      () =>
        new Response(null, { status: 302, headers: { Location: "https://evil.example/index" } }),
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow();
    expect(m.calls).toHaveLength(1);
  });
});

it("round 61: root creation binds the successful PUT endpoint when 404 omits Link", async () => {
  const { aclBody } = await import("../drive-wac-pod");
  const m = memory();
  const policy = await aclBody(storage, true);
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith(".policy"))
      return new Response(url === `${storage}.policy` ? policy : null, {
        status: url === `${storage}.policy` ? 200 : 404,
        headers: { "content-type": "text/turtle", etag: '"policy"' },
      });
    const response = url === storage ? new Response(null) : await m.fetch(input, init);
    response.headers.delete("x-solid-demo-access-control");
    if (response.ok) response.headers.append("link", `<${url}.policy>; rel="acl"`);
    return response;
  };
  expect(await ensureDriveRoot(http, options)).toBe(root);
});
