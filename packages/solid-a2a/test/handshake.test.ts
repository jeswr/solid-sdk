// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Handshake codec: encode/decode round-trip for offer + response; the required /
// downgradeAllowed flag is preserved; the RDF form round-trips; the
// no-silent-downgrade rule holds.
import { describe, expect, it } from "vitest";
import {
  decodeUpgradeOffer,
  decodeUpgradeResponse,
  encodeUpgradeOffer,
  encodeUpgradeResponse,
  handshakeFromRdf,
  handshakeToRdf,
  handshakeToTurtle,
  mayDowngradeToNl,
} from "../src/handshake.js";

const HASH = "sha256:abc123";
const SOURCE = "https://alice.pod/protocols/read#v1";

describe("upgrade-offer codec", () => {
  it("encodes + decodes an offer (structured round-trip), defaulting required to false", () => {
    const offer = encodeUpgradeOffer({ protocolHash: HASH, protocolSource: SOURCE });
    expect(offer.kind).toBe("upgrade-offer");
    expect(offer.required).toBe(false);
    const back = decodeUpgradeOffer(JSON.parse(JSON.stringify(offer)));
    expect(back).toEqual(offer);
  });

  it("preserves required:true + protocolName through encode/decode", () => {
    const offer = encodeUpgradeOffer({
      protocolHash: HASH,
      protocolSource: SOURCE,
      required: true,
      protocolName: "Read",
    });
    expect(offer.required).toBe(true);
    expect(offer.protocolName).toBe("Read");
    expect(decodeUpgradeOffer(offer)).toEqual(offer);
  });

  it("encode throws on missing protocolHash / protocolSource", () => {
    expect(() => encodeUpgradeOffer({ protocolHash: "", protocolSource: SOURCE })).toThrow(
      TypeError,
    );
    expect(() => encodeUpgradeOffer({ protocolHash: HASH, protocolSource: "" })).toThrow(TypeError);
  });

  it("decode throws on a non-offer / malformed input", () => {
    expect(() => decodeUpgradeOffer({ kind: "nope" })).toThrow(TypeError);
    expect(() => decodeUpgradeOffer(null)).toThrow(TypeError);
    expect(() => decodeUpgradeOffer({ kind: "upgrade-offer", protocolHash: 1 })).toThrow(TypeError);
  });

  it("decode REJECTS a non-boolean `required` (no silent coercion to optional)", () => {
    expect(() =>
      decodeUpgradeOffer({
        kind: "upgrade-offer",
        protocolHash: HASH,
        protocolSource: SOURCE,
        required: "true",
      }),
    ).toThrow(TypeError);
  });
});

describe("upgrade-response codec", () => {
  it("encodes + decodes an accept", () => {
    const res = encodeUpgradeResponse({ protocolHash: HASH, accept: true });
    expect(decodeUpgradeResponse(res)).toEqual(res);
  });

  it("encodes + decodes a decline with a reason", () => {
    const res = encodeUpgradeResponse({ protocolHash: HASH, accept: false, reason: "unsupported" });
    expect(res.reason).toBe("unsupported");
    expect(decodeUpgradeResponse(JSON.parse(JSON.stringify(res)))).toEqual(res);
  });

  it("encode throws on a non-boolean accept / missing hash", () => {
    // @ts-expect-error testing the runtime guard
    expect(() => encodeUpgradeResponse({ protocolHash: HASH, accept: "yes" })).toThrow(TypeError);
    expect(() => encodeUpgradeResponse({ protocolHash: "", accept: true })).toThrow(TypeError);
  });

  it("decode throws on a malformed response", () => {
    expect(() => decodeUpgradeResponse({ kind: "upgrade-response", protocolHash: HASH })).toThrow(
      TypeError,
    );
    expect(() => decodeUpgradeResponse({ kind: "x" })).toThrow(TypeError);
  });
});

describe("no-silent-downgrade rule (mayDowngradeToNl)", () => {
  const offerRequired = encodeUpgradeOffer({
    protocolHash: HASH,
    protocolSource: SOURCE,
    required: true,
  });
  const offerOptional = encodeUpgradeOffer({ protocolHash: HASH, protocolSource: SOURCE });
  const decline = encodeUpgradeResponse({ protocolHash: HASH, accept: false });
  const accept = encodeUpgradeResponse({ protocolHash: HASH, accept: true });

  it("a REQUIRED protocol can NEVER be downgraded to NL (decline → refuse)", () => {
    expect(mayDowngradeToNl(offerRequired, decline)).toBe(false);
  });

  it("a REQUIRED protocol is not 'downgraded' even on accept (they speak RDF)", () => {
    expect(mayDowngradeToNl(offerRequired, accept)).toBe(false);
  });

  it("an OPTIONAL protocol may fall back to NL when the peer declines", () => {
    expect(mayDowngradeToNl(offerOptional, decline)).toBe(true);
  });

  it("an OPTIONAL accepted protocol does not use NL", () => {
    expect(mayDowngradeToNl(offerOptional, accept)).toBe(false);
  });

  it("a response about a DIFFERENT protocol never authorises NL (mismatched hash → false)", () => {
    const unrelatedDecline = encodeUpgradeResponse({
      protocolHash: "sha256:OTHER",
      accept: false,
    });
    // Even for an optional offer, a decline of an UNRELATED protocol must not
    // authorise NL fallback for THIS protocol.
    expect(mayDowngradeToNl(offerOptional, unrelatedDecline)).toBe(false);
    expect(mayDowngradeToNl(offerRequired, unrelatedDecline)).toBe(false);
  });
});

describe("handshake RDF form", () => {
  it("round-trips an offer through RDF (Turtle), preserving required + name", async () => {
    const offer = encodeUpgradeOffer({
      protocolHash: HASH,
      protocolSource: SOURCE,
      required: true,
      protocolName: "Read",
    });
    const ttl = await handshakeToTurtle(offer);
    const back = await handshakeFromRdf(ttl);
    expect(back).toEqual(offer);
  });

  it("round-trips an optional offer (required:false) through RDF", async () => {
    const offer = encodeUpgradeOffer({ protocolHash: HASH, protocolSource: SOURCE });
    const back = await handshakeFromRdf(await handshakeToTurtle(offer));
    expect(back).toEqual(offer);
  });

  it("round-trips an accept + a decline-with-reason through RDF", async () => {
    const accept = encodeUpgradeResponse({ protocolHash: HASH, accept: true });
    expect(await handshakeFromRdf(await handshakeToTurtle(accept))).toEqual(accept);
    const decline = encodeUpgradeResponse({ protocolHash: HASH, accept: false, reason: "no" });
    expect(await handshakeFromRdf(await handshakeToTurtle(decline))).toEqual(decline);
  });

  it("handshakeToRdf yields non-empty quads typed with the handshake class", () => {
    const offer = encodeUpgradeOffer({ protocolHash: HASH, protocolSource: SOURCE });
    const quads = handshakeToRdf(offer);
    expect(quads.length).toBeGreaterThan(0);
    expect(quads.some((q) => q.object.value.endsWith("UpgradeOffer"))).toBe(true);
  });

  it("handshakeFromRdf accepts the quads form directly", async () => {
    const res = encodeUpgradeResponse({ protocolHash: HASH, accept: true });
    expect(await handshakeFromRdf(handshakeToRdf(res))).toEqual(res);
  });

  it("returns undefined when the RDF carries no handshake subject", async () => {
    expect(await handshakeFromRdf(`@prefix x: <https://x/> . x:a x:b x:c .`)).toBeUndefined();
  });

  it("reads ONLY the typed handshake subject's predicates (ignores unrelated subjects)", async () => {
    // A decoy subject carries a DIFFERENT protocolHash; it must not be spliced in.
    const ttl = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<urn:a2a:handshake> a a2a:UpgradeOffer ;
  a2a:protocolHash "sha256:GOOD" ;
  a2a:protocolSource <https://alice.pod/p#v1> ;
  a2a:required "true"^^xsd:boolean .
<urn:decoy> a2a:protocolHash "sha256:EVIL" ; a2a:protocolSource <https://evil/p> .`;
    const back = await handshakeFromRdf(ttl);
    expect(back?.kind).toBe("upgrade-offer");
    expect((back as { protocolHash: string }).protocolHash).toBe("sha256:GOOD");
    expect((back as { protocolSource: string }).protocolSource).toBe("https://alice.pod/p#v1");
  });

  it("REJECTS an ambiguous graph with two handshake subjects", async () => {
    const ttl = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:h1> a a2a:UpgradeOffer ; a2a:protocolHash "sha256:A" ; a2a:protocolSource <https://a/p> .
<urn:h2> a a2a:UpgradeOffer ; a2a:protocolHash "sha256:B" ; a2a:protocolSource <https://b/p> .`;
    expect(await handshakeFromRdf(ttl)).toBeUndefined();
  });

  it("REJECTS a mixed offer+response graph", async () => {
    const ttl = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<urn:o> a a2a:UpgradeOffer ; a2a:protocolHash "sha256:A" ; a2a:protocolSource <https://a/p> .
<urn:r> a a2a:UpgradeResponse ; a2a:protocolHash "sha256:A" ; a2a:accept "true"^^xsd:boolean .`;
    expect(await handshakeFromRdf(ttl)).toBeUndefined();
  });

  it("REJECTS a subject with a duplicated single-valued predicate (malformed)", async () => {
    const ttl = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:a2a:handshake> a a2a:UpgradeOffer ;
  a2a:protocolHash "sha256:A", "sha256:B" ;
  a2a:protocolSource <https://a/p> .`;
    expect(await handshakeFromRdf(ttl)).toBeUndefined();
  });

  it("REJECTS an offer with a missing/invalid `required` boolean (no silent default)", async () => {
    const missing = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:a2a:handshake> a a2a:UpgradeOffer ; a2a:protocolHash "sha256:A" ; a2a:protocolSource <https://a/p> .`;
    expect(await handshakeFromRdf(missing)).toBeUndefined();
    const invalid = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:a2a:handshake> a a2a:UpgradeOffer ; a2a:protocolHash "sha256:A" ;
  a2a:protocolSource <https://a/p> ; a2a:required "yes" .`;
    expect(await handshakeFromRdf(invalid)).toBeUndefined();
  });

  it("REJECTS a response with a missing/invalid `accept` boolean (does not default to false)", async () => {
    const missing = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:a2a:handshake> a a2a:UpgradeResponse ; a2a:protocolHash "sha256:A" .`;
    expect(await handshakeFromRdf(missing)).toBeUndefined();
    const invalid = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
<urn:a2a:handshake> a a2a:UpgradeResponse ; a2a:protocolHash "sha256:A" ; a2a:accept "maybe" .`;
    expect(await handshakeFromRdf(invalid)).toBeUndefined();
  });

  it("REJECTS a literal-valued rdf:type (malformed RDF, not a real typed handshake)", async () => {
    // rdf:type with a LITERAL object must not be recognised as a handshake type.
    const ttl = `@prefix a2a: <https://w3id.org/jeswr/a2a#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
<urn:a2a:handshake> rdf:type "https://w3id.org/jeswr/a2a#UpgradeOffer" ;
  a2a:protocolHash "sha256:A" ; a2a:protocolSource <https://a/p> .`;
    expect(await handshakeFromRdf(ttl)).toBeUndefined();
  });
});
