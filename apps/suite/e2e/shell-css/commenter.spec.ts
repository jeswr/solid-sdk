// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { randomUUID } from "node:crypto";
import { addIriTriple, addLiteralTriple } from "@jeswr/rdf-serialize/wrapper";
import type { DatasetCore } from "@rdfjs/types";
import { Authorization, Resource } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { DocumentCommentStore } from "../../src/apps/docs/lib/model/comments";
import { WacSharingAdapter } from "../../src/shell/share/wac-adapter";
import { accountAuth, cssAccount, expect, signedOutTest as test } from "./fixtures";

const ACL = "http://www.w3.org/ns/auth/acl#";
const OA = "http://www.w3.org/ns/oa#";
const CREATOR = "http://purl.org/dc/terms/creator";

function turtle(dataset: DatasetCore): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads([...dataset]);
    writer.end((error, body) => (error ? reject(error) : resolve(body)));
  });
}

function comment(url: string, creator: string, text: string) {
  const dataset = new Store();
  const node = new Resource(url, dataset, DataFactory);
  node.type.add(`${OA}Annotation`);
  addIriTriple(node, CREATOR, creator);
  addLiteralTriple(node, `${OA}bodyValue`, text);
  return dataset;
}

function acl(resource: string, legacy: boolean) {
  const dataset = new Store();
  const grant = (webId: string, modes: string[]) => {
    const auth = new Authorization(DataFactory.blankNode(), dataset, DataFactory);
    auth.type.add(`${ACL}Authorization`);
    auth.agent.add(webId);
    auth.accessTo = resource;
    if (resource.endsWith("/")) auth.default = resource;
    for (const mode of modes) auth.mode.add(ACL + mode);
  };
  grant(cssAccount("alice").webId, ["Read", "Write", "Control"]);
  if (legacy) grant(cssAccount("bob").webId, resource.endsWith("/") ? ["Append"] : ["Read"]);
  return dataset;
}

for (const legacy of [false, true]) {
  test(`commenter can POST but cannot append to an owner's existing comment (${legacy ? "migration" : "new grant"})`, async () => {
    const alice = await accountAuth("alice");
    const bob = await accountAuth("bob");
    const root = new URL(`alice/wac-commenter-${randomUUID()}/`, cssAccount("alice").issuer).href;
    const file = new URL("document", root).href;
    const comments = new URL("comments/", root).href;
    const ownerComment = new URL("owner.ttl", comments).href;
    const created: string[] = [];
    const put = async (url: string, body: string) => {
      const response = await alice.fetch(url, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-none-match": "*" },
        body,
      });
      expect(response.status).toBe(201);
      await response.body?.cancel();
    };
    const patch = async (url: string, actor: string, text: string) =>
      [
        "@prefix solid: <http://www.w3.org/ns/solid/terms#>.",
        "_:patch a solid:InsertDeletePatch; solid:inserts {",
        await turtle(comment(url, actor, text)),
        "}.",
      ].join("\n");
    try {
      await put(root, "");
      created.push(root);
      await put(file, "");
      created.push(file);
      await put(comments, "");
      created.push(comments);
      await put(`${file}.acl`, await turtle(acl(file, legacy)));
      await put(`${comments}.acl`, await turtle(acl(comments, legacy)));
      await put(
        ownerComment,
        await turtle(comment(ownerComment, cssAccount("alice").webId, "Owner's comment")),
      );
      created.push(ownerComment);

      const anonymous = await fetch(ownerComment, { redirect: "error" });
      expect(anonymous.status).toBe(401);
      await anonymous.body?.cancel();
      const before = await bob.fetch(ownerComment);
      expect(before.status).toBe(403);
      await before.body?.cancel();

      // Prove the insert-only patch is valid and exercises Append, before testing denial.
      const baseline = await (legacy ? bob : alice).fetch(ownerComment, {
        method: "PATCH",
        headers: { "content-type": "text/n3" },
        body: await patch(ownerComment, cssAccount("alice").webId, "Valid append before narrowing"),
      });
      expect(baseline.ok).toBe(true);
      await baseline.body?.cancel();

      const writes: { url: string; etag: string | null; previousEtag: string | null }[] = [];
      const validators = new Map<string, string | null>();
      const ownerFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (init?.method === "PUT")
          writes.push({
            url,
            etag: new Headers(init.headers).get("if-match"),
            previousEtag: validators.get(url) ?? null,
          });
        const response = await alice.fetch(input, init);
        if (!init?.method || init.method === "GET")
          validators.set(url, response.headers.get("etag"));
        return response;
      };
      const adapter = new WacSharingAdapter({
        fetch: ownerFetch,
        webId: cssAccount("alice").webId,
        commentsUrl: comments,
      });
      await adapter.load(file, new AbortController().signal);
      await adapter.setPerson(file, cssAccount("bob").webId, "commenter");
      expect(writes).toHaveLength(legacy ? 1 : 2);
      for (const write of writes) {
        expect(write.previousEtag).toMatch(/^"[^"\r\n]*"$/);
        expect(write.etag).toBe(write.previousEtag);
      }
      if (legacy) expect(writes[0]?.url).toBe(`${comments}.acl`);
      expect((await adapter.load(file, new AbortController().signal)).people).toContainEqual({
        webId: cssAccount("bob").webId,
        role: "commenter",
      });

      const read = await bob.fetch(ownerComment);
      expect(read.status).toBe(legacy ? 403 : 200);
      await read.body?.cancel();
      const ownerRead = await alice.fetch(ownerComment);
      expect(ownerRead.status).toBe(200);
      const original = await ownerRead.text();
      // Publish through the Docs client: a commenter has Append on the container only, so a
      // PUT-create of a member is refused and comments must be created with POST.
      if (!legacy) {
        const put = await bob.fetch(new URL(`${randomUUID()}.ttl`, comments).href, {
          method: "PUT",
          headers: { "content-type": "text/turtle", "if-none-match": "*" },
          body: await turtle(comment(comments, cssAccount("bob").webId, "Must be refused")),
        });
        expect(put.status).toBe(403);
        await put.body?.cancel();
      }
      const store = new DocumentCommentStore(comments, file, bob.fetch);
      const published = await store.create("New comment", cssAccount("bob").webId, {
        exact: "word",
        prefix: "",
        suffix: "",
        start: "AA==",
        end: "AQ==",
      });
      const postedUrl = published.url;
      expect(postedUrl.startsWith(comments)).toBe(true);
      created.push(postedUrl);
      const postedRead = await alice.fetch(postedUrl);
      expect(postedRead.status).toBe(200);
      expect(await postedRead.text()).toContain("New comment");
      const commenterRead = await bob.fetch(postedUrl);
      expect(commenterRead.status).toBe(legacy ? 403 : 200);
      await commenterRead.body?.cancel();

      const denied = await bob.fetch(ownerComment, {
        method: "PATCH",
        headers: { "content-type": "text/n3" },
        body: await patch(
          ownerComment,
          cssAccount("bob").webId,
          "Must not reach the owner's comment",
        ),
      });
      expect(denied.status).toBe(403);
      await denied.body?.cancel();
      const retained = await alice.fetch(ownerComment);
      expect(retained.status).toBe(200);
      expect(await retained.text()).toBe(original);
    } finally {
      for (const url of created.reverse()) {
        const response = await alice.fetch(url, { method: "DELETE" });
        expect.soft(response.ok).toBe(true);
        await response.body?.cancel();
      }
      await Promise.all([alice.logout(), bob.logout()]);
    }
  });
}
