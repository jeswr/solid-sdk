// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import type { AgentRow, PermissionLine } from "../src/apps/home/lib/permissions";
import {
  accessRequestsEnabled,
  agentHref,
  agentId,
  agentName,
  consequenceText,
  dataTypeLabel,
  dataTypeLabels,
  durationLabel,
  featureLabel,
  parentNames,
  permissionDate,
  relativePath,
  revokeCopy,
  sameAgent,
  visibleRows,
} from "../src/apps/home/lib/permissions/view";

const root = "https://pod.test/";
const resource = {
  url: `${root}drive/Work/`,
  isContainer: true,
  modes: ["read"] as ["read"],
  inherited: false,
  source: `${root}drive/Work/.acl`,
  node: "urn:grant",
};
const line: PermissionLine = {
  key: "files",
  dataType: { id: "files", label: "Files" },
  domainId: "documents",
  resources: [resource],
  role: "viewer",
  modes: ["read"],
  inherited: false,
};
const bob: AgentRow = { key: "bob", kind: "person", id: "https://bob.test/card#me", lines: [line] };
const row = (overrides: Partial<AgentRow>) => ({ ...bob, ...overrides });

describe("permission copy and navigation", () => {
  it("uses names and safe fallback hosts, with plain names for pinned agents", () => {
    expect(agentName(bob)).toBe("bob.test");
    expect(agentName(row({ name: "Bob" }))).toBe("Bob");
    expect(agentName(row({ name: "  " }))).toBe("bob.test");
    expect(agentName(row({ kind: "public" }))).toBe("Anyone with the link");
    expect(agentName(row({ kind: "authenticated" }))).toBe("Anyone signed in");
    expect(agentName(row({ id: "not a URL" }))).toBe("Unknown account");
    expect(agentName(row({ id: "urn:person:bob" }))).toBe("Unknown account");
  });
  it("formats UTC dates, expiry, purposes and consequences without inventing metadata", () => {
    expect(permissionDate("2026-11-01")).toBe("Nov 1, 2026");
    for (const value of [undefined, "", "invalid"])
      expect(permissionDate(value)).toBe("Date unknown");
    expect(durationLabel(line)).toBe("Until revoked");
    expect(durationLabel({ ...line, expiresAt: "2026-12-01" })).toBe("Until Dec 1, 2026");
    expect(featureLabel(line, "Bob")).toBe("Used by Bob");
    expect(consequenceText(line, "Bob")).toBe("Bob will lose access to your Files");
    const purpose = { ...line, purpose: { label: "Build your training plan" } };
    expect(featureLabel(purpose, "Coach")).toBe("Build your training plan");
    expect(consequenceText(purpose, "Coach")).toBe(
      "Build your training plan will stop working in Coach",
    );
    expect(featureLabel({ ...line, purpose: { label: "" } }, "Bob")).toBe("Used by Bob");
  });
  it("labels binary Drive holdings, unknown data and distinct confirmation data types", () => {
    expect(dataTypeLabel(line)).toBe("Files");
    expect(dataTypeLabel({ ...line, dataType: undefined })).toBe("Files");
    expect(dataTypeLabel({ ...line, dataType: undefined, resources: [] })).toBe("Other data");
    expect(
      dataTypeLabel({
        ...line,
        dataType: undefined,
        resources: [{ ...resource, url: `${root}other` }],
      }),
    ).toBe("Other data");
    const contacts = { ...line, key: "contacts", dataType: { id: "contacts", label: "Contacts" } };
    const person = row({ name: "Bob", lines: [line, line, contacts] });
    expect(dataTypeLabels(person)).toEqual(["Files", "Contacts"]);
    expect(revokeCopy(person)).toEqual({
      title: "Remove all access for Bob?",
      description:
        "Bob will no longer be able to see or change Files, Contacts. You can share again later.",
    });
    expect(revokeCopy(row({ lines: [] })).description).toContain("your data");
    for (const kind of ["public", "authenticated"] as const) {
      expect(revokeCopy(row({ kind })).title).toBe("Make private?");
      expect(revokeCopy(row({ kind })).description).toContain(
        "Remove all public and signed-in access",
      );
    }
  });
  it("builds reversible detail references, including both pseudo agents and bad refs", () => {
    expect(agentId(agentHref(bob).split("/").at(-1) as string)).toBe(bob.id);
    for (const kind of ["public", "authenticated"] as const) {
      expect(agentHref(row({ kind }))).toBe(`/permissions/a/${kind}`);
      expect(agentId(kind)).toBe(kind);
    }
    expect(agentId("!broken!")).toBeUndefined();
    expect(agentHref(row({ id: "urn:unsupported" }))).toBe("/permissions/a/unknown");
  });
  it("matches an origin-only app id against its round-tripped detail reference", () => {
    const app = row({ kind: "app", id: "https://app.example" });
    const id = agentId(agentHref(app).split("/").at(-1) as string);
    expect(id).toBe("https://app.example/");
    expect(sameAgent(app.id, id)).toBe(true);
    expect(sameAgent(bob.id, bob.id)).toBe(true);
    expect(sameAgent(bob.id, undefined)).toBe(false);
    expect(sameAgent("public", "https://app.example/")).toBe(false);
    expect(sameAgent(app.id, "https://other.example/")).toBe(false);
  });
  it("displays paths without revealing foreign URLs and names inherited parents", () => {
    expect(relativePath(`${root}drive/Work/Budget%202026.csv`, root)).toBe(
      "drive/Work/Budget 2026.csv",
    );
    expect(relativePath(root, root)).toBe("/");
    expect(relativePath(`${root}bad%ZZ`, root)).toBe("bad%ZZ");
    expect(relativePath("https://foreign.test/private", root)).toBe("Outside your pod");
    expect(relativePath(`${root}elsewhere`, `${root}storage/`)).toBe("Outside your pod");
    expect(parentNames(line)).toEqual([]);
    const inherited = {
      ...line,
      inherited: true,
      resources: [
        { ...resource, inherited: true, inheritedFrom: `${root}drive/Work/` },
        { ...resource, inherited: true, inheritedFrom: `${root}drive/Work/` },
        { ...resource, inherited: true, inheritedFrom: root },
        { ...resource, inherited: true, url: `${root}My%20Photos/` },
        { ...resource, inherited: true, inheritedFrom: `${root}bad%ZZ/` },
      ],
    };
    expect(parentNames(inherited)).toEqual(["Work", "your pod", "My Photos", "bad%ZZ"]);
  });
  it("hides the Requests tab unless the explicit capability is true", () => {
    for (const json of [
      undefined,
      "",
      "bad",
      "null",
      "{}",
      '{"accessRequests":"true"}',
      '{"accessRequests":false}',
    ])
      expect(accessRequestsEnabled(json)).toBe(false);
    expect(accessRequestsEnabled('{"accessRequests":true}')).toBe(true);
  });
});

describe("permission sorting and filtering", () => {
  it("pins pseudo agents, separates apps, sorts latest first, and uses names for ties", () => {
    const people = [
      row({ key: "z", name: "Zed" }),
      row({ key: "old", since: "2020-01-01" }),
      row({ key: "app", kind: "app" }),
      row({ key: "new", lastChanged: "2026-11-01" }),
      row({ key: "auth", kind: "authenticated" }),
      row({ key: "a", name: "Ada", since: "bad" }),
      row({ key: "public", kind: "public" }),
    ];
    expect(visibleRows(people, "people", "").map((r) => r.key)).toEqual([
      "public",
      "auth",
      "new",
      "old",
      "a",
      "z",
    ]);
    expect(visibleRows(people, "apps", "").map((r) => r.key)).toEqual(["app"]);
    expect(people[0]?.key).toBe("z");
    expect(visibleRows(people, "people", " ADA ").map((r) => r.key)).toEqual(["a"]);
    expect(visibleRows(people, "people", "files")).toHaveLength(6);
    expect(visibleRows(people, "apps", "missing")).toEqual([]);
    expect(
      visibleRows(
        [
          row({ key: "app1", kind: "app", name: "B" }),
          row({ key: "app2", kind: "app", name: "A" }),
        ],
        "apps",
        "",
      ).map((r) => r.name),
    ).toEqual(["A", "B"]);
  });
});
