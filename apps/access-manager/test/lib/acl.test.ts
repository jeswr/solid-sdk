// AUTHORED-BY Claude Fable 5
// The security core: ACL read/edit round-trips through the @solid/object typed
// accessors, effective-ACL resolution (own vs inherited, fail-closed), the
// self-lockout guard, If-Match/412 conflict handling, and the materialise-own-
// ACL-on-grant path (incl. the create-only race loser).
import { describe, expect, it } from "vitest";
import {
  AclConflictError,
  addAgentGrant,
  createAuthorization,
  discoverAclUrl,
  grantOnResource,
  LockoutError,
  materializeOwnAcl,
  NoAclFoundError,
  ownerHasControl,
  parentContainer,
  parseAclLink,
  projectEntries,
  readEffectiveAcl,
  removeAgentFromEntry,
  removePublicAccess,
  setAgentModes,
  updateAclWithRetry,
} from "../../src/lib/acl.js";
import { readRdf } from "../../src/lib/http.js";
import { BOB, buildPod, OWNER, POD, PREFIXES, REQUESTER } from "../fixtures.js";

const REPORT = `${POD}docs/report.ttl`;
const REPORT_ACL = `${REPORT}.acl`;

async function entriesAt(pod: ReturnType<typeof buildPod>, aclUrl: string) {
  const read = await readRdf(aclUrl, pod.fetch);
  if (!read) throw new Error(`missing ${aclUrl}`);
  return { read, entries: projectEntries(read.dataset) };
}

describe("parseAclLink", () => {
  it("extracts and resolves the rel=acl target", () => {
    expect(parseAclLink('<a.ttl.acl>; rel="acl"', "https://p.example/a.ttl")).toBe(
      "https://p.example/a.ttl.acl",
    );
    expect(
      parseAclLink('<https://p.example/x.acl>; rel=acl, <o>; rel="other"', "https://p.example/"),
    ).toBe("https://p.example/x.acl");
    expect(parseAclLink('<o>; rel="describedby"', "https://p.example/")).toBeUndefined();
  });
});

describe("parentContainer", () => {
  it("walks child → parent → root and stops at the root", () => {
    expect(parentContainer(`${POD}contacts/alice.ttl`, POD)).toBe(`${POD}contacts/`);
    expect(parentContainer(`${POD}contacts/`, POD)).toBe(POD);
    expect(parentContainer(POD, POD)).toBeUndefined();
  });
});

describe("discoverAclUrl", () => {
  it("uses the Link rel=acl header from the pod", async () => {
    const pod = buildPod();
    expect(await discoverAclUrl(REPORT, pod.fetch)).toBe(REPORT_ACL);
  });
});

describe("projectEntries + readEffectiveAcl", () => {
  it("projects agents, public flag, and modes from a real ACL", async () => {
    const pod = buildPod();
    const effective = await readEffectiveAcl(REPORT, POD, pod.fetch);
    expect(effective.owned).toBe(true);
    expect(effective.aclUrl).toBe(REPORT_ACL);
    const shared = effective.entries.find((e) => e.agents.includes(BOB));
    expect(shared).toBeDefined();
    expect(shared?.isPublic).toBe(true);
    expect(shared?.modes).toEqual(["Read"]);
    const owner = effective.entries.find((e) => e.agents.includes(OWNER));
    expect(owner?.modes.sort()).toEqual(["Control", "Read", "Write"]);
  });

  it("resolves an INHERITED acl via the ancestor walk (acl:default)", async () => {
    const pod = buildPod();
    const effective = await readEffectiveAcl(`${POD}contacts/alice.ttl`, POD, pod.fetch);
    expect(effective.owned).toBe(false);
    expect(effective.governingResource).toBe(POD);
    expect(effective.aclUrl).toBe(`${POD}.acl`);
    // Only the acl:default entries of the governing ancestor apply.
    expect(effective.entries).toHaveLength(1);
    expect(effective.entries[0]?.agents).toEqual([OWNER]);
  });

  it("fails CLOSED when no ACL exists anywhere", async () => {
    const pod = buildPod();
    pod.delete(`${POD}.acl`);
    await expect(
      readEffectiveAcl(`${POD}contacts/alice.ttl`, POD, pod.fetch),
    ).rejects.toBeInstanceOf(NoAclFoundError);
  });
});

describe("removeAgentFromEntry", () => {
  it("removes only the named agent; public access on the node survives", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    removeAgentFromEntry(read.dataset, `${REPORT_ACL}#shared`, BOB, OWNER, REPORT);
    const entries = projectEntries(read.dataset);
    const shared = entries.find((e) => e.authIri === `${REPORT_ACL}#shared`);
    expect(shared?.agents).toEqual([]);
    expect(shared?.isPublic).toBe(true); // node kept: it still names the public
  });

  it("drops the node entirely when it no longer names any subject", async () => {
    const pod = buildPod();
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .
<${REPORT_ACL}#only-bob> a acl:Authorization ; acl:agent <${BOB}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    removeAgentFromEntry(read.dataset, `${REPORT_ACL}#only-bob`, BOB, OWNER, REPORT);
    expect(projectEntries(read.dataset).some((e) => e.authIri.endsWith("#only-bob"))).toBe(false);
  });

  it("REFUSES to strip the owner's last Control (self-lockout guard)", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    expect(() =>
      removeAgentFromEntry(read.dataset, `${REPORT_ACL}#owner`, OWNER, OWNER, REPORT),
    ).toThrow(LockoutError);
  });
});

describe("removePublicAccess", () => {
  it("removes foaf:Agent from every node; named agents unaffected", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    removePublicAccess(read.dataset, OWNER, REPORT);
    const entries = projectEntries(read.dataset);
    expect(entries.some((e) => e.isPublic)).toBe(false);
    expect(entries.find((e) => e.authIri.endsWith("#shared"))?.agents).toEqual([BOB]);
  });
});

describe("setAgentModes", () => {
  it("edits modes in place when the agent is the node's sole subject", async () => {
    const pod = buildPod();
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .
<${REPORT_ACL}#bob> a acl:Authorization ; acl:agent <${BOB}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    setAgentModes(read.dataset, REPORT_ACL, `${REPORT_ACL}#bob`, BOB, ["Read"], OWNER, REPORT);
    const bob = projectEntries(read.dataset).find((e) => e.agents.includes(BOB));
    expect(bob?.modes).toEqual(["Read"]); // downgraded Write → gone
  });

  it("SPLITS the agent out of a shared node so others keep their access", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL); // #shared = bob + public, Read
    setAgentModes(
      read.dataset,
      REPORT_ACL,
      `${REPORT_ACL}#shared`,
      BOB,
      ["Read", "Write"],
      OWNER,
      REPORT,
    );
    const entries = projectEntries(read.dataset);
    const publicEntry = entries.find((e) => e.isPublic);
    expect(publicEntry?.modes).toEqual(["Read"]); // public unchanged
    expect(publicEntry?.agents).not.toContain(BOB);
    const bob = entries.find((e) => e.agents.includes(BOB));
    expect(bob?.modes.sort()).toEqual(["Read", "Write"]);
    expect(bob?.accessTo).toEqual([REPORT]); // scope carried over on the split
  });

  it("empty modes = removal (delegates to the lockout-guarded remove)", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    setAgentModes(read.dataset, REPORT_ACL, `${REPORT_ACL}#shared`, BOB, [], OWNER, REPORT);
    expect(projectEntries(read.dataset).some((e) => e.agents.includes(BOB))).toBe(false);
  });
});

describe("addAgentGrant", () => {
  it("reuses an existing agent-only node with identical scope+modes", async () => {
    const pod = buildPod();
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .
<${REPORT_ACL}#readers> a acl:Authorization ; acl:agent <${BOB}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    const authIri = addAgentGrant(read.dataset, REPORT_ACL, REPORT, REQUESTER, ["Read"]);
    expect(authIri).toBe(`${REPORT_ACL}#readers`);
    const readers = projectEntries(read.dataset).find((e) => e.authIri.endsWith("#readers"));
    expect(readers?.agents.sort()).toEqual([BOB, REQUESTER].sort());
  });

  it("never reuses a PUBLIC node (would widen the grant); creates a fresh one", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL); // #shared is public+Read
    const authIri = addAgentGrant(read.dataset, REPORT_ACL, REPORT, REQUESTER, ["Read"]);
    expect(authIri).not.toBe(`${REPORT_ACL}#shared`);
    const created = projectEntries(read.dataset).find((e) => e.authIri === authIri);
    expect(created?.agents).toEqual([REQUESTER]);
    expect(created?.isPublic).toBe(false);
  });

  it("is idempotent for the same agent+modes (set semantics)", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    const a = addAgentGrant(read.dataset, REPORT_ACL, REPORT, REQUESTER, ["Read"]);
    const b = addAgentGrant(read.dataset, REPORT_ACL, REPORT, REQUESTER, ["Read"]);
    expect(a).toBe(b);
    const entry = projectEntries(read.dataset).find((e) => e.authIri === a);
    expect(entry?.agents).toEqual([REQUESTER]);
  });
});

describe("createAuthorization", () => {
  it("mints fresh fragments that do not collide", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    const a = createAuthorization(read.dataset, REPORT_ACL, { agents: [BOB], modes: ["Read"] });
    const b = createAuthorization(read.dataset, REPORT_ACL, { agents: [BOB], modes: ["Write"] });
    expect(a).not.toBe(b);
  });
});

describe("materializeOwnAcl", () => {
  it("copies the applicable inherited entries, retargeted, container keeps default", async () => {
    const pod = buildPod();
    const effective = await readEffectiveAcl(`${POD}contacts/`, POD, pod.fetch);
    expect(effective.owned).toBe(false);
    const own = materializeOwnAcl(effective, `${POD}contacts/`);
    const entries = projectEntries(own);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agents).toEqual([OWNER]);
    expect(entries[0]?.accessTo).toEqual([`${POD}contacts/`]);
    expect(entries[0]?.defaultFor).toEqual([`${POD}contacts/`]);
  });

  it("a plain resource gets accessTo only (no default)", async () => {
    const pod = buildPod();
    const effective = await readEffectiveAcl(`${POD}contacts/alice.ttl`, POD, pod.fetch);
    const own = materializeOwnAcl(effective, `${POD}contacts/alice.ttl`);
    const entries = projectEntries(own);
    expect(entries[0]?.defaultFor).toEqual([]);
  });
});

describe("ownerHasControl", () => {
  it("true only for a DIRECT agent Control entry", async () => {
    const pod = buildPod();
    const { read } = await entriesAt(pod, REPORT_ACL);
    expect(ownerHasControl(read.dataset, OWNER, REPORT)).toBe(true);
    expect(ownerHasControl(read.dataset, BOB, REPORT)).toBe(false);
  });
});

describe("updateAclWithRetry (CAS loop)", () => {
  it("writes with If-Match from the fresh read", async () => {
    const pod = buildPod();
    await updateAclWithRetry(REPORT_ACL, pod.fetch, (dataset) => {
      removePublicAccess(dataset, OWNER, REPORT);
    });
    const { entries } = await entriesAt(pod, REPORT_ACL);
    expect(entries.some((e) => e.isPublic)).toBe(false);
  });

  it("on 412 it RE-READS and RE-APPLIES the mutation (interleaved writer)", async () => {
    const pod = buildPod();
    let raced = false;
    pod.intercept = (method, url) => {
      // After our first read but before our first PUT, another writer bumps the ACL.
      if (!raced && method === "PUT" && url === REPORT_ACL) {
        raced = true;
        pod.seed(REPORT_ACL, `${pod.body(REPORT_ACL) ?? ""}\n# concurrent edit\n`);
        return undefined; // let the (now stale) PUT hit the stub → 412
      }
      return undefined;
    };
    await updateAclWithRetry(REPORT_ACL, pod.fetch, (dataset) => {
      removePublicAccess(dataset, OWNER, REPORT);
    });
    const { entries } = await entriesAt(pod, REPORT_ACL);
    expect(entries.some((e) => e.isPublic)).toBe(false);
    expect(pod.body(REPORT_ACL)).not.toContain("concurrent edit"); // re-read superseded it
  });

  it("surfaces AclConflictError after exhausting retries", async () => {
    const pod = buildPod();
    pod.intercept = (method, url) => {
      if (method === "PUT" && url === REPORT_ACL) {
        return new Response("precondition failed", { status: 412 });
      }
      return undefined;
    };
    await expect(
      updateAclWithRetry(REPORT_ACL, pod.fetch, (dataset) =>
        removePublicAccess(dataset, OWNER, REPORT),
      ),
    ).rejects.toBeInstanceOf(AclConflictError);
  });

  it("a mutation that throws (lockout) aborts BEFORE any write", async () => {
    const pod = buildPod();
    const before = pod.etag(REPORT_ACL);
    await expect(
      updateAclWithRetry(REPORT_ACL, pod.fetch, (dataset) => {
        removeAgentFromEntry(dataset, `${REPORT_ACL}#owner`, OWNER, OWNER, REPORT);
      }),
    ).rejects.toBeInstanceOf(LockoutError);
    expect(pod.etag(REPORT_ACL)).toBe(before); // nothing written
  });
});

describe("grantOnResource", () => {
  it("updates the OWN acl in place when one exists", async () => {
    const pod = buildPod();
    await grantOnResource(REPORT, POD, OWNER, REQUESTER, ["Read"], pod.fetch);
    const effective = await readEffectiveAcl(REPORT, POD, pod.fetch);
    expect(effective.entries.some((e) => e.agents.includes(REQUESTER))).toBe(true);
  });

  it("MATERIALISES an own acl (create-only) for an inherited-only resource, preserving owner Control", async () => {
    const pod = buildPod();
    const target = `${POD}contacts/alice.ttl`;
    await grantOnResource(target, POD, OWNER, REQUESTER, ["Read"], pod.fetch);
    const effective = await readEffectiveAcl(target, POD, pod.fetch);
    expect(effective.owned).toBe(true); // now has its own ACL
    expect(effective.entries.some((e) => e.agents.includes(REQUESTER))).toBe(true);
    expect(ownerHasControl(effective.dataset, OWNER, target)).toBe(true); // no lock-out
  });

  it("loses the create race gracefully and falls through to the CAS update path", async () => {
    const pod = buildPod();
    const target = `${POD}contacts/alice.ttl`;
    const targetAcl = `${target}.acl`;
    let racedOnce = false;
    pod.intercept = (method, url, init) => {
      const headers = new Headers(init?.headers);
      if (!racedOnce && method === "PUT" && url === targetAcl && headers.get("if-none-match")) {
        // A concurrent granter creates the own ACL first.
        racedOnce = true;
        pod.seed(
          targetAcl,
          `${PREFIXES}
<${targetAcl}#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${target}> ; acl:mode acl:Read, acl:Write, acl:Control .`,
        );
        return undefined; // stub now returns 412 for the create-only PUT
      }
      return undefined;
    };
    await grantOnResource(target, POD, OWNER, REQUESTER, ["Read"], pod.fetch);
    const effective = await readEffectiveAcl(target, POD, pod.fetch);
    expect(effective.entries.some((e) => e.agents.includes(REQUESTER))).toBe(true);
    expect(ownerHasControl(effective.dataset, OWNER, target)).toBe(true); // winner's doc kept
  });
});

describe("removeAuthenticatedFromEntry (roborev: class access is agentClass, not agent)", () => {
  it("removes acl:AuthenticatedAgent from the node; named agents survive", async () => {
    const pod = buildPod();
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .
<${REPORT_ACL}#auth> a acl:Authorization ; acl:agent <${BOB}> ;
  acl:agentClass acl:AuthenticatedAgent ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    const { removeAuthenticatedFromEntry } = await import("../../src/lib/acl.js");
    removeAuthenticatedFromEntry(read.dataset, `${REPORT_ACL}#auth`, OWNER, REPORT);
    const entries = projectEntries(read.dataset);
    const entry = entries.find((e) => e.authIri.endsWith("#auth"));
    expect(entry?.isAuthenticated).toBe(false);
    expect(entry?.agents).toEqual([BOB]); // named access untouched
  });

  it("drops the node entirely when only the class remained", async () => {
    const pod = buildPod();
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#owner> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .
<${REPORT_ACL}#auth> a acl:Authorization ;
  acl:agentClass acl:AuthenticatedAgent ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    const { removeAuthenticatedFromEntry } = await import("../../src/lib/acl.js");
    removeAuthenticatedFromEntry(read.dataset, `${REPORT_ACL}#auth`, OWNER, REPORT);
    expect(projectEntries(read.dataset).some((e) => e.authIri.endsWith("#auth"))).toBe(false);
  });
});

describe("class-removal lockout guard (roborev round 2 Medium)", () => {
  it("refuses removing the class entry that is the owner's ONLY Control path", async () => {
    const pod = buildPod();
    // The owner's control comes ONLY through the authenticated class.
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#auth> a acl:Authorization ;
  acl:agentClass acl:AuthenticatedAgent ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    const { removeAuthenticatedFromEntry, removePublicFromEntry, removePublicAccess } =
      await import("../../src/lib/acl.js");
    expect(() =>
      removeAuthenticatedFromEntry(read.dataset, `${REPORT_ACL}#auth`, OWNER, REPORT),
    ).toThrow(LockoutError);

    // Same rule for the public paths.
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#pub> a acl:Authorization ;
  acl:agentClass foaf:Agent ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .`,
    );
    const second = await entriesAt(pod, REPORT_ACL);
    expect(() =>
      removePublicFromEntry(second.read.dataset, `${REPORT_ACL}#pub`, OWNER, REPORT),
    ).toThrow(LockoutError);
    const third = await entriesAt(pod, REPORT_ACL);
    expect(() => removePublicAccess(third.read.dataset, OWNER, REPORT)).toThrow(LockoutError);
  });

  it("allows class removal when the owner keeps direct Control", async () => {
    const pod = buildPod(); // #owner has direct Control; #shared is public Read
    const { read } = await entriesAt(pod, REPORT_ACL);
    const { removePublicFromEntry } = await import("../../src/lib/acl.js");
    removePublicFromEntry(read.dataset, `${REPORT_ACL}#shared`, OWNER, REPORT);
    expect(projectEntries(read.dataset).some((e) => e.isPublic)).toBe(false);
  });
});

describe("scope-aware lockout guard (roborev round 3 Medium)", () => {
  it("an unrelated-resource Control entry in the SAME document does not satisfy the guard", async () => {
    const pod = buildPod();
    const OTHER = `${POD}docs/other.ttl`;
    // The owner's only Control APPLYING TO REPORT is the authenticated-class
    // entry; the direct Control entry in the same doc names a DIFFERENT
    // resource, so it must not count.
    pod.seed(
      REPORT_ACL,
      `${PREFIXES}
<${REPORT_ACL}#other> a acl:Authorization ; acl:agent <${OWNER}> ;
  acl:accessTo <${OTHER}> ; acl:mode acl:Read, acl:Write, acl:Control .
<${REPORT_ACL}#auth> a acl:Authorization ;
  acl:agentClass acl:AuthenticatedAgent ;
  acl:accessTo <${REPORT}> ; acl:mode acl:Read, acl:Write, acl:Control .`,
    );
    const { read } = await entriesAt(pod, REPORT_ACL);
    const { removeAuthenticatedFromEntry, ownerRetainsAnyControl } = await import(
      "../../src/lib/acl.js"
    );
    expect(ownerRetainsAnyControl(read.dataset, OWNER, OTHER)).toBe(true);
    expect(() =>
      removeAuthenticatedFromEntry(read.dataset, `${REPORT_ACL}#auth`, OWNER, REPORT),
    ).toThrow(LockoutError);
  });

  it("an ancestor acl:default Control entry DOES apply to descendants", async () => {
    const pod = buildPod();
    // Root ACL: owner Control via acl:default over the whole pod. Removing a
    // public class entry for a descendant is then safe.
    pod.seed(
      `${POD}.acl`,
      `${pod.body(`${POD}.acl`) ?? ""}
<${POD}.acl#pub> a <http://www.w3.org/ns/auth/acl#Authorization> ;
  <http://www.w3.org/ns/auth/acl#agentClass> <http://xmlns.com/foaf/0.1/Agent> ;
  <http://www.w3.org/ns/auth/acl#default> <${POD}> ;
  <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read> .`,
    );
    const read = await entriesAt(pod, `${POD}.acl`);
    const { removePublicFromEntry } = await import("../../src/lib/acl.js");
    removePublicFromEntry(read.read.dataset, `${POD}.acl#pub`, OWNER, `${POD}contacts/alice.ttl`);
    expect(projectEntries(read.read.dataset).some((e) => e.isPublic)).toBe(false);
  });
});
