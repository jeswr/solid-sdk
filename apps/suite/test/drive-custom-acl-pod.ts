// AUTHORED-BY Codex
import { parseRdf } from "@jeswr/fetch-rdf";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { parentOf } from "../src/apps/drive/lib/client/client";
import { rdfPod } from "./drive-rdf-pod";
import { ACL, OWNER, ROOT } from "./drive-wac-pod";

/** Owner-enforcing WAC, including absent arbitrary own-ACL endpoints. */
export async function customAclPod() {
  const f = await rdfPod();
  const calls: { url: string; method: string }[] = [];
  const tags = new Map<string, string>();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const protectedUrl = [...f.endpoints].find(([, endpoint]) => endpoint === url)?.[0];
    const auxiliary = protectedUrl !== undefined || url.endsWith(".acl");
    let resource: string | undefined = auxiliary ? (protectedUrl ?? url.slice(0, -4)) : url;
    const subject = resource;
    let inherited = false;
    let allowed = false;
    while (resource?.startsWith(ROOT)) {
      const body = f.policies.get(`${resource}.policy`);
      if (body !== undefined) {
        const data = await parseRdf(body, "text/turtle");
        const mode = auxiliary ? "Control" : ["GET", "HEAD"].includes(method) ? "Read" : "Write";
        allowed = [...new AclResource(data, DataFactory).authorizations].some(
          (rule) =>
            (inherited ? rule.default === resource : rule.accessTo === resource) &&
            rule.agent.has(OWNER) &&
            rule.mode.has(`${ACL}${mode}`),
        );
        break;
      }
      resource = parentOf(resource);
      inherited = true;
    }
    if (!allowed) return new Response(null, { status: 403 });
    if (auxiliary) {
      const headers = new Headers(init?.headers);
      const approved = [...tags].find(([, tag]) => tag === headers.get("if-match"));
      if (approved) headers.set("if-match", approved[0]);
      const response = await f.fetch(`${subject}.policy`, { ...init, headers });
      if (method === "DELETE" && response.ok) f.policies.delete(`${subject}.policy`);
      const receipt = response.headers.get("etag");
      if (receipt) {
        if (!tags.has(receipt)) tags.set(receipt, `"custom-policy-${tags.size}"`);
        response.headers.set("etag", tags.get(receipt) as string);
      }
      return response;
    }
    if (!f.endpoints.has(url)) f.endpoints.set(url, `${url}.acl`);
    return f.fetch(input, init);
  };
  return { ...f, fetch, calls };
}
