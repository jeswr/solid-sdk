// AUTHORED-BY GPT-5.6 Sol via codex

import type { GeneratedInstance, SyntheticRdfResult } from "@jeswr/synthetic-rdf";
import type { Quad } from "@rdfjs/types";
import { AclResource } from "@solid/object";
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { type PodLayout, type ResourceExpander, SeedError, seedPods } from "../src/index.js";
import { MemoryPod, MemoryProvisioner } from "./helpers.js";

const { literal, namedNode, quad } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const PERSON = namedNode("https://vocab.example/Person");
const FRIEND = namedNode("https://vocab.example/friend");
const NAME = namedNode("https://vocab.example/name");
const SHAPE = namedNode("https://shapes.example/PersonShape");
const EXTERNAL = namedNode("https://identity.example/carol#me");

function generatedData(unmapped = false): SyntheticRdfResult {
  const alice = namedNode("urn:synthetic:person/0#alice");
  const bob = namedNode("urn:synthetic:person/1");
  const aliceQuads: Quad[] = [
    quad(alice, RDF_TYPE, PERSON),
    quad(alice, NAME, literal("Alice")),
    quad(alice, FRIEND, bob),
    quad(alice, FRIEND, EXTERNAL),
  ];
  if (unmapped) aliceQuads.push(quad(alice, FRIEND, namedNode("urn:synthetic:missing/9")));
  const bobQuads: Quad[] = [quad(bob, RDF_TYPE, PERSON), quad(bob, NAME, literal("Bob"))];
  const instances: GeneratedInstance[] = [
    { shape: SHAPE, index: 0, focus: alice, quads: aliceQuads },
    { shape: SHAPE, index: 1, focus: bob, quads: bobQuads },
  ];
  const dataset = new Store([...aliceQuads, ...bobQuads]);
  return {
    dataset,
    instances,
    toTurtle: () => "unused by solid-seed",
  };
}

function instanceResources() {
  return [
    {
      path: "/mortgage/people/alice",
      source: { instance: { shape: SHAPE.value, index: 0 } },
    },
    {
      path: "/mortgage/people/bob",
      source: { instance: { shape: SHAPE.value, index: 1 } },
    },
  ] as const;
}

describe("pod layouts and modes", () => {
  it("provisions a multi-pod layout with nested resources and exact content types", async () => {
    const provisioner = new MemoryProvisioner();
    const layout: PodLayout = {
      pods: [
        {
          account: { provision: {} },
          resources: [
            {
              path: "/mortgage/applications/current",
              source: { body: "application" },
            },
          ],
        },
        {
          account: { provision: { webid: "https://id.example/lender#me" } },
          resources: [
            {
              path: "/mortgage/credentials/income",
              source: { body: '{"type":"VerifiableCredential"}' },
              contentType: "application/ld+json",
            },
          ],
        },
      ],
    };

    const manifest = await seedPods({ layout, provisioner });

    expect(provisioner.targets).toHaveLength(2);
    expect(manifest.pods.map((pod) => pod.resources[0]?.status)).toEqual(["created", "created"]);
    expect(
      provisioner.targets[1]?.resources.get("https://pod-2.example/mortgage/credentials/income"),
    ).toEqual({
      body: '{"type":"VerifiableCredential"}',
      contentType: "application/ld+json",
    });
  });

  it("fails create re-seeding, skips ensure, and makes replace byte-convergent", async () => {
    const pod = new MemoryPod("https://pod.example");
    const layout: PodLayout = {
      pods: [
        {
          account: { target: pod },
          resources: [{ path: "/data/item", source: { body: "stable bytes" } }],
        },
      ],
    };
    await seedPods({ layout });
    const before = pod.resources.get("https://pod.example/data/item")?.body;

    await expect(seedPods({ layout })).rejects.toMatchObject({
      name: "SeedError",
      manifest: {
        pods: [{ resources: [{ status: "failed" }] }],
      },
    });
    await expect(seedPods({ layout, mode: "ensure" })).resolves.toMatchObject({
      pods: [{ resources: [{ status: "skipped" }] }],
    });
    await expect(seedPods({ layout, mode: "replace" })).resolves.toMatchObject({
      pods: [{ resources: [{ status: "replaced" }] }],
    });
    expect(pod.resources.get("https://pod.example/data/item")?.body).toBe(before);
  });
});

describe("expander groups", () => {
  function groupLayout(
    pod: MemoryPod,
    expansionCount: { value: number },
    publicRead = true,
  ): PodLayout {
    const issueOnce: ResourceExpander = () => {
      expansionCount.value += 1;
      return ["vc", "anchor", "witness"].map((name) => ({
        path: `/credentials/${name}`,
        source: { body: `issued-${name}` },
        access: { publicRead },
      }));
    };
    return { pods: [{ account: { target: pod }, resources: [issueOnce] }] };
  }

  it("materializes once, conditionally creates every member, and skips only an all-present group", async () => {
    const pod = new MemoryPod("https://pod.example");
    const count = { value: 0 };
    const layout = groupLayout(pod, count);

    const created = await seedPods({ layout });
    expect(count.value).toBe(1);
    expect(created.pods[0]?.groups).toEqual([
      {
        id: "group-0",
        members: ["/credentials/vc", "/credentials/anchor", "/credentials/witness"],
        status: "written",
      },
    ]);
    // Every creating PUT (placeholder, owner-only ACL) is conditional; the data PUT
    // then fills the placeholder this run just created, and the public grant
    // replaces the owner-only ACL this run just wrote.
    const seen = new Set<string>();
    for (const record of pod.putRecords()) {
      const conditional = record.headers.get("if-none-match") === "*";
      const first = !seen.has(record.url);
      seen.add(record.url);
      expect(conditional).toBe(first);
    }

    const ensured = await seedPods({ layout, mode: "ensure" });
    expect(count.value).toBe(2);
    expect(ensured.pods[0]?.groups[0]?.status).toBe("skipped");
    expect(ensured.pods[0]?.resources.map((value) => value.status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("rejects a partially existing ensure group and names its offending members", async () => {
    const pod = new MemoryPod("https://pod.example");
    await pod.authFetch("https://pod.example/credentials/vc", {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "old",
    });
    const layout = groupLayout(pod, { value: 0 });

    const error = await seedPods({ layout, mode: "ensure" }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SeedError);
    expect(error).toMatchObject({
      message: expect.stringContaining("existing members: /credentials/vc"),
      manifest: {
        pods: [
          {
            groups: [{ id: "group-0", status: "partial" }],
            resources: [
              { path: "/credentials/vc", status: "failed" },
              { path: "/credentials/anchor", status: "unwritten" },
              { path: "/credentials/witness", status: "unwritten" },
            ],
          },
        ],
      },
    });
    expect(pod.putRecords()).toHaveLength(1);
  });

  it("treats a missing group ACL as inconsistent instead of skipping the group", async () => {
    const pod = new MemoryPod("https://pod.example");
    const layout = groupLayout(pod, { value: 0 });
    await seedPods({ layout });
    pod.resources.delete("https://pod.example/credentials/anchor.acl");

    await expect(seedPods({ layout, mode: "ensure" })).rejects.toMatchObject({
      message: expect.stringContaining("missing members: /credentials/anchor.acl"),
      manifest: { pods: [{ groups: [{ id: "group-0", status: "partial" }] }] },
    });
  });

  it("converges ACL policy while skipping an all-present group", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: groupLayout(pod, { value: 0 }) });

    const ensured = await seedPods({
      layout: groupLayout(pod, { value: 0 }, false),
      mode: "ensure",
    });
    expect(ensured.pods[0]?.groups[0]?.status).toBe("skipped");
    const aclUrl = "https://pod.example/credentials/anchor.acl";
    const body = pod.resources.get(aclUrl)?.body;
    const dataset = new Store(
      new Parser({ format: "text/turtle", baseIRI: aclUrl }).parse(body as string),
    );
    expect(
      [...new AclResource(dataset, DataFactory).authorizations].some(
        (authorization) => authorization.accessibleToAny,
      ),
    ).toBe(false);
  });

  it("reports a mid-group abort and converges after a replace re-run", async () => {
    const pod = new MemoryPod("https://pod.example");
    const count = { value: 0 };
    const layout = groupLayout(pod, count);
    pod.failNextPut("/credentials/anchor");

    const error = await seedPods({ layout }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(SeedError);
    expect(error).toMatchObject({
      message: expect.stringContaining("repair with a replace re-run"),
      manifest: {
        pods: [
          {
            groups: [{ id: "group-0", status: "partial" }],
            resources: [
              { path: "/credentials/vc", status: "created" },
              { path: "/credentials/anchor", status: "failed" },
              { path: "/credentials/witness", status: "unwritten" },
            ],
          },
        ],
      },
    });

    const repaired = await seedPods({ layout, mode: "replace" });
    expect(count.value).toBe(2);
    expect(repaired.pods[0]?.groups[0]?.status).toBe("written");
    expect(repaired.pods[0]?.resources.map((value) => value.status)).toEqual([
      "replaced",
      "replaced",
      "replaced",
    ]);
    expect(
      [...pod.resources.entries()]
        .filter(([url]) => url.includes("/credentials/") && !url.endsWith(".acl"))
        .map(([url, resource]) => [new URL(url).pathname, resource.body]),
    ).toEqual([
      ["/credentials/vc", "issued-vc"],
      ["/credentials/anchor", "issued-anchor"],
      ["/credentials/witness", "issued-witness"],
    ]);
  });
});

describe("RDF rebasing and typed ACLs", () => {
  it("rebases cross-instance references, preserves externals, and emits origin-portable bodies", async () => {
    const first = new MemoryPod("https://one.example");
    const second = new MemoryPod("https://two.example");
    const layout: PodLayout = {
      pods: [
        { account: { target: first }, resources: instanceResources() },
        { account: { target: second }, resources: instanceResources() },
      ],
    };
    await seedPods({ layout, data: generatedData() });

    const firstAlice = first.resources.get("https://one.example/mortgage/people/alice")?.body;
    const secondAlice = second.resources.get("https://two.example/mortgage/people/alice")?.body;
    expect(firstAlice).toBe(secondAlice);
    expect(firstAlice).toContain("<#alice>");
    expect(firstAlice).toContain("<bob#it>");
    expect(firstAlice).toContain(`<${EXTERNAL.value}>`);
    expect(firstAlice).not.toContain("urn:synthetic:");
  });

  it("rejects an unmapped placeholder before writing", async () => {
    const pod = new MemoryPod("https://pod.example");
    const layout: PodLayout = {
      pods: [{ account: { target: pod }, resources: instanceResources() }],
    };
    await expect(seedPods({ layout, data: generatedData(true) })).rejects.toThrow(
      "Unmapped placeholder-base IRI",
    );
    expect(pod.putRecords()).toHaveLength(0);
  });

  it("materializes every pod before the first write", async () => {
    const first = new MemoryPod("https://one.example");
    const second = new MemoryPod("https://two.example");
    const layout: PodLayout = {
      pods: [
        {
          account: { target: first },
          resources: [{ path: "/ready", source: { body: "must remain unwritten" } }],
        },
        { account: { target: second }, resources: instanceResources() },
      ],
    };

    await expect(seedPods({ layout, data: generatedData(true) })).rejects.toThrow(
      "Unmapped placeholder-base IRI",
    );
    expect(first.putRecords()).toHaveLength(0);
    expect(second.putRecords()).toHaveLength(0);
  });

  it("authors ACLs through typed wrappers and always preserves owner control", async () => {
    const pod = new MemoryPod("https://pod.example");
    const lender = "https://id.example/lender#me";
    const layout: PodLayout = {
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/private/report",
              source: { body: "report" },
              access: {
                publicRead: true,
                agents: [{ webid: lender, modes: ["read", "append"] }],
              },
            },
          ],
        },
      ],
    };
    await seedPods({ layout });

    const aclUrl = "https://pod.example/private/report.acl";
    const body = pod.resources.get(aclUrl)?.body;
    expect(body).toBeDefined();
    const dataset = new Store(
      new Parser({ format: "text/turtle", baseIRI: aclUrl }).parse(body as string),
    );
    const acl = new AclResource(dataset, DataFactory);
    const authorizations = [...acl.authorizations];
    const owner = authorizations.find((value) => [...value.agent].includes(pod.webid));
    const agent = authorizations.find((value) => [...value.agent].includes(lender));
    const publicRule = authorizations.find((value) => value.accessibleToAny);

    expect(owner).toMatchObject({
      accessTo: "https://pod.example/private/report",
      canRead: true,
      canWrite: true,
      canReadWriteAcl: true,
    });
    expect(agent).toMatchObject({ canRead: true, canAppend: true, canWrite: false });
    expect(publicRule).toMatchObject({ canRead: true, canWrite: false });
  });

  it("repairs a missing standalone ACL while ensuring an existing resource, but only to narrow it", async () => {
    const pod = new MemoryPod("https://pod.example");
    const layout = (publicRead: boolean): PodLayout => ({
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/private/report",
              source: { body: "report" },
              access: { publicRead },
            },
          ],
        },
      ],
    });
    await seedPods({ layout: layout(true) });
    pod.resources.delete("https://pod.example/private/report.acl");

    // A missing ACL grants nothing this seeder can vouch for, so ensure will not
    // publish the existing content; replace rewrites it under the grants.
    await expect(seedPods({ layout: layout(true), mode: "ensure" })).rejects.toThrow(SeedError);
    expect(pod.resources.has("https://pod.example/private/report.acl")).toBe(false);
    await expect(seedPods({ layout: layout(false), mode: "ensure" })).resolves.toMatchObject({
      pods: [{ resources: [{ path: "/private/report", status: "skipped" }] }],
    });
    expect(pod.resources.has("https://pod.example/private/report.acl")).toBe(true);
    expect(pod.putRecords("/private/report.acl").at(-1)?.headers.get("if-none-match")).toBeNull();
  });

  it("removes stale standalone ACL grants while leaving the existing resource unchanged", async () => {
    const pod = new MemoryPod("https://pod.example");
    const layout = (publicRead: boolean): PodLayout => ({
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/private/report",
              source: { body: "stable report" },
              access: { publicRead },
            },
          ],
        },
      ],
    });
    await seedPods({ layout: layout(true) });

    const ensured = await seedPods({ layout: layout(false), mode: "ensure" });

    expect(ensured.pods[0]?.resources[0]?.status).toBe("skipped");
    expect(pod.resources.get("https://pod.example/private/report")?.body).toBe("stable report");
    const aclUrl = "https://pod.example/private/report.acl";
    const body = pod.resources.get(aclUrl)?.body;
    expect(body).toBeDefined();
    const dataset = new Store(
      new Parser({ format: "text/turtle", baseIRI: aclUrl }).parse(body as string),
    );
    expect(
      [...new AclResource(dataset, DataFactory).authorizations].some(
        (authorization) => authorization.accessibleToAny,
      ),
    ).toBe(false);
    // create: owner-only, then the public grant after the data; ensure: reconciled once.
    expect(pod.putRecords("/private/report.acl")).toHaveLength(3);
    expect(pod.putRecords("/private/report.acl").at(-1)?.headers.get("if-none-match")).toBeNull();
  });

  it("rejects an ACL agent IRI that could escape Turtle serialization", async () => {
    const pod = new MemoryPod("https://pod.example");
    await expect(
      seedPods({
        layout: {
          pods: [
            {
              account: { target: pod },
              resources: [
                {
                  path: "/private/report",
                  source: { body: "report" },
                  access: {
                    agents: [
                      {
                        webid:
                          "https://evil.example/> <https://evil.example/s> <https://evil.example/o>",
                        modes: ["read"],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow("injection-safe absolute HTTP(S) IRI");
    expect(pod.putRecords()).toHaveLength(0);
  });
});

describe("access-controlled resources: the ACL lands before any data", () => {
  const Secret = "https://pod.example/public/secret";
  const layout = (pod: MemoryPod): PodLayout => ({
    pods: [
      {
        account: { target: pod },
        resources: [
          {
            path: "/public/secret",
            source: { body: "private data" },
            access: { publicRead: false },
          },
        ],
      },
    ],
  });

  it("creates an empty placeholder, writes the ACL, then writes the data", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: layout(pod) });
    const writes = pod.requests
      .filter((r) => r.method === "PUT")
      .map((r) => [new URL(r.url).pathname, r.body === "" ? "empty" : "data"]);
    expect(writes).toEqual([
      ["/public/secret", "empty"],
      ["/public/secret.acl", "data"],
      ["/public/secret", "data"],
    ]);
    expect(pod.resources.get(Secret)?.body).toBe("private data");
  });

  it("a failed ACL write removes the placeholder and never writes the data", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret.acl", 500);
    await expect(seedPods({ layout: layout(pod) })).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.has(Secret)).toBe(false);
    expect(pod.putRecords("/public/secret").every((r) => r.body === "")).toBe(true);
  });

  it("a stale ACL in create mode fails without leaving data behind", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.resources.set(`${Secret}.acl`, { body: "# stale", contentType: "text/turtle" });
    await expect(seedPods({ layout: layout(pod) })).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.has(Secret)).toBe(false);
  });

  it("a server that advertises no ACL fails closed instead of reporting success", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.aclLink = "none";
    await expect(seedPods({ layout: layout(pod) })).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.has(Secret)).toBe(false);
    expect(pod.resources.has(`${Secret}.acl`)).toBe(false);
  });

  it("a server whose ACL lives elsewhere (ACP .acr) fails closed", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.aclLink = { suffix: ".acr" };
    await expect(seedPods({ layout: layout(pod) })).rejects.toThrow(SeedError);
    expect(pod.resources.has(Secret)).toBe(false);
  });

  it("replace mode writes the new ACL before the new data over an existing resource", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: layout(pod) });
    pod.requests.length = 0;
    await seedPods({ layout: layout(pod), mode: "replace" });
    const order = pod.requests
      .filter((r) => r.method === "PUT")
      .map((r) => new URL(r.url).pathname);
    expect(order.indexOf("/public/secret.acl")).toBeLessThan(order.lastIndexOf("/public/secret"));
    expect(pod.resources.get(Secret)?.body).toBe("private data");
  });

  it("a failed data write removes the placeholder, so ensure can recover", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret", 500, 1);
    await expect(seedPods({ layout: layout(pod), mode: "ensure" })).rejects.toBeInstanceOf(
      SeedError,
    );
    expect(pod.resources.has(Secret)).toBe(false);
    await seedPods({ layout: layout(pod), mode: "ensure" });
    expect(pod.resources.get(Secret)?.body).toBe("private data");
  });

  it("checks the ACL location with GET when the server refuses HEAD", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.headUnsupported = true;
    await seedPods({ layout: layout(pod) });
    expect(pod.resources.get(Secret)?.body).toBe("private data");
  });

  it("an RDF/XML placeholder is a valid empty RDF/XML document", async () => {
    const pod = new MemoryPod("https://pod.example");
    const xml = '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>';
    await seedPods({
      layout: {
        pods: [
          {
            account: { target: pod },
            resources: [
              {
                path: "/public/secret",
                contentType: "application/rdf+xml",
                source: { body: xml },
                access: { publicRead: false },
              },
            ],
          },
        ],
      },
    });
    expect(pod.putRecords("/public/secret")[0]?.body).toBe(xml);
  });

  it("a container with access is created with its description, since CSS refuses a second PUT", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.containerPutConflict = true;
    const containerLayout: PodLayout = {
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/private/",
              source: { body: "<> a <https://example.org/Box> ." },
              access: { publicRead: false },
            },
          ],
        },
      ],
    };
    for (const mode of ["create", "ensure"] as const) {
      await seedPods({ layout: containerLayout, mode });
    }
    const order = pod.putRecords().map((r) => [new URL(r.url).pathname, r.body === ""]);
    // create: empty container, ACL, description (refused with 409, as CSS does);
    // ensure: the container exists, so only the ACL is reconciled.
    expect(order).toEqual([
      ["/private/", true],
      ["/private/.acl", false],
      ["/private/", false],
      ["/private/", true],
      ["/private/.acl", false],
    ]);
    await seedPods({ layout: containerLayout, mode: "replace" });
  });

  it("a container description lands after its ACL on a server that stores it", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({
      layout: {
        pods: [
          {
            account: { target: pod },
            resources: [
              {
                path: "/private/",
                source: { body: "<> a <https://example.org/Box> ." },
                access: { publicRead: false },
              },
            ],
          },
        ],
      },
    });
    const order = pod.putRecords().map((r) => [new URL(r.url).pathname, r.body === ""]);
    expect(order).toEqual([
      ["/private/", true],
      ["/private/.acl", false],
      ["/private/", false],
    ]);
    expect(pod.resources.get("https://pod.example/private/")?.body).toContain("Box");
  });

  it("a failed data write also removes the ACL this run wrote, so create can re-run", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret", 500, 1);
    await expect(seedPods({ layout: layout(pod) })).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.has(`${Secret}.acl`)).toBe(false);
    await seedPods({ layout: layout(pod) });
    expect(pod.resources.get(Secret)?.body).toBe("private data");
  });

  const grantsPublicRead = (body: string | undefined, aclUrl: string): boolean =>
    [
      ...new AclResource(
        new Store(new Parser({ format: "text/turtle", baseIRI: aclUrl }).parse(body ?? "")),
        DataFactory,
      ).authorizations,
    ].some((authorization) => authorization.accessibleToAny);
  const access = (pod: MemoryPod, body: string, publicRead: boolean): PodLayout => ({
    pods: [
      {
        account: { target: pod },
        resources: [{ path: "/public/secret", source: { body }, access: { publicRead } }],
      },
    ],
  });

  it("a replacement holds an owner-only ACL until the new data is written, then grants", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "old private data", false) });
    const before = pod.requests.length;
    await seedPods({ layout: access(pod, "new public data", true), mode: "replace" });
    const writes = pod.requests
      .slice(before)
      .filter((r) => r.method === "PUT")
      .map((r) => [new URL(r.url).pathname, r.body]);
    // The old data is never governed by the new public grant.
    expect(writes.map(([path]) => path)).toEqual([
      "/public/secret",
      "/public/secret.acl",
      "/public/secret",
      "/public/secret.acl",
    ]);
    expect(grantsPublicRead(writes[1]?.[1], `${Secret}.acl`)).toBe(false);
    expect(writes[2]?.[1]).toBe("new public data");
    expect(grantsPublicRead(writes[3]?.[1], `${Secret}.acl`)).toBe(true);
  });

  it("a failed replacement leaves the owner-only ACL over the resource", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "old private data", false) });
    pod.failNextPut("/public/secret", 500, 1);
    await expect(
      seedPods({ layout: access(pod, "new public data", true), mode: "replace" }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.get(Secret)?.body).toBe("old private data");
    expect(grantsPublicRead(pod.resources.get(`${Secret}.acl`)?.body, `${Secret}.acl`)).toBe(false);
  });

  it("cleanup deletes a partly written resource before its ACL", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret", 500, 1, true);
    await expect(seedPods({ layout: access(pod, "private data", true) })).rejects.toBeInstanceOf(
      SeedError,
    );
    const deletes = pod.requests
      .filter((r) => r.method === "DELETE")
      .map((r) => new URL(r.url).pathname);
    expect(deletes).toEqual(["/public/secret", "/public/secret.acl"]);
    expect(pod.resources.has(Secret)).toBe(false);
    expect(pod.resources.has(`${Secret}.acl`)).toBe(false);
  });

  it("a cleanup DELETE that fails keeps the ACL and reports both errors", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret", 500, 1, true);
    pod.deleteFailures.set("/public/secret", 500);
    const error = await seedPods({ layout: access(pod, "private data", true) }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SeedError);
    expect(String((error as SeedError).cause)).toMatch(
      /could not remove .*status 500.*ACL was left in place/,
    );
    // The partly written data stays under the owner-only ACL, never the inherited one.
    expect(pod.resources.get(Secret)?.body).toBe("private data");
    expect(pod.resources.has(`${Secret}.acl`)).toBe(true);
    expect(grantsPublicRead(pod.resources.get(`${Secret}.acl`)?.body, `${Secret}.acl`)).toBe(false);
  });

  it("an accepted (202) write is not a completed one", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.acceptOnly.add("/public/secret");
    const error = await seedPods({ layout: access(pod, "private data", true) }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SeedError);
    expect(String((error as SeedError).cause)).toMatch(/202/);
    // The grants never went on.
    expect(pod.resources.has(`${Secret}.acl`)).toBe(false);
  });

  it("an accepted (202) cleanup DELETE keeps the ACL", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret", 500, 1, true);
    pod.deleteFailures.set("/public/secret", 202);
    const error = await seedPods({ layout: access(pod, "private data", true) }).catch(
      (caught: unknown) => caught,
    );
    expect(String((error as SeedError).cause)).toMatch(
      /could not remove .*status 202.*ACL was left in place/,
    );
    expect(pod.resources.has(`${Secret}.acl`)).toBe(true);
    expect(grantsPublicRead(pod.resources.get(`${Secret}.acl`)?.body, `${Secret}.acl`)).toBe(false);
  });

  it("a cleanup that removes the resource but not its ACL says so", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret", 500, 1);
    pod.deleteFailures.set("/public/secret.acl", 403);
    const error = await seedPods({ layout: access(pod, "private data", true) }).catch(
      (caught: unknown) => caught,
    );
    expect(String((error as SeedError).cause)).toMatch(/but not its ACL \(status 403\)/);
    expect(pod.resources.has(Secret)).toBe(false);
  });

  it("a cleanup DELETE that throws keeps the ACL", async () => {
    const pod = new MemoryPod("https://pod.example");
    const inner = pod.authFetch;
    const target = {
      webid: pod.webid,
      baseUrl: pod.baseUrl,
      authFetch: (async (input, init) => {
        if (init?.method === "DELETE") throw new Error("network down");
        return inner(input, init);
      }) as typeof fetch,
    };
    pod.failNextPut("/public/secret", 500, 1, true);
    const error = await seedPods({
      layout: {
        pods: [
          {
            account: { target },
            resources: [
              { path: "/public/secret", source: { body: "x" }, access: { publicRead: true } },
            ],
          },
        ],
      },
    }).catch((caught: unknown) => caught);
    expect(String((error as SeedError).cause)).toMatch(/could not remove .*network down/);
    expect(pod.resources.has(`${Secret}.acl`)).toBe(true);
  });

  it("ensure after a failed replacement does not publish the superseded content", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "old private data", false) });
    pod.failNextPut("/public/secret", 500, 1);
    await expect(
      seedPods({ layout: access(pod, "new public data", true), mode: "replace" }),
    ).rejects.toBeInstanceOf(SeedError);
    const error = await seedPods({
      layout: access(pod, "new public data", true),
      mode: "ensure",
    }).catch((caught: unknown) => caught);
    expect(String((error as SeedError).cause)).toMatch(/will not broaden access/);
    expect(pod.resources.get(Secret)?.body).toBe("old private data");
    expect(grantsPublicRead(pod.resources.get(`${Secret}.acl`)?.body, `${Secret}.acl`)).toBe(false);
    // replace is the way to publish it.
    await seedPods({ layout: access(pod, "new public data", true), mode: "replace" });
    expect(pod.resources.get(Secret)?.body).toBe("new public data");
    expect(grantsPublicRead(pod.resources.get(`${Secret}.acl`)?.body, `${Secret}.acl`)).toBe(true);
  });

  it("ensure re-applies identical grants and narrows broader ones", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "data", true) });
    await expect(
      seedPods({ layout: access(pod, "data", true), mode: "ensure" }),
    ).resolves.toBeDefined();
    await seedPods({ layout: access(pod, "data", false), mode: "ensure" });
    expect(grantsPublicRead(pod.resources.get(`${Secret}.acl`)?.body, `${Secret}.acl`)).toBe(false);
    // An ACL the seeder cannot read as Turtle grants nothing it can vouch for.
    const stored = pod.resources.get(`${Secret}.acl`);
    pod.resources.set(`${Secret}.acl`, { body: stored?.body ?? "", contentType: "text/n3" });
    await expect(
      seedPods({ layout: access(pod, "data", true), mode: "ensure" }),
    ).rejects.toBeInstanceOf(SeedError);
    pod.resources.set(`${Secret}.acl`, { body: "not turtle <", contentType: "text/turtle" });
    await expect(
      seedPods({ layout: access(pod, "data", true), mode: "ensure" }),
    ).rejects.toBeInstanceOf(SeedError);
  });

  it("an owner-only ACL PUT that lands but errors is removed by cleanup", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.failNextPut("/public/secret.acl", 500, 0, true);
    await expect(seedPods({ layout: layout(pod) })).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.has(Secret)).toBe(false);
    expect(pod.resources.has(`${Secret}.acl`)).toBe(false);
    await seedPods({ layout: layout(pod) });
    expect(pod.resources.get(Secret)?.body).toBe("private data");
  });

  it("cleanup counts a 404 for the ACL as removed, as on CSS which deletes it with the resource", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.deleteAclWithResource = true;
    pod.failNextPut("/public/secret", 500, 1);
    const error = await seedPods({ layout: access(pod, "private data", true) }).catch(
      (caught: unknown) => caught,
    );
    expect((error as SeedError).cause).toBeInstanceOf(Error);
    expect(String((error as SeedError).cause)).not.toMatch(/not its ACL|could not remove/);
    const deletes = pod.requests.filter((r) => r.method === "DELETE");
    expect(deletes.map((r) => new URL(r.url).pathname)).toEqual([
      "/public/secret",
      "/public/secret.acl",
    ]);
    expect(pod.resources.size).toBe(0);
  });

  it("never deletes a resource whose placeholder PUT did not answer 201", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: layout(pod) });
    pod.ignoreIfNoneMatch = true;
    pod.failNextPut("/public/secret", 500, 1);
    await expect(seedPods({ layout: layout(pod), mode: "replace" })).rejects.toBeInstanceOf(
      SeedError,
    );
    expect(pod.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(pod.resources.has(`${Secret}.acl`)).toBe(true);
  });

  it("ensure and replace treat CSS's 409 on a conditional container PUT as existing", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.containerPutConflict = true;
    const container = (publicRead: boolean): PodLayout => ({
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/private/",
              source: { body: "<> a <https://example.org/Box> ." },
              access: { publicRead },
            },
          ],
        },
      ],
    });
    await seedPods({ layout: container(false) });
    await expect(seedPods({ layout: container(false), mode: "create" })).rejects.toBeInstanceOf(
      SeedError,
    );
    const ensured = await seedPods({ layout: container(false), mode: "ensure" });
    expect(ensured.pods[0]?.resources[0]?.status).toBe("skipped");
    const replaced = await seedPods({ layout: container(false), mode: "replace" });
    expect(replaced.pods[0]?.resources[0]?.status).toBe("replaced");
  });

  it("replace will not broaden an existing container's acl:default over children it did not write", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.containerPutConflict = true;
    const container = (publicRead: boolean): PodLayout => ({
      pods: [
        {
          account: { target: pod },
          resources: [
            {
              path: "/c/",
              source: { body: "<> a <https://example.org/Box> ." },
              access: { publicRead },
            },
          ],
        },
      ],
    });
    await seedPods({ layout: container(false) });
    // Another client writes a child that inherits the container's ACL.
    pod.resources.set("https://pod.example/c/diary", {
      body: "dear diary",
      contentType: "text/plain",
    });
    const before = pod.resources.get("https://pod.example/c/.acl")?.body;
    const error = await seedPods({ layout: container(true), mode: "replace" }).catch(
      (caught: unknown) => caught,
    );
    expect(String((error as SeedError).cause)).toMatch(/will not broaden access/);
    expect(pod.resources.get("https://pod.example/c/.acl")?.body).toBe(before);
    // A container this run creates has no children yet, so its grants apply.
    const fresh = new MemoryPod("https://pod.example");
    await seedPods({
      layout: {
        pods: [
          { ...container(true).pods[0], account: { target: fresh } } as PodLayout["pods"][number],
        ],
      },
    });
    const acl = "https://pod.example/c/.acl";
    expect(grantsPublicRead(fresh.resources.get(acl)?.body, acl)).toBe(true);
  });

  const containerLayout = (pod: MemoryPod, publicRead: boolean): PodLayout => ({
    pods: [
      {
        account: { target: pod },
        resources: [
          {
            path: "/c/",
            source: { body: "<> a <https://example.org/Box> ." },
            access: { publicRead },
          },
        ],
      },
    ],
  });

  it("a 201 does not prove a container new: grants apply only over an empty container", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: containerLayout(pod, false) });
    pod.resources.set("https://pod.example/c/secret", {
      body: "private",
      contentType: "text/plain",
    });
    // A server that ignores If-None-Match and answers 201 to the overwrite.
    pod.ignoreIfNoneMatch = true;
    pod.alwaysCreated = true;
    const error = await seedPods({ layout: containerLayout(pod, true), mode: "replace" }).catch(
      (caught: unknown) => caught,
    );
    expect(String((error as SeedError).cause)).toMatch(/not confirmed empty/);
    const acl = "https://pod.example/c/.acl";
    expect(grantsPublicRead(pod.resources.get(acl)?.body, acl)).toBe(false);
    expect(pod.resources.get("https://pod.example/c/secret")?.body).toBe("private");
  });

  it("a containment triple counts however the listing spells the container", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: containerLayout(pod, false) });
    pod.ignoreIfNoneMatch = true;
    pod.alwaysCreated = true;
    const inner = pod.authFetch;
    const target = {
      webid: pod.webid,
      baseUrl: pod.baseUrl,
      authFetch: (async (input, init) => {
        const response = await inner(input, init);
        if (init?.method !== "GET" || String(input) !== "https://pod.example/c/") return response;
        return new Response(
          "<https://pod.example:443/c> <http://www.w3.org/ns/ldp#contains> <https://pod.example/c/secret> .",
          { status: 200, headers: response.headers },
        );
      }) as typeof fetch,
    };
    const layout = containerLayout(pod, true);
    const error = await seedPods({
      layout: { pods: [{ ...layout.pods[0], account: { target } } as PodLayout["pods"][number]] },
      mode: "replace",
    }).catch((caught: unknown) => caught);
    expect(String((error as SeedError).cause)).toMatch(/not confirmed empty/);
    const acl = "https://pod.example/c/.acl";
    expect(grantsPublicRead(pod.resources.get(acl)?.body, acl)).toBe(false);
  });

  it("replace of an existing container writes its owner-only ACL only over the ACL it checked", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.containerPutConflict = true;
    await seedPods({ layout: containerLayout(pod, true) });
    const acl = "https://pod.example/c/.acl";
    pod.afterGet = (url) => {
      if (url === acl) {
        pod.afterGet = undefined;
        pod.resources.set(acl, { body: "# narrowed elsewhere\n", contentType: "text/turtle" });
      }
    };
    await expect(
      seedPods({ layout: containerLayout(pod, true), mode: "replace" }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.get(acl)?.body).toBe("# narrowed elsewhere\n");
  });

  it("the final grant on a created container goes only over the owner-only ACL this run wrote", async () => {
    const pod = new MemoryPod("https://pod.example");
    const acl = "https://pod.example/c/.acl";
    // Between the owner-only ACL and the grant (at the emptiness check, after the
    // HEAD that locates the ACL), another writer changes the ACL.
    let reads = 0;
    pod.afterGet = (url) => {
      if (url === "https://pod.example/c/" && ++reads === 2) {
        pod.afterGet = undefined;
        pod.resources.set(acl, { body: "# changed elsewhere\n", contentType: "text/turtle" });
      }
    };
    const error = await seedPods({ layout: containerLayout(pod, true) }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SeedError);
    expect(String((error as SeedError).cause)).toMatch(/412/);
    expect(grantsPublicRead(pod.resources.get(acl)?.body, acl)).toBe(false);
  });

  it("ensure on an expander group never broadens, and checks every member before writing", async () => {
    const pod = new MemoryPod("https://pod.example");
    const group = (publicRead: boolean, body: string): PodLayout => ({
      pods: [
        {
          account: { target: pod },
          resources: [
            () => [
              { path: "/g/a", source: { body: `${body} a` }, access: { publicRead } },
              { path: "/g/b", source: { body: `${body} b` }, access: { publicRead } },
            ],
          ],
        },
      ],
    });
    await seedPods({ layout: group(false, "old private") });
    pod.failNextPut("/g/a", 500, 1);
    await expect(
      seedPods({ layout: group(true, "new public"), mode: "replace" }),
    ).rejects.toBeInstanceOf(SeedError);
    const aclPuts = pod.putRecords().filter((r) => r.url.endsWith(".acl")).length;
    await expect(
      seedPods({ layout: group(true, "new public"), mode: "ensure" }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(pod.putRecords().filter((r) => r.url.endsWith(".acl")).length).toBe(aclPuts);
    for (const path of ["/g/a", "/g/b"]) {
      const acl = `https://pod.example${path}.acl`;
      expect(grantsPublicRead(pod.resources.get(acl)?.body, acl)).toBe(false);
    }
    expect(pod.resources.get("https://pod.example/g/a")?.body).toBe("old private a");
  });

  it("ensure will not rewrite an ACL whose authorization carries a restriction such as acl:origin", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "data", true) });
    const acl = `${Secret}.acl`;
    const stored = pod.resources.get(acl);
    pod.resources.set(acl, {
      body: `${stored?.body}\n<${acl}#public> <http://www.w3.org/ns/auth/acl#origin> <https://trusted.app> .\n`,
      contentType: "text/turtle",
    });
    const error = await seedPods({ layout: access(pod, "data", true), mode: "ensure" }).catch(
      (caught: unknown) => caught,
    );
    expect(String((error as SeedError).cause)).toMatch(/will not broaden access/);
    expect(pod.resources.get(acl)?.body).toContain("trusted.app");
  });

  it("ensure reads at most 1 MiB of an existing ACL", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "data", true) });
    const acl = `${Secret}.acl`;
    const stored = pod.resources.get(acl)?.body ?? "";
    pod.resources.set(acl, {
      body: `${stored}\n# ${"x".repeat(1024 * 1024)}\n`,
      contentType: "text/turtle",
    });
    await expect(
      seedPods({ layout: access(pod, "data", true), mode: "ensure" }),
    ).rejects.toBeInstanceOf(SeedError);
  });

  it("ensure conditions its ACL rewrite on the ETag it checked", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: access(pod, "data", true) });
    const acl = `${Secret}.acl`;
    const checked = pod.resources.get(acl);
    // Someone narrows the ACL between the seeder's check and its write.
    pod.afterGet = (url) => {
      if (url === acl) {
        pod.afterGet = undefined;
        pod.resources.set(acl, { body: "# narrowed elsewhere\n", contentType: "text/turtle" });
      }
    };
    await expect(
      seedPods({ layout: access(pod, "data", true), mode: "ensure" }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.get(acl)?.body).toBe("# narrowed elsewhere\n");
    expect(pod.putRecords("/public/secret.acl").at(-1)?.headers.get("if-match")).toMatch(/^"/);
    expect(checked).toBeDefined();
  });

  it("create never deletes a stale ACL the server refused to overwrite", async () => {
    const pod = new MemoryPod("https://pod.example");
    pod.resources.set(`${Secret}.acl`, { body: "# stale\n", contentType: "text/turtle" });
    await expect(seedPods({ layout: layout(pod) })).rejects.toBeInstanceOf(SeedError);
    expect(pod.resources.get(`${Secret}.acl`)?.body).toBe("# stale\n");
    expect(pod.resources.has(Secret)).toBe(false);
  });

  it("every pod request refuses redirects", async () => {
    const pod = new MemoryPod("https://pod.example");
    await seedPods({ layout: layout(pod) });
    expect(pod.requests.length).toBeGreaterThan(0);
    expect(pod.requests.every((r) => r.redirect === "error")).toBe(true);
  });
});

describe("resource path guard", () => {
  for (const path of [
    "/x%2Eacl",
    "/x%2eacl",
    "/x.acr",
    "/x.meta",
    "/a%2Fb",
    "/a%2fb",
    "/a%5Cb",
    "/x.%61cl",
    "/x.ac%6C",
    "/x.%61cr",
    "/x.%6Deta",
    "/a%7Eb",
    "/a%25b",
    "/x.%2561cl",
  ]) {
    it(`refuses ${path}`, async () => {
      const pod = new MemoryPod("https://pod.example");
      await expect(
        seedPods({
          layout: {
            pods: [{ account: { target: pod }, resources: [{ path, source: { body: "x" } }] }],
          },
        }),
      ).rejects.toThrow();
      expect(pod.putRecords()).toHaveLength(0);
    });
  }
});

it("a path may still escape characters that need escaping", async () => {
  const pod = new MemoryPod("https://pod.example");
  await seedPods({
    layout: {
      pods: [{ account: { target: pod }, resources: [{ path: "/a%20b", source: { body: "x" } }] }],
    },
  });
  expect(pod.putRecords("/a%20b")).toHaveLength(1);
});
