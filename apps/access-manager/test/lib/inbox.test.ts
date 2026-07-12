// AUTHORED-BY Claude Fable 5
// Inbox parsing of UNTRUSTED foreign RDF: well-formed ODRL requests project
// fully; malformed messages drop fields or surface as unparseable — the inbox
// never aborts on one bad message.

import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it } from "vitest";
import {
  discoverInbox,
  listInbox,
  projectAccessRequest,
  readAccessRequest,
} from "../../src/lib/inbox.js";
import {
  accessRequestTurtle,
  buildPod,
  CONTACTS_CLASS,
  INBOX,
  OWNER,
  PREFIXES,
  REQUESTER,
} from "../fixtures.js";

describe("discoverInbox", () => {
  it("finds ldp:inbox from the profile", async () => {
    const pod = buildPod();
    expect(await discoverInbox(OWNER, pod.fetch)).toBe(INBOX);
  });

  it("returns undefined for a profile without one", async () => {
    const pod = buildPod();
    pod.seed(`${OWNER.split("#")[0]}`, `${PREFIXES}<${OWNER}> a foaf:Person .`);
    expect(await discoverInbox(OWNER, pod.fetch)).toBeUndefined();
  });

  it("rejects a non-http inbox IRI (SSRF discipline)", async () => {
    const pod = buildPod();
    pod.seed(
      `${OWNER.split("#")[0]}`,
      `${PREFIXES}<${OWNER}> a foaf:Person ; ldp:inbox <file:///etc/> .`,
    );
    expect(await discoverInbox(OWNER, pod.fetch)).toBeUndefined();
  });
});

describe("readAccessRequest (well-formed)", () => {
  it("projects requester, modes, targets, purpose, expiry, status", async () => {
    const pod = buildPod();
    const request = await readAccessRequest(`${INBOX}request-1.ttl`, pod.fetch);
    expect(request).not.toBeNull();
    expect(request?.requester).toBe(REQUESTER);
    expect(request?.modes).toEqual(["Read"]);
    expect(request?.targets).toEqual([CONTACTS_CLASS]);
    expect(request?.dataClass).toBe(CONTACTS_CLASS);
    expect(request?.purpose).toBe("https://w3id.org/dpv#ServiceProvision");
    expect(request?.expiry).toContain("2027-01-01");
    expect(request?.status).toBe("Pending"); // no accm:status = fresh = Pending
    expect(request?.malformed).toBe(false);
    expect(request?.etag).toBe('"v1"');
  });
});

describe("projectAccessRequest (lenient on hostile/malformed input)", () => {
  it("a message with no ODRL policy is flagged malformed, not thrown", async () => {
    const dataset = await parseRdf(
      `${PREFIXES}<https://x.example/m> a foaf:Document .`,
      "text/turtle",
    );
    const r = projectAccessRequest("https://x.example/m", null, dataset);
    expect(r.malformed).toBe(true);
    expect(r.status).toBe("Pending");
    expect(r.targets).toEqual([]);
  });

  it("drops a NON-HTTP assignee instead of trusting it", async () => {
    const url = "https://x.example/m";
    const dataset = await parseRdf(
      `${PREFIXES}
<${url}> a odrl:Offer ; odrl:uid <${url}> ;
  odrl:permission [ odrl:assignee <urn:evil:agent> ; odrl:action odrl:read ;
                    odrl:target <https://pod.example/x.ttl> ] .`,
      "text/turtle",
      { baseIRI: url },
    );
    const r = projectAccessRequest(url, null, dataset);
    expect(r.requester).toBeUndefined();
    expect(r.targets).toEqual(["https://pod.example/x.ttl"]);
  });

  it("drops an unknown action but keeps the rest of the message", async () => {
    const url = "https://x.example/m";
    const dataset = await parseRdf(
      `${PREFIXES}
<${url}> a odrl:Offer ; odrl:uid <${url}> ;
  odrl:permission [ odrl:assignee <${REQUESTER}> ; odrl:action odrl:read ;
                    odrl:target <https://pod.example/x.ttl> ] ,
                  [ odrl:assignee <${REQUESTER}> ; odrl:action <https://evil.example/root> ;
                    odrl:target <https://pod.example/y.ttl> ] .`,
      "text/turtle",
      { baseIRI: url },
    );
    const r = projectAccessRequest(url, null, dataset);
    expect(r.requester).toBe(REQUESTER);
    // the recognised permission survives; the unknown action adds no mode
    expect(r.modes).toEqual(["Read"]);
  });

  it("a malformed purpose constraint drops the field, not the request", async () => {
    const url = "https://x.example/m";
    const dataset = await parseRdf(
      `${PREFIXES}
<${url}> a odrl:Offer ; odrl:uid <${url}> ;
  odrl:permission [ odrl:assignee <${REQUESTER}> ; odrl:action odrl:read ;
                    odrl:target <https://pod.example/x.ttl> ;
                    odrl:constraint [ odrl:leftOperand odrl:purpose ] ] .`,
      "text/turtle",
      { baseIRI: url },
    );
    const r = projectAccessRequest(url, null, dataset);
    expect(r.purpose).toBeUndefined();
    expect(r.requester).toBe(REQUESTER);
    expect(r.malformed).toBe(false);
  });

  it("parses a persisted snapshot (Approving) back out", async () => {
    const url = `${INBOX}request-1.ttl`;
    const dataset = await parseRdf(
      `${accessRequestTurtle(url)}
<${url}> accm:status accm:Approving ;
  accm:grantId "abc123" ;
  accm:schemaVersion "1" ;
  accm:agent <${REQUESTER}> ;
  accm:mode <http://www.w3.org/ns/auth/acl#Read> ;
  accm:resolvesTo <https://pod.example/contacts/alice.ttl>, <https://pod.example/contacts/carol.ttl> .`,
      "text/turtle",
      { baseIRI: url },
    );
    const r = projectAccessRequest(url, null, dataset);
    expect(r.status).toBe("Approving");
    expect(r.snapshot).toEqual({
      grantId: "abc123",
      targets: ["https://pod.example/contacts/alice.ttl", "https://pod.example/contacts/carol.ttl"],
      agent: REQUESTER,
      modes: ["Read"],
      schemaVersion: "1",
    });
  });
});

describe("listInbox", () => {
  it("lists all messages; a hostile/unfetchable member never aborts the list", async () => {
    const pod = buildPod();
    pod.seed(`${INBOX}note.ttl`, `${PREFIXES}<${INBOX}note.ttl> a foaf:Document .`);
    pod.seed(`${INBOX}broken.ttl`, "this is not turtle @@@");
    const list = await listInbox(INBOX, pod.fetch);
    expect(list).toHaveLength(3);
    const broken = list.find((r) => r.url.endsWith("broken.ttl"));
    expect(broken?.malformed).toBe(true);
    const good = list.find((r) => r.url.endsWith("request-1.ttl"));
    expect(good?.malformed).toBe(false);
  });

  it("an empty/missing inbox lists nothing", async () => {
    const pod = buildPod();
    expect(await listInbox("https://pod.example/empty-inbox/", pod.fetch)).toEqual([]);
  });
});
