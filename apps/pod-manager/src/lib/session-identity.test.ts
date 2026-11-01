// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it, vi } from "vitest";
import {
  assertIssuerAuthority,
  loginProfile,
  restoredIdentity,
  WebIdIssuerAuthorityError,
} from "./session-identity";

const ALICE = "https://pod.test/alice/profile/card#me";
const BOB = "https://pod.test/bob/profile/card#me";
const ISSUER = "https://as.test/tenant";
const issuerTriple = (webId: string, issuer = ISSUER) =>
  `<${webId}> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${issuer}> .`;
const turtle = (body: string) => new Response(body, {
  headers: { "content-type": "text/turtle" },
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("restored identity", () => {
  it("adopts Bob's authenticated WebID when the active pointer still remembers Alice", () => {
    expect(restoredIdentity(ALICE, { webId: BOB })).toBe(BOB);
  });

  it("retains the remembered WebID only when no authenticated identity was restored", () => {
    expect(restoredIdentity(ALICE, undefined)).toBe(ALICE);
    expect(restoredIdentity(ALICE, { webId: ALICE })).toBe(ALICE);
  });
});

describe("issuer authority for the committed identity", () => {
  it("Alice's issuer statement cannot authorize a token claiming Bob", async () => {
    const dataset = await parseRdf(issuerTriple(ALICE), "text/turtle");
    expect(() => assertIssuerAuthority(BOB, ISSUER, dataset)).toThrow(WebIdIssuerAuthorityError);
  });

  it("requires the claimed WebID's own issuer and compares URLs with a trailing slash", async () => {
    const dataset = await parseRdf(issuerTriple(BOB, "https://AS.test/tenant/"), "text/turtle");
    expect(() => assertIssuerAuthority(BOB, ISSUER, dataset)).not.toThrow();
    expect(() => assertIssuerAuthority(BOB, "https://as.test/other", dataset)).toThrow(WebIdIssuerAuthorityError);
  });

  it("trailing slash tolerance does not change issuer query values", async () => {
    const dataset = await parseRdf(issuerTriple(BOB, `${ISSUER}?tenant=/`), "text/turtle");
    expect(() => assertIssuerAuthority(BOB, `${ISSUER}?tenant=`, dataset)).toThrow(WebIdIssuerAuthorityError);
  });

  it.each([undefined, ALICE])("validates a delayed claimed profile before publishing issuer-first or switched login (%s)", async (profileWebId) => {
    const arrived = deferred();
    const release = deferred();
    const provider = { forgetIssuer: vi.fn(async () => {}) };
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      arrived.resolve();
      await release.promise;
      return turtle(issuerTriple(BOB, "https://unrelated.test/"));
    });
    const publish = vi.fn();
    const login = loginProfile(BOB, ISSUER, profileWebId, provider, fetchImpl)
      .then(publish).catch((e: unknown) => e);
    await arrived.promise;
    expect(publish).not.toHaveBeenCalled();
    release.resolve();
    expect(await login).toBeInstanceOf(WebIdIssuerAuthorityError);
    expect(provider.forgetIssuer).toHaveBeenCalledWith(new URL(ISSUER));
    expect(publish).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[0][0]).toBe(BOB);
  });

  it("forgets credentials when the claimed profile cannot be fetched", async () => {
    const provider = { forgetIssuer: vi.fn(async () => {}) };
    await expect(loginProfile(BOB, ISSUER, undefined, provider, async () => {
      throw new Error("offline");
    })).rejects.toThrow(WebIdIssuerAuthorityError);
    expect(provider.forgetIssuer).toHaveBeenCalledOnce();
  });

  it("allows a newly claimed WebID only when its own profile authorizes the issuer", async () => {
    const provider = { forgetIssuer: vi.fn(async () => {}) };
    const profile = await loginProfile(BOB, ISSUER, ALICE, provider,
      async () => turtle(issuerTriple(BOB, `${ISSUER}/`)));
    expect(profile.webId).toBe(BOB);
    expect(provider.forgetIssuer).not.toHaveBeenCalled();
  });
});
