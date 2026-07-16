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
  function groupLayout(pod: MemoryPod, expansionCount: { value: number }): PodLayout {
    const issueOnce: ResourceExpander = () => {
      expansionCount.value += 1;
      return ["vc", "anchor", "witness"].map((name) => ({
        path: `/credentials/${name}`,
        source: { body: `issued-${name}` },
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
    expect(pod.putRecords().every((record) => record.headers.get("if-none-match") === "*")).toBe(
      true,
    );

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
        .filter(([url]) => url.includes("/credentials/"))
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
