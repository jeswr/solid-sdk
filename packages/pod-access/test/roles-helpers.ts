// AUTHORED-BY Codex

import { Store } from "n3";
import { vi } from "vitest";
import { writeWac } from "../src/index.js";
import { serialize } from "../src/rdf.js";
import type { AgentRef, Role, RolesOptions } from "../src/roles/index.js";
import { rolesToModes } from "../src/roles/index.js";
import { agentSubject, appendAcp } from "../src/roles/rdf.js";
import { grant, policy } from "./helpers.js";
export const root = "https://pod.example/";
export const resource = `${root}folder/file`;
export const owner = "https://alice.example/#me";
export const bob = "https://bob.example/#me";
export const manager = {
  agent: { type: "webid", id: owner } as AgentRef,
  role: "manager" as Role,
  inherited: false,
  source: "",
};
export function selection(role: Role = "viewer", agent: AgentRef = { type: "webid", id: bob }) {
  return { agent, role, inherited: false, source: "" };
}
export async function fixture(
  model: "wac" | "acp",
  url = resource,
  entries = [manager],
  members = false,
) {
  const rows = entries.map((g) => {
    const mapped = rolesToModes(g.role, "resource", { model });
    return {
      agent: g.agent,
      modes: new Set([...mapped.resource, ...(mapped.acr.length ? ["control" as const] : [])]),
    };
  });
  if (model === "wac")
    return writeWac(
      policy(
        ...rows.map((r) =>
          grant([[agentSubject(r.agent)]], {
            modes: r.modes,
            appliesTo: members ? "both" : "resource",
          }),
        ),
      ),
      url,
      `${url}.acl`,
    );
  const dataset = new Store();
  appendAcp(dataset, url, `${url}.acr`, rows, "css");
  if (members) {
    const { roots, properties } = await import("../src/roles/rdf.js");
    const { ACP } = await import("../src/rdf.js");
    for (const node of roots(dataset)) {
      const props = properties(node, dataset);
      for (const term of props.terms(`${ACP}accessControl`))
        props.terms(`${ACP}memberAccessControl`).add(term);
      for (const term of props.terms(`${ACP}access`)) props.terms(`${ACP}memberAccess`).add(term);
    }
  }
  return serialize(dataset);
}
export function memoryAccess(model: "wac" | "acp" = "wac") {
  const docs = new Map<string, { body: string; etag: string | null; type?: string }>();
  const heads = new Map<string, HeadersInit>();
  const calls: { url: string; init: RequestInit }[] = [];
  let intercept:
    | ((url: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>)
    | undefined;
  const suffix = model === "wac" ? ".acl" : ".acr";
  function advertise(url: string, endpoint = url + suffix) {
    heads.set(url, { link: `<${endpoint}>; rel="acl"` });
  }
  function put(url: string, body: string, etag: string | null = '"1"') {
    docs.set(url, { body, etag });
  }
  function attach(url: string, body?: string) {
    advertise(url);
    if (body !== undefined) put(url + suffix, body);
  }
  heads.set(root, {});
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const override = await intercept?.(url, init);
    if (override) return override;
    if (init.method === "HEAD") return new Response(null, { headers: heads.get(url) ?? {} });
    const doc = docs.get(url);
    if (init.method === "PUT") {
      const headers = new Headers(init.headers);
      if (doc ? headers.get("if-match") !== doc.etag : headers.get("if-none-match") !== "*")
        return new Response(null, { status: 412 });
      put(url, String(init.body), `"${Number(doc?.etag?.replaceAll('"', "") ?? 0) + 1}"`);
      return new Response(null, { status: 204 });
    }
    return doc
      ? new Response(doc.body, {
          headers: {
            "content-type": doc.type ?? "text/turtle",
            ...(doc.etag ? { etag: doc.etag } : {}),
          },
        })
      : new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const options: RolesOptions = { fetch, root };
  return {
    docs,
    heads,
    calls,
    fetch,
    options,
    advertise,
    attach,
    put,
    intercept(fn: NonNullable<typeof intercept>) {
      intercept = fn;
    },
    writes: () => calls.filter((c) => c.init.method === "PUT"),
  };
}
export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required fixture value was absent");
  return value;
}
