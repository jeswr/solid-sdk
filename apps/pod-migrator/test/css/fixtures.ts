// AUTHORED-BY Codex GPT-6
import assert from "node:assert/strict";
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { createPodHttp, type Mode, type PodSide } from "../../src/engine/index.js";
import type { CssAccount } from "./account.js";
import { accessLink } from "./probe.js";
import type { System } from "./server.js";

const ACL = "http://www.w3.org/ns/auth/acl#";
const ACP = "http://www.w3.org/ns/solid/acp#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const FOAF = "http://xmlns.com/foaf/0.1/";

/** Fixture writer is independent of the migrator's readers and serializers. */
class FixtureNode extends TermWrapper {
  iri(predicate: string, value: string): void {
    SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string).add(value);
  }
  text(predicate: string, value: string): void {
    SetFrom.subjectPredicate(this, predicate, (term) => term.value, LiteralFrom.string).add(value);
  }
}

async function turtle(store: Store): Promise<string> {
  const writer = new Writer();
  writer.addQuads([...store]);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

export interface FixtureRule {
  agent?: string;
  public?: boolean;
  authenticated?: boolean;
  group?: string;
  origin?: string;
  client?: string;
  exceptAgent?: string;
  allow?: Mode[];
  deny?: Mode[];
  scope?: "resource" | "members" | "both";
}

export async function fixtureAccess(
  system: System,
  resource: string,
  acl: string,
  rules: FixtureRule[],
  legacyAcrSelf = false,
): Promise<string> {
  const store = new Store();
  const node = (iri: string) => new FixtureNode(iri, store, DataFactory);
  const root = node(acl);
  if (system === "acp") {
    root.iri(`${RDF}type`, `${ACP}AccessControlResource`);
    root.iri(`${ACP}resource`, resource);
  }
  const modeIri = (mode: Mode) => ACL + mode[0]?.toUpperCase() + mode.slice(1);
  for (const [index, rule] of rules.entries()) {
    const scope = rule.scope ?? "resource";
    const id = `${acl}#fixture-${index}`;
    const entry = node(id);
    if (system === "wac") {
      assert.ok(!rule.deny?.length && !rule.client && !rule.exceptAgent);
      entry.iri(`${RDF}type`, `${ACL}Authorization`);
      if (scope !== "members") entry.iri(`${ACL}accessTo`, resource);
      if (scope !== "resource") entry.iri(`${ACL}default`, resource);
      if (rule.agent) entry.iri(`${ACL}agent`, rule.agent);
      if (rule.public) entry.iri(`${ACL}agentClass`, `${FOAF}Agent`);
      if (rule.authenticated) entry.iri(`${ACL}agentClass`, `${ACL}AuthenticatedAgent`);
      if (rule.group) entry.iri(`${ACL}agentGroup`, rule.group);
      if (rule.origin) entry.iri(`${ACL}origin`, rule.origin);
      for (const mode of rule.allow ?? []) entry.iri(`${ACL}mode`, modeIri(mode));
      continue;
    }
    assert.ok(!rule.group && !rule.origin);
    const access = node(`${id}-access`);
    access.iri(`${RDF}type`, `${ACP}AccessControl`);
    access.iri(`${ACP}apply`, id);
    if (scope !== "members") root.iri(`${ACP}accessControl`, access.value);
    if (scope !== "resource") root.iri(`${ACP}memberAccessControl`, access.value);
    entry.iri(`${RDF}type`, `${ACP}Policy`);
    const matcher = node(`${id}-matcher`);
    matcher.iri(`${RDF}type`, `${ACP}Matcher`);
    if (rule.agent) matcher.iri(`${ACP}agent`, rule.agent);
    if (rule.public) matcher.iri(`${ACP}agent`, `${ACP}PublicAgent`);
    if (rule.authenticated) matcher.iri(`${ACP}agent`, `${ACP}AuthenticatedAgent`);
    if (rule.client) matcher.iri(`${ACP}client`, rule.client);
    entry.iri(`${ACP}allOf`, matcher.value);
    if (rule.exceptAgent) {
      const except = node(`${id}-except`);
      except.iri(`${ACP}agent`, rule.exceptAgent);
      entry.iri(`${ACP}noneOf`, except.value);
    }
    for (const mode of rule.allow ?? []) entry.iri(`${ACP}allow`, modeIri(mode));
    for (const mode of rule.deny ?? []) entry.iri(`${ACP}deny`, modeIri(mode));
    if (legacyAcrSelf && rule.allow?.includes("control")) {
      // Deliberately ambiguous round-3 fixture, retained for refusal regressions.
      // CSS authorizes ACR operations through resource acl:Control; these extra
      // ESS-style constructs do not establish Control on CSS.
      const acr = node(`${id}-acr`);
      acr.iri(`${ACP}resource`, acl);
      acr.iri(`${ACP}accessControl`, access.value);
      root.iri(`${ACP}access`, id);
    }
  }
  return turtle(store);
}

export function ownerRule(owner: string, container = false): FixtureRule {
  return {
    agent: owner,
    allow: ["read", "write", "control"],
    scope: container ? "both" : "resource",
  };
}

export async function setAccess(
  side: PodSide,
  system: System,
  resource: string,
  rules: FixtureRule[],
): Promise<string> {
  const head = await side.http.head(resource);
  assert.equal(head.status, 200, `Owner cannot discover controls on ${resource}`);
  const acl = accessLink(head, resource);
  const response = await side.http.put(acl, await fixtureAccess(system, resource, acl, rules), {
    contentType: "text/turtle",
  });
  assert.ok(response.ok, `Fixture ACL PUT ${acl} failed (${response.status})`);
  await response.arrayBuffer();
  return acl;
}

export async function putFixture(
  side: PodSide,
  path: string,
  body: string | Uint8Array,
  contentType = "text/turtle",
): Promise<void> {
  const response = await side.http.put(new URL(path, side.root).href, body, { contentType });
  assert.ok(response.ok, `Fixture PUT ${path} failed (${response.status})`);
  await response.arrayBuffer();
}

export interface SourceFixture {
  system: System;
  account: CssAccount;
  side: PodSide;
  paths: string[];
  files: Map<string, Uint8Array>;
  faithful: Set<string>;
  stranger: CssAccount;
}

export async function seedSource(
  account: CssAccount,
  stranger: CssAccount,
  system: System,
  reader?: CssAccount,
): Promise<SourceFixture> {
  if (system === "wac") {
    assert.ok(reader, "WAC's unreadable ACL requires a delegated migration session");
    assert.notEqual(reader.webId, account.webId, "The delegated reader cannot be the pod owner");
  }
  const root = `${account.podRoot}migration/`;
  const side: PodSide = {
    root,
    ownerWebId: account.webId,
    implementation: "css",
    http: createPodHttp({ root, fetch: account.fetch, allowInsecureLoopback: true }),
  };
  await putFixture(account.side, "migration/", "");
  const owners = (container: boolean): FixtureRule[] => [
    ownerRule(account.webId, container),
    ...(reader ? [ownerRule(reader.webId, container)] : []),
  ];
  await setAccess(side, system, root, [...owners(true), { public: true, allow: ["read"] }]);
  const paths = ["", "public/", "public/nested/", "private/", "authenticated/"];
  for (const path of paths.slice(1)) await putFixture(side, path, "");
  const files = new Map<string, Uint8Array>();
  const encode = (value: string) => new TextEncoder().encode(value);
  const rdfStore = new Store();
  const note = new FixtureNode("urn:migration:note", rdfStore, DataFactory);
  note.iri(`${RDF}type`, "http://schema.org/Note");
  note.text("http://schema.org/text", "Migration café — 漢字 🌱\nsecond line");
  files.set("public/nested/note.ttl", encode(await turtle(rdfStore)));
  files.set(
    "private/data.json",
    encode(`${JSON.stringify({ nested: { ok: true }, items: [1, "é", null] })}\n`),
  );
  files.set(
    "private/bytes.bin",
    Uint8Array.from({ length: 1024 }, (_, i) => (i * 73) % 256),
  );
  files.set(
    "private/caf%C3%A9%20%E6%BC%A2%E5%AD%97.txt",
    encode("spaces and Unicode: café 漢字 🌱\n"),
  );
  // CSS 7.2 sends a Content-Length counted in characters, not bytes, for Turtle it re-serialises
  // after a PATCH, truncating non-ASCII documents. The append probe PATCHes shared.ttl, so keep
  // it ASCII; note.ttl and the Unicode file name still cover non-ASCII content.
  const sharedStore = new Store();
  const shared = new FixtureNode("urn:migration:shared", sharedStore, DataFactory);
  shared.iri(`${RDF}type`, "http://schema.org/Note");
  shared.text("http://schema.org/text", "Shared with the stranger\nsecond line");
  files.set("shared.ttl", encode(await turtle(sharedStore)));
  files.set("authenticated/info.json", encode('{"authenticated":true}\n'));
  files.set("conflict.json", encode('{"version":"source"}\n'));
  if (system === "wac") {
    files.set("public/narrow.txt", encode("This child overrides the public parent default.\n"));
    files.set("group-only.txt", encode("Only current vCard group members can read this.\n"));
    files.set("origin-only.txt", encode("This grant carries an origin condition.\n"));
    files.set("unreadable.txt", encode("Readable body, inaccessible ACL.\n"));
    const groups = new Store();
    const group = new FixtureNode(`${root}group.ttl#team`, groups, DataFactory);
    group.iri(`${RDF}type`, `${VCARD}Group`);
    group.iri(`${VCARD}hasMember`, stranger.webId);
    files.set("group.ttl", encode(await turtle(groups)));
  } else {
    files.set("deny.ttl", encode(await turtle(rdfStore)));
    files.set("client.ttl", encode(await turtle(rdfStore)));
    files.set("exclusion.ttl", encode(await turtle(rdfStore)));
  }
  for (const [path, bytes] of files) {
    const type = path.endsWith(".ttl")
      ? "text/turtle"
      : path.endsWith(".json")
        ? "application/json"
        : path.endsWith(".bin")
          ? "application/octet-stream"
          : "text/plain";
    await putFixture(side, path, bytes, type);
    paths.push(path);
  }
  const set = (path: string, rules: FixtureRule[]) =>
    setAccess(side, system, `${root}${path}`, [...owners(path.endsWith("/")), ...rules]);
  await set("public/", [{ public: true, allow: ["read"], scope: "both" }]);
  // Leave the nested folder and its Turtle file without their own controls:
  // source evaluation must actually traverse ancestors, including ACP members.
  await set("authenticated/", [{ authenticated: true, allow: ["read"], scope: "both" }]);
  await set("shared.ttl", [{ agent: stranger.webId, allow: ["read", "append"] }]);
  if (system === "wac") {
    await set("public/narrow.txt", []);
    await set("group.ttl", [{ public: true, allow: ["read"] }]);
    await set("group-only.txt", [{ group: `${root}group.ttl#team`, allow: ["read"] }]);
    await set("origin-only.txt", [
      { agent: stranger.webId, origin: "https://app.example.test", allow: ["read"] },
    ]);
    await setAccess(side, system, `${root}unreadable.txt`, [
      { agent: account.webId, allow: ["read", "write"] },
      ...(reader ? [{ agent: reader.webId, allow: ["read", "write"] as Mode[] }] : []),
    ]);
  } else {
    await set("deny.ttl", [
      { public: true, allow: ["read", "append"] },
      { agent: stranger.webId, deny: ["read"] },
    ]);
    // CSS credentials use an opaque label, not an absolute RDF IRI. Bind the
    // matcher to its explicit resolved IRI; these sessions must NOT match it.
    await set("client.ttl", [
      {
        agent: stranger.webId,
        client: new URL(stranger.clientId, `${root}client.ttl.acr`).href,
        allow: ["read"],
      },
    ]);
    await set("exclusion.ttl", [
      { authenticated: true, exceptAgent: stranger.webId, allow: ["read"] },
    ]);
  }
  const faithful = new Set(
    paths.filter(
      (path) =>
        ![
          "unreadable.txt",
          "origin-only.txt",
          "group-only.txt",
          "deny.ttl",
          "client.ttl",
          "exclusion.ttl",
          "conflict.json",
        ].includes(path),
    ),
  );
  // CSS's OwnerPermissionReader lets a pod owner recover its ACLs regardless of
  // their contents. A delegated session is necessary for a genuine unreadable
  // source ACL; it has Control everywhere else and body access on this file.
  const migrationSide = reader
    ? {
        root,
        ownerWebId: reader.webId,
        implementation: "css" as const,
        http: createPodHttp({ root, fetch: reader.fetch, allowInsecureLoopback: true }),
      }
    : side;
  return { system, account, stranger, side: migrationSide, paths, files, faithful };
}
