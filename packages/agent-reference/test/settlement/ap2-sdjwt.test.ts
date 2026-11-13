// AUTHORED-BY Codex GPT-6
/** biome-ignore-all lint/style/useNamingConvention: SD-JWT serialization uses _sd and _sd_alg. */
import {
  CompactSign,
  type CryptoKey,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";
import { beforeAll, expect, it } from "vitest";
import { signAp2Jwt, verifyAp2Jwt } from "../../src/settlement/ap2/jwt.js";
import {
  issueSdJwt,
  presentSdJwt,
  type SdJwtVerifier,
  sdHash,
  verifySdJwt,
} from "../../src/settlement/ap2/sdjwt.js";
import { base64url, decodeBase64url, strictJson } from "../../src/settlement/http.js";
import { now } from "./fixtures.js";

let issuer: { publicKey: CryptoKey; privateKey: CryptoKey };
let holder: typeof issuer;
let other: typeof issuer;
let holderJwk: JWK;
beforeAll(async () => {
  issuer = await generateKeyPair("ES256");
  holder = await generateKeyPair("ES256", { extractable: true });
  other = await generateKeyPair("ES256");
  holderJwk = await exportJWK(holder.publicKey);
});
const binding = { audience: "credential-provider", nonce: "checkout-once", issuedAt: now };
function options(change: Partial<SdJwtVerifier> = {}): SdJwtVerifier {
  return {
    issuerKey: issuer.publicKey,
    audience: binding.audience,
    nonce: binding.nonce,
    now,
    requiredClaims: ["vct", "transaction_id", "payment_amount"],
    ...change,
  };
}
async function fixture() {
  const issued = await issueSdJwt(
    {
      vct: "mandate.payment.1",
      transaction_id: "checkout-hash",
      payment_amount: { amount: 125, currency: "USD" },
      secret: "hidden",
    },
    issuer.privateKey,
    holderJwk,
  );
  const presentation = await presentSdJwt(issued, holder.privateKey, binding);
  return { issued, presentation };
}
it("issues SD-JWT commitments and verifies ES256 issuer and holder binding", async () => {
  const { issued, presentation } = await fixture();
  expect(decodeProtectedHeader(issued.issuerJwt)).toEqual({ alg: "ES256", typ: "sd-jwt" });
  const kb = presentation.split("~").at(-1) as string;
  expect(decodeProtectedHeader(kb)).toEqual({ alg: "ES256", typ: "kb+sd-jwt" });
  expect(decodeJwt(kb)).toMatchObject({
    aud: "credential-provider",
    nonce: "checkout-once",
    sd_hash: sdHash(`${[issued.issuerJwt, ...issued.disclosures].join("~")}~`),
  });
  expect(decodeJwt(issued.issuerJwt)).not.toHaveProperty("payment_amount");
  expect(await verifySdJwt(presentation, options({ expectedHolderJwk: holderJwk }))).toMatchObject({
    vct: "mandate.payment.1",
    transaction_id: "checkout-hash",
    payment_amount: { amount: 125, currency: "USD" },
  });
  const again = await fixture();
  expect(again.issued.disclosures).not.toEqual(issued.disclosures);
});
it("allows a genuinely hidden optional disclosure while retaining required claims", async () => {
  const { issued } = await fixture();
  const selective = {
    ...issued,
    disclosures: issued.disclosures.filter(
      (raw) => (strictJson(decodeBase64url(raw)) as unknown[])[1] !== "secret",
    ),
  };
  const verified = await verifySdJwt(
    await presentSdJwt(selective, holder.privateKey, binding),
    options(),
  );
  expect(verified).not.toHaveProperty("secret");
  expect(verified).toHaveProperty("payment_amount");
});
it("refuses a tampered disclosure even when the holder re-signs the presentation hash", async () => {
  const { issued } = await fixture();
  const disclosures = [...issued.disclosures];
  const tuple = strictJson(decodeBase64url(disclosures[0] as string)) as unknown[];
  tuple[2] = "attacker-checkout";
  disclosures[0] = base64url(JSON.stringify(tuple));
  await expect(
    verifySdJwt(
      await presentSdJwt({ ...issued, disclosures }, holder.privateKey, binding),
      options(),
    ),
  ).rejects.toThrow("uncommitted");
});
it("refuses a missing required disclosure even with a matching sd_hash", async () => {
  const { issued } = await fixture();
  const presentation = await presentSdJwt(
    { ...issued, disclosures: issued.disclosures.slice(1) },
    holder.privateKey,
    binding,
  );
  await expect(verifySdJwt(presentation, options())).rejects.toThrow("missing required disclosure");
});
it("refuses a changed presentation without a new binding signature", async () => {
  const { presentation } = await fixture();
  const parts = presentation.split("~");
  parts.splice(1, 1);
  await expect(verifySdJwt(parts.join("~"), options())).rejects.toThrow("sd_hash");
});
it("refuses wrong aud, nonce, issuer and holder keys", async () => {
  const { issued, presentation } = await fixture();
  await expect(verifySdJwt(presentation, options({ audience: "merchant" }))).rejects.toThrow();
  await expect(verifySdJwt(presentation, options({ nonce: "other" }))).rejects.toThrow("nonce");
  await expect(
    verifySdJwt(presentation, options({ issuerKey: other.publicKey })),
  ).rejects.toThrow();
  await expect(
    verifySdJwt(presentation, options({ expectedHolderJwk: await exportJWK(other.publicKey) })),
  ).rejects.toThrow("holder");
  await expect(
    verifySdJwt(await presentSdJwt(issued, other.privateKey, binding), options()),
  ).rejects.toThrow();
});
it("refuses an explicitly wrong sd_hash signed by the legitimate holder", async () => {
  const { issued } = await fixture();
  const kb = await signAp2Jwt(
    {
      aud: binding.audience,
      nonce: binding.nonce,
      iat: now,
      sd_hash: sdHash("another-presentation"),
    },
    holder.privateKey,
    "kb+sd-jwt",
  );
  await expect(
    verifySdJwt(`${[issued.issuerJwt, ...issued.disclosures].join("~")}~${kb}`, options()),
  ).rejects.toThrow("sd_hash");
});
it("refuses duplicate disclosures, duplicate digest commitments and claim collisions", async () => {
  const { issued } = await fixture();
  await expect(
    verifySdJwt(
      await presentSdJwt(
        { ...issued, disclosures: [...issued.disclosures, issued.disclosures[0] as string] },
        holder.privateKey,
        binding,
      ),
      options(),
    ),
  ).rejects.toThrow("duplicate disclosure");
  const payload = decodeJwt(issued.issuerJwt);
  const digests = payload._sd as string[];
  const duplicate = await signAp2Jwt(
    { ...payload, _sd: [...digests, digests[0]] },
    issuer.privateKey,
    "sd-jwt",
  );
  await expect(
    verifySdJwt(
      await presentSdJwt({ ...issued, issuerJwt: duplicate }, holder.privateKey, binding),
      options(),
    ),
  ).rejects.toThrow("duplicate SD-JWT digest");
  const collision = await signAp2Jwt(
    { ...payload, transaction_id: "collision" },
    issuer.privateKey,
    "sd-jwt",
  );
  await expect(
    verifySdJwt(
      await presentSdJwt({ ...issued, issuerJwt: collision }, holder.privateKey, binding),
      options(),
    ),
  ).rejects.toThrow("collision");
});
it.each([
  "cnf",
  "__proto__",
  "constructor",
  "_sd",
  "_sd_alg",
])("refuses reserved disclosed claim %s", async (name) => {
  await expect(
    issueSdJwt(Object.fromEntries([[name, "value"]]), issuer.privateKey, holderJwk),
  ).rejects.toThrow("reserved");
});
it("refuses malformed/unsafe issuances and invalid selective-claim selections", async () => {
  await expect(
    issueSdJwt({ vct: "x", value: "a" }, issuer.privateKey, holderJwk, ["missing"]),
  ).rejects.toThrow();
  await expect(
    issueSdJwt({ vct: "x", value: "a" }, issuer.privateKey, holderJwk, ["value", "value"]),
  ).rejects.toThrow();
  await expect(issueSdJwt({ vct: "x" }, issuer.privateKey, holderJwk, ["vct"])).rejects.toThrow();
  await expect(issueSdJwt({ value: undefined }, issuer.privateKey, holderJwk)).rejects.toThrow();
  await expect(
    issueSdJwt({ value: "a" }, issuer.privateKey, { ...holderJwk, d: "private" }),
  ).rejects.toThrow();
  await expect(
    issueSdJwt({ value: "a" }, issuer.privateKey, { ...holderJwk, crv: "Ed25519" }),
  ).rejects.toThrow();
});
it.each([
  "exp",
  "iat",
  "cnf",
  "__proto__",
])("refuses hidden reserved/registered claim %s from a signed issuer", async (name) => {
  const { issued } = await fixture();
  const disclosure = base64url(
    JSON.stringify(["salt-with-enough-characters", name, name === "exp" ? now - 1 : "changed"]),
  );
  const claims = decodeJwt(issued.issuerJwt);
  const alteredIssuer = await signAp2Jwt(
    { ...claims, _sd: [...(claims._sd as string[]), sdHash(disclosure)] },
    issuer.privateKey,
    "sd-jwt",
  );
  const presentation = await presentSdJwt(
    { issuerJwt: alteredIssuer, disclosures: [...issued.disclosures, disclosure] },
    holder.privateKey,
    binding,
  );
  await expect(verifySdJwt(presentation, options())).rejects.toThrow("collision");
});
it("refuses excess disclosures at issuance", async () => {
  const claims = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`claim${i}`, "value"]));
  await expect(issueSdJwt(claims, issuer.privateKey, holderJwk)).rejects.toThrow(
    "selective claims",
  );
});
it("refuses malformed compact JWTs, duplicate JSON members and non-object JWT payloads", async () => {
  await expect(verifyAp2Jwt("not-a-jwt", issuer.publicKey, "sd-jwt", now)).rejects.toThrow(
    "compact JWT",
  );
  const array = await new CompactSign(new TextEncoder().encode("[]"))
    .setProtectedHeader({ alg: "ES256", typ: "sd-jwt" })
    .sign(issuer.privateKey);
  await expect(verifyAp2Jwt(array, issuer.publicKey, "sd-jwt", now)).rejects.toThrow("claims");
  const duplicate = await new CompactSign(new TextEncoder().encode('{"vct":"x","vct":"y"}'))
    .setProtectedHeader({ alg: "ES256", typ: "sd-jwt" })
    .sign(issuer.privateKey);
  await expect(verifyAp2Jwt(duplicate, issuer.publicKey, "sd-jwt", now)).rejects.toThrow(
    "duplicate",
  );
  await expect(verifyAp2Jwt("x".repeat(65_537), issuer.publicKey, "sd-jwt", now)).rejects.toThrow(
    "bounds",
  );
});
it("refuses future/stale key binding and expired issuer credentials", async () => {
  const { issued } = await fixture();
  for (const issuedAt of [now + 1, now - 301])
    await expect(
      verifySdJwt(
        await presentSdJwt(issued, holder.privateKey, { ...binding, issuedAt }),
        options(),
      ),
    ).rejects.toThrow("stale");
  const expired = await issueSdJwt(
    { vct: "x", exp: now, transaction_id: "x", payment_amount: {} },
    issuer.privateKey,
    holderJwk,
  );
  await expect(
    verifySdJwt(await presentSdJwt(expired, holder.privateKey, binding), options()),
  ).rejects.toThrow();
  await expect(
    verifySdJwt(
      await presentSdJwt(issued, holder.privateKey, binding),
      options({ maxBindingAgeSeconds: -1 }),
    ),
  ).rejects.toThrow();
});
it("refuses algorithm/type changes and embedded verification keys", async () => {
  const { issued } = await fixture();
  const claims = decodeJwt(issued.issuerJwt);
  const wrongTyp = await signAp2Jwt(claims, issuer.privateKey, "other");
  await expect(
    verifySdJwt(
      await presentSdJwt({ ...issued, issuerJwt: wrongTyp }, holder.privateKey, binding),
      options(),
    ),
  ).rejects.toThrow("type");
  const embedded = await new SignJWT(claims)
    .setProtectedHeader({ alg: "ES256", typ: "sd-jwt", jwk: holderJwk })
    .sign(issuer.privateKey);
  await expect(
    verifySdJwt(
      await presentSdJwt({ ...issued, issuerJwt: embedded }, holder.privateKey, binding),
      options(),
    ),
  ).rejects.toThrow();
  const ed = await generateKeyPair("EdDSA");
  const wrongAlg = await new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", typ: "sd-jwt" })
    .sign(ed.privateKey);
  await expect(
    verifySdJwt(
      await presentSdJwt({ ...issued, issuerJwt: wrongAlg }, holder.privateKey, binding),
      options(),
    ),
  ).rejects.toThrow();
});
it.each([
  "",
  "issuer",
  "issuer~~kb",
  "x".repeat(65_537),
  Array(68).fill("x").join("~"),
])("refuses malformed or oversized SD-JWT serialization", async (token) => {
  await expect(verifySdJwt(token, options())).rejects.toThrow();
});
it("refuses an invalid current time", async () => {
  await expect(verifySdJwt((await fixture()).presentation, options({ now: NaN }))).rejects.toThrow(
    "time",
  );
});
