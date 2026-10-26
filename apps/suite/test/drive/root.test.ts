// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { DriveResource } from "../../src/apps/drive/lib/model/model.js";
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
const containerBody = `<${root}> a <${LDP.BasicContainer}>.`;
const index = `${storage}settings/private.ttl`;
const options = { storageUrl: storage, typeIndexUrl: index };

/** CSS-style storage: ignores container PUT bodies and PATCHes linked metadata only. */
function memory(existingStatus: 409 | 412 = 409) {
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
    let response = before?.(url, method);
    if (!response) {
      const file = files.get(url);
      if (method === "GET") {
        response = file
          ? new Response(file.body, {
              headers: {
                "Content-Type": "text/turtle",
                ETag: `"${file.version}"`,
                ...(url === root ? { Link: `<description>; rel="describedby"` } : {}),
              },
            })
          : new Response(null, { status: 404 });
      } else if (method === "PUT") {
        if (!headers.has("If-Match") && !headers.has("If-None-Match"))
          throw new TypeError("Unconditional write");
        if (url === root && file) {
          response = new Response(null, { status: existingStatus });
        } else if (
          (headers.get("If-None-Match") === "*" && file) ||
          (headers.has("If-Match") && headers.get("If-Match") !== `"${file?.version}"`)
        ) {
          response = new Response(null, { status: 412 });
        } else {
          files.set(url, {
            body: url === root ? containerBody : String(init?.body),
            version: (file?.version ?? 0) + 1,
          });
          if (url === index) indexWrites++;
          if (url === root) rootCreates++;
          response = new Response(null, { status: 201 });
        }
      } else if (method === "PATCH" && url === metadata) {
        // A conforming server need only support N3 Patch, not SPARQL Update.
        if (headers.get("Content-Type") !== "text/n3") {
          response = new Response(null, { status: 415 });
        } else {
          const patch = new Store(
            new Parser({ format: "N3", baseIRI: url }).parse(String(init?.body)),
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
          expect(patch.getQuads(null, null, null, DataFactory.defaultGraph())).toHaveLength(2);
          const current = files.get(root);
          if (!current) throw new Error("Missing container");
          const dataset = turtle(current.body);
          // Apply the parsed insertion formula to the target document's default graph.
          for (const quad of patch.match(null, null, null, insert.object)) {
            expect(quad.subject.termType).toBe("NamedNode");
            expect(quad.object.termType).toBe("NamedNode");
            dataset.addQuad(quad.subject, quad.predicate, quad.object);
          }
          files.set(root, { body: await quadsToTurtle(dataset), version: current.version + 1 });
          response = new Response(null, { status: 205 });
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

  it.each([409, 412] as const)("refuses an unmarked occupied path after %s", async (status) => {
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
    // A fresh caller cannot claim the preserved, unmarked container.
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({ status: 409 });
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
    expect(m.files.get(url)).toEqual(changed);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(m.indexWrites).toBe(0);
    expect(result).toBeInstanceOf(DriveRootInitializationError);
    if (!(result instanceof DriveRootInitializationError))
      throw new Error("Expected resume handle");
    m.setBefore(undefined);
    expect(await result.resume()).toBe(root);
    expect(m.files.get(url)).toEqual(changed);
    expect(m.rootCreates).toBe(1);
  });

  it.each(["metadata", "child"])("preserves concurrent %s while resuming", async (change) => {
    const m = memory();
    const added =
      change === "metadata"
        ? `<${root}> <https://example.org/title> "Keep me".`
        : `<${root}> <${LDP.contains}> <${root}file.txt>.`;
    m.setBefore((url, method) => {
      if (url === metadata && method === "PATCH") {
        m.files.set(root, { body: `${containerBody}\n${added}`, version: 1 });
        return new Response(null, { status: 500 });
      }
      return undefined;
    });
    const failure = await initializationFailure(ensureDriveRoot(m.fetch, options));
    expect(m.files.get(root)?.body).toContain(added);
    expect(m.calls.some((call) => call.method === "DELETE")).toBe(false);
    m.setBefore(undefined);
    expect(await failure.resume()).toBe(root);
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

  it("allows the winning caller time to persist its marker after a 409", async () => {
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
    expect(m.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
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

  it.each([1, 2])("refuses an index without an ETag at read %s", async (read) => {
    const m = memory();
    let reads = 0;
    m.setBefore((url, method) => {
      if (url === index && method === "GET" && ++reads === read) {
        return new Response("", { headers: { "Content-Type": "text/turtle" } });
      }
      return undefined;
    });
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow("needs an ETag");
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
