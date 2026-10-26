// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { DriveResource } from "../../src/apps/drive/lib/model/model.js";
import { ensureDriveRoot } from "../../src/apps/drive/lib/model/root.js";
import { quadsToTurtle } from "../../src/apps/drive/lib/model/serialize.js";
import {
  buildDriveRootRegistration,
  findDriveRoots,
} from "../../src/apps/drive/lib/model/type-index.js";
import { LDP, PODDRIVE, SOLID } from "../../src/apps/drive/lib/model/vocab.js";
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
        expect(headers.get("Content-Type")).toBe("application/sparql-update");
        const inserts = /^INSERT DATA \{([\s\S]*)\}$/.exec(String(init?.body));
        expect(inserts).not.toBeNull();
        const current = files.get(root);
        if (!current) throw new Error("Missing container");
        const dataset = turtle(current.body);
        dataset.addQuads([...turtle(inserts?.[1] ?? "")]);
        files.set(root, { body: await quadsToTurtle(dataset), version: current.version + 1 });
        response = new Response(null, { status: 205 });
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

describe("ensureDriveRoot", () => {
  it("creates and marks the root, registers privately, and does no writes on a second visit", async () => {
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

  it.each([
    403, 409, 500,
  ])("propagates metadata PATCH failure %s without registration", async (status) => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "PATCH" ? new Response(null, { status }) : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toMatchObject({
      name: "DriveWriteError",
      status,
      url: metadata,
    });
    expect(m.indexWrites).toBe(0);
  });

  it("verifies that a successful PATCH actually persisted the marker", async () => {
    const m = memory();
    m.setBefore((url, method) =>
      url === metadata && method === "PATCH" ? new Response(null, { status: 204 }) : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow("marker was not persisted");
    expect(m.indexWrites).toBe(0);
  });

  it.each([
    null,
    '<description>; title="rel=describedby"',
    "<description>; rel=type",
    '<description>; rel=""',
  ])("refuses missing metadata discovery (%s)", async (link) => {
    const m = memory();
    m.setBefore((url, method) => {
      if (url !== root || method !== "GET") return undefined;
      const headers = new Headers({ "Content-Type": "text/turtle" });
      if (link !== null) headers.set("Link", link);
      return new Response(containerBody, { headers });
    });
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow("needs a describedby link");
    expect(m.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(m.indexWrites).toBe(0);
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
            },
          })
        : undefined,
    );
    await expect(ensureDriveRoot(m.fetch, options)).rejects.toThrow();
    expect(m.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(m.indexWrites).toBe(0);
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
