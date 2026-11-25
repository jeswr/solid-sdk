// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Sonnet 5.5
import { readContainerMembers } from "@jeswr/ldp-container";
import type { EffectivePolicy } from "@jeswr/pod-access";
import { createTypeIndex } from "@jeswr/pod-type-index";
import { createPodClient, StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { type Mock, vi } from "vitest";
import { createEventsRepository, EVENT_STATUS, type EventData } from "../src/index.js";

export const ROOT = "https://host.example/";
export const OWNER = `${ROOT}profile/card#me`;
export const session = (fetch: typeof globalThis.fetch) => ({
  fetch,
  storageUrl: ROOT,
  webId: OWNER,
  mode: "solid",
});
export const ownerGrant = (
  acl: string,
  _target: string,
  who: EffectivePolicy["grants"][number]["who"],
): EffectivePolicy["grants"][number] => ({
  modes: new Set(["read", "write", "control"]),
  who,
  except: [],
  appliesTo: "both",
  source: { url: acl, node: `${acl}#rule` },
});
export const eventData = (): EventData => ({
  name: "Supper",
  startDate: new Date("2027-02-01T18:00:00Z"),
  organizer: OWNER,
  eventStatus: EVENT_STATUS.scheduled,
  guestListVisible: false,
  visibility: "link",
  publication: "published",
  created: new Date("2026-11-11T12:00:00Z"),
  modified: new Date("2026-11-11T12:00:00Z"),
});
export function harness(owner = OWNER) {
  const storage = createMemoryStorage({ root: ROOT, protocol: "solid" });
  storage.features.accessControl = {
    state: "available",
    detail: { model: "wac" },
    evidence: "fixture",
  };
  const head = storage.head.bind(storage);
  storage.head = async (...args) => ({
    ...(await head(...args)),
    links: new Map([["acl", [{ target: `${args[0]}.acl`, params: {} }]]]),
  });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    try {
      if (method === "POST") {
        const name = new Headers(init?.headers).get("slug") ?? "assigned.ttl";
        const created = await storage.create(url, String(init?.body ?? ""), {
          name,
          contentType: "text/turtle",
        });
        return new Response(null, { status: 201, headers: { location: created.url } });
      }
      if (method === "PUT") {
        const headers = new Headers(init?.headers);
        if (headers.get("if-none-match") === "*") {
          await storage.create(new URL(".", url).href, String(init?.body ?? ""), {
            name: url.split("/").at(-1),
            contentType: headers.get("content-type") ?? "text/turtle",
          });
        } else
          await storage.write(url, String(init?.body ?? ""), {
            contentType: "text/turtle",
            ifMatch: headers.get("if-match") ?? "missing",
          });
        return new Response(null, { status: 201 });
      }
      const result = await storage.read(url);
      return new Response(await result.text(), {
        headers: {
          "content-type": "text/turtle",
          etag: result.etag ?? "",
          link: `<${url}.acl>; rel="acl"`,
          "wac-allow": `user="read write control",public=""`,
        },
      });
    } catch (error) {
      if (error instanceof StorageError) return new Response(null, { status: error.status ?? 500 });
      throw error;
    }
  };
  vi.mocked(createPodClient).mockResolvedValue({ storage, features: storage.features } as Awaited<
    ReturnType<typeof createPodClient>
  >);
  vi.mocked(readContainerMembers).mockImplementation(async (_fetch, url) => {
    try {
      const entries = [];
      for await (const e of storage.listAll(url))
        entries.push({ url: e.url, container: e.kind === "container" });
      return entries;
    } catch (error) {
      if (error instanceof StorageError && error.code === "not-found") return null;
      throw error;
    }
  });
  const register: Mock<(...args: unknown[]) => Promise<unknown>> = vi
    .fn()
    .mockResolvedValue(undefined);
  vi.mocked(createTypeIndex).mockReturnValue({ register } as unknown as ReturnType<
    typeof createTypeIndex
  >);
  return {
    storage,
    fetch,
    register,
    repository: createEventsRepository({ fetch, storageRoot: ROOT, owner }),
  };
}
