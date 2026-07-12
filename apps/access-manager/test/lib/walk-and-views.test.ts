// AUTHORED-BY Claude Fable 5
// Storage walk (progressive, bounded, .acl-skipping, degrades on errors) +
// dashboard aggregations (by-resource / by-agent, public flagged, owner
// excluded, inherited marked) + the data-class grouping and summary.
import { describe, expect, it } from "vitest";
import { byAgent, byResource, PUBLIC_AGENT } from "../../src/lib/grants.js";
import { resolveAgentDisplay, storageRoots } from "../../src/lib/profile.js";
import { type WalkedNode, walkStorage } from "../../src/lib/storage-walk.js";
import {
  classAccessSummary,
  classLabel,
  groupByDataClass,
  readTypeRegistrations,
} from "../../src/lib/type-index.js";
import { BOB, buildPod, CONTACTS_CLASS, OWNER, POD, PREFIXES } from "../fixtures.js";

async function walkAll(pod = buildPod(), options = {}): Promise<WalkedNode[]> {
  const nodes: WalkedNode[] = [];
  for await (const node of walkStorage(POD, pod.fetch, options)) nodes.push(node);
  return nodes;
}

describe("walkStorage", () => {
  it("walks the tree, yields containers + resources, never lists .acl docs", async () => {
    const nodes = await walkAll();
    const urls = nodes.map((n) => n.url);
    expect(urls).toContain(POD);
    expect(urls).toContain(`${POD}contacts/`);
    expect(urls).toContain(`${POD}contacts/alice.ttl`);
    expect(urls).toContain(`${POD}docs/report.ttl`);
    expect(urls.some((u) => u.endsWith(".acl"))).toBe(false);
  });

  it("marks inherited vs own ACLs on nodes", async () => {
    const nodes = await walkAll();
    expect(nodes.find((n) => n.url === `${POD}contacts/alice.ttl`)?.aclOwned).toBe(false);
    expect(nodes.find((n) => n.url === `${POD}docs/report.ttl`)?.aclOwned).toBe(true);
  });

  it("respects maxDepth and maxNodes bounds", async () => {
    const shallow = await walkAll(buildPod(), { maxDepth: 0 });
    expect(shallow.map((n) => n.url)).toEqual([POD]);
    const capped = await walkAll(buildPod(), { maxNodes: 2 });
    expect(capped).toHaveLength(2);
  });

  it("flags a node whose ACL cannot be found instead of aborting", async () => {
    const pod = buildPod();
    pod.delete(`${POD}.acl`);
    const nodes = await walkAll(pod);
    const alice = nodes.find((n) => n.url === `${POD}contacts/alice.ttl`);
    expect(alice?.aclError).toBe("no-acl");
    expect(alice?.entries).toEqual([]);
  });
});

describe("byResource / byAgent", () => {
  it("surfaces shared resources with public prominently flagged; owner excluded", async () => {
    const nodes = await walkAll();
    const shares = byResource(nodes, OWNER);
    const report = shares.find((s) => s.url === `${POD}docs/report.ttl`);
    expect(report).toBeDefined();
    expect(report?.hasPublicAccess).toBe(true);
    expect(report?.shares.some((l) => l.agent === BOB)).toBe(true);
    expect(report?.shares.some((l) => l.agent === OWNER)).toBe(false);
    // Un-shared, inherited-only nodes don't clutter the view.
    expect(shares.some((s) => s.url === `${POD}contacts/alice.ttl`)).toBe(false);
  });

  it("aggregates by agent with public first", async () => {
    const nodes = await walkAll();
    const agents = byAgent(nodes, OWNER);
    expect(agents[0]?.agent).toBe(PUBLIC_AGENT);
    const bob = agents.find((a) => a.agent === BOB);
    expect(bob?.resources.map((r) => r.url)).toEqual([`${POD}docs/report.ttl`]);
    expect(bob?.resources[0]?.inherited).toBe(false);
    expect(agents.some((a) => a.agent === OWNER)).toBe(false);
  });

  it("marks inherited access lines", async () => {
    const pod = buildPod();
    pod.seed(
      `${POD}.acl`,
      `${pod.body(`${POD}.acl`) ?? ""}
<${POD}.acl#bob> a <http://www.w3.org/ns/auth/acl#Authorization> ;
  <http://www.w3.org/ns/auth/acl#agent> <${BOB}> ;
  <http://www.w3.org/ns/auth/acl#default> <${POD}> ;
  <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read> .`,
    );
    const nodes = await walkAll(pod);
    const agents = byAgent(nodes, OWNER);
    const bob = agents.find((a) => a.agent === BOB);
    const inheritedLine = bob?.resources.find((r) => r.url === `${POD}contacts/alice.ttl`);
    expect(inheritedLine?.inherited).toBe(true);
  });
});

describe("type-index grouping", () => {
  it("reads registrations and groups walked nodes into data classes", async () => {
    const pod = buildPod();
    const regs = await readTypeRegistrations(OWNER, pod.fetch);
    expect(regs).toHaveLength(1);
    expect(regs[0]?.forClass).toBe(CONTACTS_CLASS);
    expect(regs[0]?.visibility).toBe("public");
    const nodes = await walkAll(pod);
    const { groups, unclassified } = groupByDataClass(nodes, regs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.nodes.map((n) => n.url)).toContain(`${POD}contacts/alice.ttl`);
    expect(unclassified.some((n) => n.url === `${POD}docs/report.ttl`)).toBe(true);
  });

  it("a malformed registration (no forClass) is dropped, not fatal", async () => {
    const pod = buildPod();
    pod.seed(
      `${POD}settings/publicTypeIndex.ttl`,
      `${PREFIXES}
<#broken> a solid:TypeRegistration .
<#contacts> a solid:TypeRegistration ; solid:forClass vcard:Individual ;
  solid:instanceContainer <${POD}contacts/> .`,
    );
    const regs = await readTypeRegistrations(OWNER, pod.fetch);
    expect(regs).toHaveLength(1);
  });

  it("summarises per-class access by agent+modes", async () => {
    const pod = buildPod();
    // Share the contacts container with bob directly.
    pod.seed(
      `${POD}contacts/.acl`,
      `${PREFIXES}
<${POD}contacts/.acl#o> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${POD}contacts/> ; acl:default <${POD}contacts/> ;
  acl:mode acl:Read, acl:Write, acl:Control .
<${POD}contacts/.acl#b> a acl:Authorization ; acl:agent <${BOB}> ;
  acl:accessTo <${POD}contacts/> ; acl:default <${POD}contacts/> ;
  acl:mode acl:Read .`,
    );
    const regs = await readTypeRegistrations(OWNER, pod.fetch);
    const nodes = await walkAll(pod);
    const { groups } = groupByDataClass(nodes, regs);
    const group = groups[0];
    if (!group) throw new Error("expected a contacts group");
    const summary = classAccessSummary(group, OWNER);
    const bob = summary.find((s) => s.agent === BOB);
    expect(bob?.modes).toEqual(["Read"]);
    expect(summary.some((s) => s.agent === OWNER)).toBe(false);
  });

  it("classLabel humanises IRI tails", () => {
    expect(classLabel("http://www.w3.org/2006/vcard/ns#Individual")).toBe("Individual");
    expect(classLabel("https://x.example/ns#BookmarkFolder")).toBe("Bookmark Folder");
  });
});

describe("profile resolution", () => {
  it("resolves a display name; caches; refuses non-http WebIDs", async () => {
    const pod = buildPod();
    const display = await resolveAgentDisplay(OWNER, pod.fetch);
    expect(display.name).toBe("Owner O.");
    expect(display.resolved).toBe(true);
    const requestsBefore = pod.log.length;
    await resolveAgentDisplay(OWNER, pod.fetch);
    expect(pod.log.length).toBe(requestsBefore); // memoised

    const evil = await resolveAgentDisplay("file:///etc/passwd", pod.fetch);
    expect(evil.resolved).toBe(false);
    expect(evil.name).toBe("file:///etc/passwd");
  });

  it("an unreachable / malformed profile degrades to the WebID", async () => {
    const pod = buildPod();
    const display = await resolveAgentDisplay("https://gone.example/p#me", pod.fetch);
    expect(display.resolved).toBe(false);
    expect(display.name).toBe("https://gone.example/p#me");
  });

  it("storageRoots reads pim:storage, filtered to http(s)", async () => {
    const pod = buildPod();
    expect(await storageRoots(OWNER, pod.fetch)).toEqual([POD]);
  });
});
