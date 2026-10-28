// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import type { Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { AclResource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { parentOf } from "../src/apps/drive/lib/client/client";
import { createDemoPod } from "../src/lib/demo-pod/pod";

export const ROOT = "https://wac.test/";
export const DRIVE = `${ROOT}drive/`;
export const PRIVATE = `${DRIVE}private/`;
export const PUBLIC = `${DRIVE}public/`;
export const OWNER = `${ROOT}profile#me`;
export const ACL = "http://www.w3.org/ns/auth/acl#";
export const EVERYONE = "http://xmlns.com/foaf/0.1/Agent";
export class WacFields extends TermWrapper {
  iris(predicate: string) {
    return SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string);
  }
}
export async function aclBody(resource: string, publicRead = false) {
  const data = new Store();
  for (const [name, predicate, agent, modes] of [
    ["owner", "agent", OWNER, ["Read", "Write", "Control"]],
    ...(publicRead ? [["public", "agentClass", EVERYONE, ["Read"]] as const] : []),
  ] as const) {
    const rule = new WacFields(`${resource}#${name}`, data, DataFactory);
    rule.iris("http://www.w3.org/1999/02/22-rdf-syntax-ns#type").add(`${ACL}Authorization`);
    rule.iris(`${ACL}accessTo`).add(resource);
    if (resource.endsWith("/")) rule.iris(`${ACL}default`).add(resource);
    rule.iris(`${ACL}${predicate}`).add(agent);
    for (const mode of modes) rule.iris(`${ACL}mode`).add(`${ACL}${mode}`);
  }
  return turtle(data);
}
export async function turtle(data: Store) {
  const writer = new Writer();
  writer.addQuads([...data]);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, body) => (error ? reject(error) : resolve(body))),
  );
}

/** Real WAC own/default resolution over a transport with LDP and ETags. */
export async function wacPod() {
  const pod = createDemoPod({
    root: ROOT,
    seed: [
      { path: "drive/private/secret", body: "secret contents", contentType: "text/plain" },
      { path: "drive/public/placeholder", body: "public", contentType: "text/plain" },
    ],
  });
  const policies = new Map<string, string>([
    [`${ROOT}.policy`, await aclBody(ROOT, true)],
    [`${PRIVATE}.policy`, await aclBody(PRIVATE)],
  ]);
  const calls: { url: string; method: string }[] = [];
  const exposures: string[] = [];
  let audit = false;
  let hook: ((url: string, init?: RequestInit) => Promise<Response | undefined>) | undefined;
  let after: ((url: string, method: string, response: Response) => Promise<Response>) | undefined;
  const anonymous = async (url: string): Promise<Response> => {
    let resource: string | undefined = url;
    let inherited = false;
    while (resource?.startsWith(ROOT)) {
      const body = policies.get(`${resource}.policy`);
      if (body !== undefined) {
        const data = await parseRdf(body, "text/turtle");
        const rules = [...new AclResource(data, DataFactory).authorizations];
        const applicable = rules.filter((rule) => {
          const fields = new WacFields(rule as Term, data, DataFactory);
          return (
            inherited
              ? [...fields.iris(`${ACL}default`), ...fields.iris(`${ACL}defaultForNew`)]
              : [...fields.iris(`${ACL}accessTo`)]
          ).includes(resource as string);
        });
        if (!inherited || applicable.length) {
          const allowed = applicable.some((rule) => rule.canRead && rule.agentClass.has(EVERYONE));
          return allowed ? pod.fetch(url) : new Response(null, { status: 403 });
        }
      }
      resource = parentOf(resource);
      inherited = true;
    }
    return new Response(null, { status: 403 });
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input),
      method = init?.method ?? "GET";
    calls.push({ url, method });
    const intercepted = await hook?.(url, init);
    let response: Response;
    if (intercepted) response = intercepted;
    else if (url.endsWith(".policy")) {
      const current = policies.get(url);
      const headers = new Headers(init?.headers);
      if (
        (headers.has("if-match") && headers.get("if-match") !== JSON.stringify(current)) ||
        (headers.get("if-none-match") === "*" && current !== undefined)
      )
        response = new Response(null, { status: 412 });
      else if (method === "PUT") {
        policies.set(url, String(init?.body));
        response = new Response(null, { status: 201 });
      } else
        response = new Response(method === "HEAD" ? null : (current ?? null), {
          status: current === undefined ? 404 : 200,
          headers: { "content-type": "text/turtle", etag: JSON.stringify(current) ?? '"absent"' },
        });
    } else {
      const raw = await pod.fetch(input, init);
      if (method === "DELETE" && raw.ok) policies.delete(`${url}.policy`);
      const headers = new Headers(raw.headers);
      headers.delete("x-solid-demo-access-control");
      headers.set("link", `<${url}.policy>; rel="acl"`);
      if (method === "PUT" && raw.ok && url.endsWith("/"))
        headers.set(
          "etag",
          (await pod.fetch(url, { method: "HEAD" })).headers.get("etag") as string,
        );
      response = new Response(raw.body, { status: raw.status, headers });
    }
    if (audit) {
      // Audit after EVERY request, including the moment between payload and ACL PUTs.
      for (const [resourceUrl] of pod.snapshot().resources) {
        const raw = await pod.fetch(resourceUrl);
        if (
          (await raw.text()) === "secret contents" &&
          (await anonymous(resourceUrl)).status === 200
        )
          exposures.push(`${method} ${url}: ${resourceUrl}`);
      }
    }
    return after ? after(url, method, response) : response;
  };
  return {
    pod,
    fetch,
    policies,
    calls,
    exposures,
    anonymous,
    audit() {
      audit = true;
    },
    intercept(fn: typeof hook) {
      hook = fn;
    },
    after(fn: typeof after) {
      after = fn;
    },
  };
}
