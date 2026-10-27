// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import { ProfileTypeIndexAnchor } from "./type-index.js";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./rdf-read.js", () => ({ freshRdf: read }));

import { ensureTypeRegistrations } from "./type-index-write.js";

const ROOT = TEST_POD_ROOT;
const PROFILE = TEST_PROFILE_DOC;
const WEBID = TEST_WEBID;
const INDEX = `${ROOT}settings/privateTypeIndex.ttl`;

beforeEach(() => {
  read.mockReset();
});

it.each([
  ["profile", "https://foreign.example/steal"],
  ["profile", `${ROOT}unrelated.ttl`],
  ["index", "https://foreign.example/steal"],
  ["index", `${ROOT}unrelated.ttl`],
])("refuses a shadowed Request at the %s document boundary: %s", async (stage, target) => {
  const profile = createMemoryPod().dataset(PROFILE);
  const anchor = new ProfileTypeIndexAnchor(WEBID, profile, DataFactory);
  anchor.privateIndex = INDEX;
  const transport = vi.fn(async () => new Response());
  read.mockImplementation(async (url: string, fetch: typeof globalThis.fetch) => {
    if (url === PROFILE && stage === "index") {
      return { dataset: profile };
    }
    const request = new Request(target);
    Object.defineProperty(request, "url", { value: url });
    await fetch(request);
    throw new Error("unexpected transport access");
  });
  await expect(
    ensureTypeRegistrations({
      webId: WEBID,
      podRoot: ROOT,
      profileDocumentUrl: PROFILE,
      registrations: [],
      fetchImpl: transport,
    }),
  ).rejects.toThrow(/outside|escapes/);
  expect(transport).not.toHaveBeenCalled();
});
