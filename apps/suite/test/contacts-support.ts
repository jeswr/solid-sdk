// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import type { DatasetCore } from "@rdfjs/types";
import { expect } from "vitest";
import { ContactsModel } from "../src/apps/contacts/lib/model";

export const ROOT = "https://pod.example/alice/";
export const BOOK = `${ROOT}contacts/book.ttl`;
export const PEOPLE = `${ROOT}contacts/people.ttl`;
export const GROUPS = `${ROOT}contacts/groups.ttl`;
export const ALICE = `${ROOT}contacts/people/alice.ttl`;
export const BOB = `${ROOT}contacts/people/bob.ttl`;
export const FRIENDS = `${ROOT}contacts/groups/friends.ttl`;
export const PM = `${ROOT}contacts/old.ttl`;
export const INDEX = `${ROOT}settings/privateTypeIndex.ttl`;
export const VCARD_PREFIX = "@prefix vcard: <http://www.w3.org/2006/vcard/ns#> .";
export const fixture = (file: string) =>
  readFileSync(new URL(`fixtures/contacts/${file}.ttl`, import.meta.url), "utf8");
export const parse = (text: string, url = BOOK) => parseRdf(text, "text/turtle", { baseIRI: url });

export class MemoryPod {
  files = new Map<string, { body: string; etag: string | null }>();
  requests: { url: string; method: string; headers: Headers; body: string | undefined }[] = [];
  fail: ((url: string, method: string) => Response | undefined) | undefined;
  revision = 10;
  seed(url: string, body: string, etag: string | null = '"1"') {
    this.files.set(url, { body, etag });
  }
  async seedDataset(url: string, dataset: DatasetCore) {
    this.seed(url, await serialize([...dataset]));
  }
  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = init?.body as string | undefined;
    this.requests.push({ url, method, headers, body });
    const fail = this.fail?.(url, method);
    if (fail) return fail;
    const existing = this.files.get(url);
    if (method === "GET") {
      return existing
        ? new Response(existing.body, {
            headers: {
              "content-type": "text/turtle",
              ...(existing.etag ? { etag: existing.etag } : {}),
            },
          })
        : new Response(null, { status: 404 });
    }
    expect(["PUT", "DELETE"]).toContain(method);
    const ifMatch = headers.get("If-Match");
    const ifNoneMatch = headers.get("If-None-Match");
    // Deliberately enforce protocol preconditions rather than merely checking call shapes.
    expect(ifMatch !== null || ifNoneMatch === "*").toBe(true);
    if ((ifNoneMatch === "*" && existing) || (ifMatch && existing?.etag !== ifMatch)) {
      return new Response(null, { status: 412, headers: { etag: existing?.etag ?? '"missing"' } });
    }
    if (method === "DELETE") this.files.delete(url);
    else {
      expect(headers.get("content-type")).toBe("text/turtle");
      await parse(body ?? "", url);
      this.seed(url, body ?? "", `"${++this.revision}"`);
    }
    return new Response(null, { status: 204, headers: { etag: `"${this.revision}"` } });
  };
  get writes() {
    return this.requests.filter((request) => request.method !== "GET");
  }
}

export async function setup() {
  const pod = new MemoryPod();
  for (const [url, name] of [
    [BOOK, "book"],
    [PEOPLE, "people"],
    [GROUPS, "groups"],
    [ALICE, "alice"],
    [PM, "pm"],
  ]) {
    if (url && name) pod.seed(url, fixture(name));
  }
  pod.seed(
    FRIENDS,
    `${VCARD_PREFIX} <#this> a vcard:Group; vcard:fn "Friends"; vcard:inAddressBook <../book.ttl#this>; vcard:hasMember <../people/alice.ttl#this> .`,
  );
  const model = new ContactsModel(pod.fetch, ROOT);
  return { pod, model, book: await model.loadAddressBook() };
}
