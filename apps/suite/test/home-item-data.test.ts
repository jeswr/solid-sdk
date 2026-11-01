// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { DataFactory, Store } from "n3";
import { expect, it, vi } from "vitest";
import {
  accessSummary,
  canWrite,
  isContainer,
  readItem,
} from "../src/apps/home/components/item/data";
import { openShare } from "../src/apps/home/components/item/open-share";
import type { DomainItem } from "../src/apps/home/lib/model/discovery";
import { DOMAINS } from "../src/apps/home/lib/model/domains";
import type { AgentRow, PermissionResource } from "../src/apps/home/lib/permissions";
import { itemActions, itemHref } from "../src/apps/home/state/presentation";
import { encodeRef } from "../src/lib/refs";

const root = "https://pod.example/alice/";
const url = `${root}contacts/ada.ttl`;
const owner = `${root}profile/card#me`;
function row(
  kind: AgentRow["kind"],
  id: string,
  resources: Partial<PermissionResource>[] = [{ url }],
  expiresAt?: string,
): AgentRow {
  return {
    key: id,
    id,
    kind,
    name: id,
    lines: [
      {
        key: id,
        dataType: undefined,
        domainId: "socials",
        inherited: false,
        role: "viewer",
        modes: ["read"],
        ...(expiresAt ? { expiresAt } : {}),
        resources: resources.map((resource) => ({
          url,
          isContainer: false,
          inherited: false,
          modes: ["read"],
          source: `${url}.acl`,
          node: "rule",
          ...resource,
        })),
      },
    ],
  };
}
it("summarises only effective resource access and inherited ancestor access without exposing identifiers", () => {
  expect(accessSummary([], url, owner).text).toBe("Only you");
  const rows = [
    row("person", owner),
    row("person", "Ada"),
    row("person", "Bram", [{ url: `${root}contacts/`, isContainer: true, inherited: true }]),
    row("person", "Sibling", [{ url: `${root}contact/`, isContainer: true, inherited: true }]),
    row("person", "Not inherited", [{ url: `${root}contacts/`, isContainer: true }]),
    row("person", "Expired", [{ url }], "2000-01-01T00:00:00Z"),
    row("person", "Write only", [{ modes: ["write"] }]),
    row("app", "App"),
  ];
  const summary = accessSummary(rows, url, owner);
  expect(summary.text).toBe("You and 2 people");
  expect(summary.people.map((person) => person.id)).toEqual(["Ada", "Bram"]);
  expect(summary.apps).toHaveLength(1);
  expect(accessSummary([...rows, row("authenticated", "Signed in")], url, owner).text).toBe(
    "Anyone signed in",
  );
  expect(accessSummary([...rows, row("public", "Public")], url, owner).text).toBe(
    "Anyone with the link",
  );
  expect(openShare(url)).toBe(`/permissions?item=${encodeRef(url)}`);
});
it("lets WAC-Allow override the storage fallback and distinguishes append from write", () => {
  expect(canWrite(url, root, null)).toBe(true);
  expect(canWrite("https://foreign.example/x", root, null)).toBe(false);
  expect(canWrite(url, root, 'user="read",public="write"')).toBe(false);
  expect(canWrite(url, root, 'user="read append"')).toBe(false);
  expect(canWrite(url, root, 'public="", user="read write"')).toBe(true);
  expect(canWrite(url, root, "malformed")).toBe(false);
});
it("shares primary-subject routes and carries a non-primary profile subject", async () => {
  const dataset = await parseRdf(
    '<#it> <https://schema.org/name> "Primary". <#contact> <https://schema.org/name> "Contact".',
    "text/turtle",
    { baseIRI: url },
  );
  const item = {
    url,
    subject: DataFactory.namedNode(`${url}#contact`),
    dataset,
    domain: DOMAINS[0],
    title: "Contact",
    containerUrl: root,
    etag: '"1"',
  } as DomainItem;
  expect(itemHref(item)).toBe(
    `/home/personal/i/${encodeRef(url)}?s=${encodeRef(`${url}#contact`)}`,
  );
  expect(itemActions(item, root)[1]?.href).toBe(`${itemHref(item)}#access`);
  expect(itemActions(item, root).find((action) => action.id === "edit")?.href).toBe(
    `${itemHref(item)}&edit=1`,
  );
  expect(itemActions(item, root, false).map((action) => action.id)).toEqual([
    "open",
    "access",
    "copy",
  ]);
  for (const type of [
    `${NS.LDP}Container`,
    `${NS.LDP}BasicContainer`,
    `${NS.POD_DRIVE}DriveRoot`,
  ]) {
    item.dataset = await parseRdf(`<#contact> a <${type}>.`, "text/turtle", { baseIRI: url });
    expect(isContainer(item)).toBe(true);
    expect(itemActions(item, root).some((action) => action.id === "delete")).toBe(false);
  }
  expect(
    itemActions({ ...item, dataset: new Store(), url: `${root}folder/` }, root).some(
      (action) => action.id === "delete",
    ),
  ).toBe(false);
});
it("reads the primary subject and validators, refuses foreign credentials, and exposes 404", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response('<#it> <https://schema.org/name> "Ada".', {
        headers: { "content-type": "text/turtle", etag: '"v1"' },
      }),
  );
  const session = {
    fetch,
    storageUrl: root,
    webId: owner,
    mode: "demo",
    displayName: "Alice",
    subscribe: () => () => {},
    reset: async () => {},
  } as const;
  const read = await readItem(session, url);
  expect(read.item.title).toBe("Ada");
  expect(read.item.subject.value).toBe(`${url}#it`);
  expect(read.writable).toBe(true);
  expect(read.size).toBeGreaterThan(0);
  await expect(readItem(session, "https://foreign.example/x")).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(readItem(session, url, `${url}#missing`)).rejects.toMatchObject({ status: 404 });
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(readItem(session, url)).rejects.toMatchObject({ status: 404 });
});

it("never offers Delete for an untyped resource with children and keeps blank subjects out of route queries", async () => {
  const dataset = await parseRdf(
    "<#contact> <http://www.w3.org/ns/ldp#contains> <child>.",
    "text/turtle",
    { baseIRI: url },
  );
  const item = {
    url,
    subject: DataFactory.namedNode(`${url}#contact`),
    dataset,
    domain: DOMAINS[0],
    title: "Folder",
    containerUrl: root,
    etag: '"1"',
  } as DomainItem;
  expect(isContainer(item)).toBe(true);
  expect(itemActions(item, root).some((action) => action.id === "delete")).toBe(false);
  expect(itemHref({ ...item, subject: DataFactory.blankNode("anonymous") })).not.toContain("?s=");
});

it("keeps the combined profile contact-details card distinct from the identity card", () => {
  const item = {
    url: `${root}profile/card`,
    subject: DataFactory.namedNode(owner),
    dataset: new Store(),
    domain: DOMAINS[0],
    dataType: DOMAINS[0]?.dataTypes.find((type) => type.id === "contact-details"),
    title: "Contact details",
    containerUrl: root,
    etag: null,
  } as DomainItem;
  expect(itemHref(item)).toBe(`/home/personal/i/${encodeRef(item.url)}?view=contact-details`);
  expect(itemActions(item, root)[1]?.href).toBe(`${itemHref(item)}#access`);
  const { namedNode, quad, literal } = DataFactory;
  const withPrimary = {
    ...item,
    dataset: new Store([
      quad(namedNode(`${item.url}#it`), namedNode("https://schema.org/name"), literal("Primary")),
    ]),
  };
  expect(itemHref(withPrimary)).toBe(
    `/home/personal/i/${encodeRef(item.url)}?s=${encodeRef(owner)}&view=contact-details`,
  );
});

it("offers deletion and sharing for file cards without treating their listing as an editable document", () => {
  const item = {
    url: `${root}drive/file.txt`,
    subject: DataFactory.namedNode(`${root}drive/file.txt`),
    dataset: new Store(),
    domain: DOMAINS[1],
    dataType: DOMAINS[1]?.dataTypes.find((type) => type.id === "files"),
    title: "file.txt",
    containerUrl: `${root}drive/`,
    etag: null,
  } as DomainItem;
  expect(itemActions(item, root).map((action) => action.id)).toEqual([
    "open",
    "access",
    "delete",
    "copy",
  ]);
});
