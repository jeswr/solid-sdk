// AUTHORED-BY Codex GPT-6
import { describe, it, expect, vi } from "vitest";
import { parseRdf } from "@jeswr/fetch-rdf";
import { createFetchPodWriter } from "@jeswr/pod-connectors";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC } from "@jeswr/pod-connectors/testing";
import { fetchProfile, readProfile, requireStorage } from "./profile.js";
import { NoStorageError } from "./errors.js";

const WEBID = "https://alice.example/profile/card#me";

it("passes the final profile document from the existing profile load into connector registration", async () => {
  const pod = createMemoryPod();
  const canonicalDocument = "https://profiles.example/alice/card";
  const body = pod.get(TEST_PROFILE_DOC)!.replaceAll(`${TEST_PROFILE_DOC}#me`, WEBID);
  await pod.fetch(canonicalDocument, { method: "PUT", body });
  // fetch returns the final response after the profile loader's existing redirect handling.
  const loadFetch = vi.fn<typeof fetch>(async () => {
    const response = await pod.fetch(canonicalDocument);
    Object.defineProperties(response, {
      url: { value: `${canonicalDocument}#ignored` },
      redirected: { value: true },
    });
    return response;
  });
  const profile = await fetchProfile(WEBID, loadFetch);
  expect(profile.webId).toBe(WEBID);
  expect(profile.profileDocumentUrl).toBe(canonicalDocument);
  expect(loadFetch).toHaveBeenCalledOnce();
  expect(loadFetch.mock.calls[0][0]).toBe(WEBID);

  const podFetch = vi.fn(pod.fetch);
  const port = createFetchPodWriter({
    adapterId: "toy",
    webId: profile.webId,
    profileDocumentUrl: profile.profileDocumentUrl,
    podRoot: profile.storages[0],
    fetch: podFetch,
  });
  const result = await port.registerType([
    { forClass: "https://schema.org/Thing", container: port.resolve("media/") },
  ]);
  expect(result).toMatchObject({ bootstrapped: true, added: 1 });
  expect(result.indexUrl).toBe(`${TEST_POD_ROOT}settings/privateTypeIndex.ttl`);
  expect(pod.get(canonicalDocument)).toContain(result.indexUrl);
  expect(pod.get(result.indexUrl)).toContain("https://schema.org/Thing");
  expect(podFetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  expect(podFetch.mock.calls.map(([input]) => String(input))).not.toContain(WEBID);
  expect(loadFetch).toHaveBeenCalledOnce();
});

describe("readProfile", () => {
  it("renders name, photo, storage and issuer from a full profile", async () => {
    const ds = await parseRdf(
      `
      @prefix foaf: <http://xmlns.com/foaf/0.1/>.
      @prefix solid: <http://www.w3.org/ns/solid/terms#>.
      @prefix pim: <http://www.w3.org/ns/pim/space#>.
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#>.
      <${WEBID}> a foaf:Person ;
        foaf:name "Alice Example" ;
        vcard:hasPhoto <https://alice.example/me.jpg> ;
        solid:oidcIssuer <https://idp.example/> ;
        pim:storage <https://alice.example/> .
    `,
      "text/turtle",
    );
    const p = readProfile(WEBID, ds);
    expect(p.displayName).toBe("Alice Example");
    expect(p.avatarUrl).toBe("https://alice.example/me.jpg");
    expect(p.storages).toEqual(["https://alice.example/"]);
    expect(p.issuers).toEqual(["https://idp.example/"]);
  });

  it("survives a bare profile: name falls back to the WebID, no storage", async () => {
    const ds = await parseRdf(
      `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
       @prefix solid: <http://www.w3.org/ns/solid/terms#>.
       <${WEBID}> a foaf:Person ; solid:oidcIssuer <https://idp.example/> .`,
      "text/turtle",
    );
    const p = readProfile(WEBID, ds);
    expect(p.displayName).toBe(WEBID);
    expect(p.avatarUrl).toBeUndefined();
    expect(p.storages).toEqual([]);
  });

  it("surfaces every storage when several are advertised (user must choose)", async () => {
    const ds = await parseRdf(
      `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
       @prefix pim: <http://www.w3.org/ns/pim/space#>.
       <${WEBID}> a foaf:Person ;
         pim:storage <https://a.example/>, <https://b.example/> .`,
      "text/turtle",
    );
    const p = readProfile(WEBID, ds);
    expect(new Set(p.storages)).toEqual(new Set(["https://a.example/", "https://b.example/"]));
  });
});

describe("requireStorage", () => {
  it("returns the storage when present", () => {
    expect(
      requireStorage({
        webId: WEBID, profileDocumentUrl: WEBID.split("#")[0],
        displayName: "Alice",
        storages: ["https://alice.example/"],
        issuers: [],
      }),
    ).toBe("https://alice.example/");
  });

  it("throws NoStorageError when there is no storage", () => {
    expect(() =>
      requireStorage({ webId: WEBID, profileDocumentUrl: WEBID.split("#")[0], displayName: "Alice", storages: [], issuers: [] }),
    ).toThrow(NoStorageError);
  });
});
