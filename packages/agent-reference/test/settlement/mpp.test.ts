// AUTHORED-BY Codex GPT-6
// biome-ignore lint/style/useNodejsImportProtocol: agent layer requires bare specifiers
import { createHash, createHmac } from "crypto";
import { expect, it, vi } from "vitest";
import { canonicalJson } from "../../src/core/canonical.js";
import {
  addressFromKey,
  authorizationOnceKey,
  signAuthorization,
} from "../../src/settlement/eip3009.js";
import { base64url, encodeJson, type HttpExchange, header } from "../../src/settlement/http.js";
import { Ledger, LedgerError } from "../../src/settlement/ledger.js";
import {
  buildChallenge,
  buildCredential,
  type Challenge,
  challengeExchange,
  challengeId,
  challengeNonce,
  chargeRequest,
  checkChallengeBinding,
  convertMppAmount,
  createChallenge,
  createCredential,
  encodeReceipt,
  MppError,
  parseChallenge,
  parseCredential,
  parseReceipt,
  problemStatuses,
} from "../../src/settlement/mpp/objects.js";
import { MppServer } from "../../src/settlement/mpp/server.js";
import { domain, now, payee, payer, secretKey } from "./fixtures.js";

const secret = new Uint8Array(32).fill(7);
const request = {
  amount: "1250000",
  currency: "USD",
  recipient: payee,
  externalId: "sha-256:terms",
  methodDetails: { type: "authorization" },
};
const options = {
  realm: "valuer.example",
  method: "evm",
  intent: "charge",
  expires: new Date((now + 300) * 1000).toISOString(),
};
function setup(balance = "10.00") {
  const ledger = new Ledger();
  ledger.createAccount(payer, { USD: balance });
  ledger.createAccount(payee);
  const challenge = createChallenge(request, options, secret);
  const credential = createCredential(challenge, domain, payer, "0", String(now + 300), secretKey);
  const server = new MppServer(ledger, secret, domain, "USD", 6);
  return { ledger, challenge, credential, server };
}
function signedCredential(challenge: Challenge) {
  return createCredential(challenge, domain, payer, "0", String(now + 300), secretKey);
}
function expectProblem(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error("expected refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(MppError);
    expect(error).toMatchObject({ code, type: `https://paymentauth.org/problems/${code}` });
  }
}
it("builds and parses RFC 9110 challenges with a JCS request and recommended HMAC binding", () => {
  const { challenge } = setup();
  expect(chargeRequest(challenge)).toEqual(request);
  expect(challenge.request).toBe(base64url(canonicalJson(request)));
  expect(challenge.id).toBe(
    createHmac("sha256", secret)
      .update(
        [options.realm, "evm", "charge", challenge.request, options.expires, "", "", ""].join("|"),
      )
      .digest("base64url"),
  );
  expect(checkChallengeBinding(challenge, secret)).toBe(true);
  expect(parseChallenge(buildChallenge(challenge))).toEqual(challenge);
  expect(parseChallenge(`${buildChallenge(challenge)}, future="ignored"`)).toEqual(challenge);
  expect(parseChallenge(buildChallenge(challenge).replace('method="evm"', "method=evm"))).toEqual(
    challenge,
  );
  expect(parseChallenge(buildChallenge(challenge).replace("Payment", "payment"))).toEqual(
    challenge,
  );
  expect(challengeNonce(challenge)).toBe(
    `0x${createHash("sha256").update(canonicalJson(challenge)).digest("hex")}`,
  );
});
it("handles optional parameters and quoted strings and requests no caching", () => {
  const challenge = createChallenge(
    request,
    {
      ...options,
      opaque: 'a"b\\c',
      digest: "sha-256=:YWJj:",
      header: "Payment-Authorization",
      description: 'Pay "now"',
    },
    secret,
  );
  expect(parseChallenge(buildChallenge(challenge))).toEqual(challenge);
  expect(challengeId(challenge, secret)).toBe(challenge.id);
  const exchange = challengeExchange("GET", "/booking", challenge);
  expect(exchange).toMatchObject({ status: 402, headers: { "Cache-Control": "no-store" } });
});
it("builds a real EIP-3009 credential, echoes the challenge and settles only once", () => {
  const { ledger, challenge, credential, server } = setup();
  expect(parseCredential(buildCredential(credential))).toEqual(credential);
  expect(credential.source).toBe(`did:pkh:eip155:84532:${payer}`);
  expect(credential.payload.nonce).toBe(challengeNonce(challenge));
  expect(server.verify(credential, challenge, now)).toEqual(credential);
  expect(ledger.entries).toHaveLength(0);
  const receipt = server.settle(credential, challenge, now);
  expect(receipt).toMatchObject({
    status: "success",
    method: "evm",
    reference: ledger.entries[0]?.digest,
    challengeId: challenge.id,
    chainId: "84532",
  });
  expect(parseReceipt(encodeReceipt(receipt), 200)).toEqual(receipt);
  expect(ledger.balance(payer, "USD")).toBe("8.750000");
  expectProblem(() => server.settle(credential, challenge, now), "invalid-challenge");
  expect(ledger.entries).toHaveLength(1);
});
it("answers a reused credential with 402 invalid-challenge and a fresh challenge without a second charge", () => {
  const { ledger, challenge, credential, server } = setup();
  const exchange: HttpExchange = {
    method: "POST",
    path: "/booking",
    headers: { Authorization: buildCredential(credential) },
    body: null,
  };
  const fresh = () => createChallenge(request, { ...options, opaque: "next" }, secret);
  expect(server.handle(exchange, challenge, now, fresh).status).toBe(200);
  const repeated = server.handle(exchange, challenge, now, fresh);
  expect(repeated).toMatchObject({
    status: 402,
    body: { type: "https://paymentauth.org/problems/invalid-challenge" },
  });
  expect(parseChallenge(header(repeated.headers, "WWW-Authenticate") as string).id).not.toBe(
    challenge.id,
  );
  expect(ledger.entries).toHaveLength(1);
});
it("consumes the challenge even if a different funded signer presents a fresh signature", () => {
  const { server, ledger, challenge, credential } = setup();
  server.settle(credential, challenge, now);
  const key = Uint8Array.from([...new Uint8Array(31), 2]);
  const signer = addressFromKey(key);
  ledger.createAccount(signer, { USD: "10.00" });
  const another = createCredential(challenge, domain, signer, "0", String(now + 300), key);
  expectProblem(() => server.settle(another, challenge, now), "invalid-challenge");
  expect(ledger.balance(signer, "USD")).toBe("10.00");
  expect(ledger.entries).toHaveLength(1);
});
it("checks the HMAC independently of exact challenge echo comparison", () => {
  const { server, credential, challenge } = setup();
  const forged = { ...challenge, id: "a".repeat(43) };
  expectProblem(
    () => server.verify({ ...credential, challenge: forged }, forged, now),
    "invalid-challenge",
  );
});
it("refuses a bound but non-JCS challenge request on the server", () => {
  const { server, credential, challenge } = setup();
  const changed = { ...challenge, request: base64url(JSON.stringify(request)) };
  changed.id = challengeId(changed, secret);
  expectProblem(
    () => server.verify({ ...credential, challenge: changed }, changed, now),
    "invalid-challenge",
  );
});
it("maps a ledger-refused self transfer to verification-failed", () => {
  const { server, ledger } = setup();
  const challenge = createChallenge({ ...request, recipient: payer }, options, secret);
  const credential = signedCredential(challenge);
  expectProblem(() => server.settle(credential, challenge, now), "verification-failed");
  expect(ledger.entries).toHaveLength(0);
});
it("honors the challenge's alternate credential header", () => {
  const { ledger, server } = setup();
  const challenge = createChallenge(
    request,
    { ...options, header: "Payment-Authorization" },
    secret,
  );
  const credential = signedCredential(challenge);
  const response = server.handle(
    {
      method: "POST",
      path: "/booking",
      headers: { "Payment-Authorization": buildCredential(credential) },
      body: null,
    },
    challenge,
    now,
    () => createChallenge(request, { ...options, opaque: "new" }, secret),
  );
  expect(response.status).toBe(200);
  expect(ledger.entries).toHaveLength(1);
});
it.each([
  "realm",
  "method",
  "intent",
  "request",
  "expires",
  "digest",
  "header",
  "opaque",
])("binds HMAC parameter %s", (field) => {
  const { challenge } = setup();
  const changes: Record<string, string> = {
    realm: "other.example",
    method: "tempo",
    intent: "other",
    request: encodeJson({ ...request, amount: "2" }, "base64url"),
    expires: new Date((now + 301) * 1000).toISOString(),
    digest: "different",
    header: "Payment-Authorization",
    opaque: "different",
  };
  expect(checkChallengeBinding({ ...challenge, [field]: changes[field] }, secret)).toBe(false);
});
it("refuses bad bindings, wrong echoes and unknown challenge identifiers", () => {
  for (const attack of ["id", "realm", "echo", "secret"]) {
    const { credential, server, challenge } = setup();
    if (attack === "id") credential.challenge.id = "a".repeat(43);
    if (attack === "realm") credential.challenge.realm = "attacker.example";
    if (attack === "echo")
      credential.challenge = createChallenge(request, { ...options, opaque: "other" }, secret);
    if (attack === "secret")
      credential.challenge = createChallenge(request, options, new Uint8Array(32).fill(8));
    expectProblem(() => server.verify(credential, challenge, now), "invalid-challenge");
  }
});
it.each([
  "expired",
  "missing",
  "validAfter",
  "validBefore",
  "tooLong",
])("refuses expiry condition %s", (attack) => {
  const { server, challenge, credential } = setup();
  if (attack === "expired") {
    const expired = createChallenge(
      request,
      { ...options, expires: new Date(now * 1000).toISOString() },
      secret,
    );
    expectProblem(() => server.verify(signedCredential(expired), expired, now), "payment-expired");
    return;
  }
  if (attack === "missing") {
    const { expires: _expires, ...without } = options;
    const unbounded = createChallenge(request, without, secret);
    expectProblem(
      () => server.verify(signedCredential(unbounded), unbounded, now),
      "payment-expired",
    );
    return;
  }
  if (attack === "validAfter") credential.payload.validAfter = String(now);
  if (attack === "validBefore") credential.payload.validBefore = String(now);
  if (attack === "tooLong") credential.payload.validBefore = String(now + 301);
  expectProblem(() => server.verify(credential, challenge, now), "payment-expired");
});
it.each([
  "value",
  "recipient",
  "nonce",
  "currency",
  "no-recipient",
])("refuses payload/request mismatch %s", (attack) => {
  const { server, challenge, credential } = setup();
  if (attack === "value") credential.payload.value = "2";
  if (attack === "recipient") credential.payload.to = payer;
  if (attack === "nonce") credential.payload.nonce = `0x${"44".repeat(32)}`;
  if (attack === "currency" || attack === "no-recipient") {
    const changed = {
      ...request,
      currency: attack === "currency" ? "GBP" : "USD",
      recipient: attack === "no-recipient" ? undefined : payee,
    };
    const next = createChallenge(changed, options, secret);
    expectProblem(
      () => server.verify({ ...credential, challenge: next }, next, now),
      "invalid-payload",
    );
    return;
  }
  expectProblem(() => server.verify(credential, challenge, now), "invalid-payload");
});
it.each([
  "signature",
  "signer",
  "source",
  "domain",
  "unknown-account",
])("refuses identity/signature failure %s", (attack) => {
  const { server, challenge, credential, ledger } = setup();
  if (attack === "signature") credential.payload.signature = `0x${"00".repeat(64)}1b`;
  if (attack === "signer") credential.payload.from = payee;
  if (attack === "source") credential.source = `did:pkh:eip155:1:${payer}`;
  if (attack === "domain") {
    const { type: _type, signature: _sig, ...auth } = credential.payload;
    credential.payload.signature = signAuthorization({ ...domain, chainId: "1" }, auth, secretKey);
  }
  const target =
    attack === "unknown-account" ? new MppServer(new Ledger(), secret, domain, "USD", 6) : server;
  expectProblem(() => target.verify(credential, challenge, now), "verification-failed");
  expect(ledger.entries).toHaveLength(0);
});
it("retains signer/nonce replay protection across server instances sharing the provider ledger", () => {
  const { ledger, server, challenge, credential } = setup();
  const { type: _type, signature: _sig, ...auth } = credential.payload;
  ledger.transfer(payer, payee, "1.25", "USD", authorizationOnceKey(domain, auth));
  expectProblem(() => server.verify(credential, challenge, now), "invalid-challenge");
});
it("refuses insufficient funds without consuming the challenge", () => {
  const { ledger, server, challenge, credential } = setup("1.00");
  expectProblem(() => server.verify(credential, challenge, now), "payment-insufficient");
  expectProblem(() => server.settle(credential, challenge, now), "payment-insufficient");
  expect(ledger.entries).toHaveLength(0);
  expect(ledger.balance(payer, "USD")).toBe("1.00");
});
it("preserves payment-insufficient when the ledger refuses after verification", () => {
  const { ledger, credential, challenge, server } = setup();
  const transfer = vi.spyOn(ledger, "transfer").mockImplementation(() => {
    throw new LedgerError("insufficient_funds");
  });
  try {
    expectProblem(() => server.settle(credential, challenge, now), "payment-insufficient");
  } finally {
    transfer.mockRestore();
  }
  expect(server.settle(credential, challenge, now).status).toBe("success");
});
it("refuses ambiguous credential header spellings with a fresh challenge", () => {
  const { server, credential, challenge, ledger } = setup();
  const value = buildCredential(credential);
  const response = server.handle(
    {
      method: "GET",
      path: "/booking",
      headers: { Authorization: value, authorization: value },
      body: null,
    },
    challenge,
    now,
    () => createChallenge(request, { ...options, opaque: "fresh" }, secret),
  );
  expect(response).toMatchObject({
    status: 402,
    body: { type: "https://paymentauth.org/problems/malformed-credential" },
  });
  expect(ledger.entries).toHaveLength(0);
});
it("returns source problem statuses for missing, malformed and unsupported credentials", () => {
  const { server, challenge, credential } = setup();
  const fresh = () => createChallenge(request, { ...options, opaque: "new" }, secret);
  const exchange: HttpExchange = { method: "GET", path: "/booking", headers: {}, body: null };
  expect(server.handle(exchange, challenge, now, fresh)).toMatchObject({
    status: 402,
    body: { type: "https://paymentauth.org/problems/payment-required" },
  });
  expect(
    server.handle({ ...exchange, headers: { Authorization: "garbage" } }, challenge, now, fresh),
  ).toMatchObject({
    status: 402,
    body: { type: "https://paymentauth.org/problems/malformed-credential" },
  });
  const unsupported = createChallenge(request, { ...options, method: "tempo" }, secret);
  expectProblem(
    () => server.verify({ ...credential, challenge: unsupported }, unsupported, now),
    "method-unsupported",
  );
  expectProblem(() => server.verify({}, challenge, now), "malformed-credential");
  expectProblem(() => server.verify(credential, challenge, NaN), "bad-request");
  expect(() => server.handle(exchange, challenge, now, () => challenge)).toThrow("fresh challenge");
  expect(() => server.handle(exchange, challenge, now, () => ({ ...fresh(), id: "bad" }))).toThrow(
    "fresh challenge",
  );
  for (const [code, status] of Object.entries(problemStatuses))
    expect(new MppError(code as keyof typeof problemStatuses).status).toBe(status);
});
it.each([
  "Bearer x",
  "Payment e30=",
  "Payment !!!",
  "Payment e30",
  "Payment ",
  "Payment e30 extra",
])("refuses malformed credential header %s", (raw) => {
  expectProblem(() => parseCredential(raw), "malformed-credential");
});
it.each([
  "Basic realm=x",
  "Payment id=x,",
  'Payment id="unterminated',
  "Payment id=x, ID=y",
  'Payment id=x, realm="a\n"',
  "Payment",
  "Payment id=x",
  'Payment id="x",\r\nrealm="injected"',
  'Payment id="x",\u00a0realm="injected"',
])("refuses malformed challenge %s", (raw) => {
  expect(() => parseChallenge(raw)).toThrow();
});
it("refuses non-JCS request encodings, unsupported header routing, ambiguous binding delimiters and undersized secrets", () => {
  const { challenge } = setup();
  expect(() => parseChallenge(`${buildChallenge(challenge)}, x="a", x="b"`)).toThrow();
  expect(() => parseChallenge(`Payment ${"x".repeat(32_769)}`)).toThrow();
  expect(() =>
    chargeRequest({ ...challenge, request: base64url(JSON.stringify(request)) }),
  ).toThrow();
  expect(() => createChallenge(request, { ...options, realm: "a|b" }, secret)).toThrow();
  expect(() => createChallenge(request, options, secret.slice(1))).toThrow();
  expect(() => new MppServer(new Ledger(), secret.slice(1), domain, "USD", 6)).toThrow();
  expect(() =>
    createCredential(
      createChallenge({ amount: "1", currency: "USD" }, options, secret),
      domain,
      payer,
      "0",
      "1",
      secretKey,
    ),
  ).toThrow("invalid-payload");
  expect(() =>
    parseChallenge(
      buildChallenge(challenge).replace('intent="charge"', 'header="Other", intent="charge"'),
    ),
  ).toThrow();
});
it("refuses non-success receipts and receipt headers outside 200 responses", () => {
  const { server, challenge, credential } = setup();
  const receipt = server.settle(credential, challenge, now);
  expectProblem(() => parseReceipt(encodeReceipt(receipt), 402), "bad-request");
  expect(() =>
    parseReceipt(encodeJson({ ...receipt, status: "failed" }, "base64url"), 200),
  ).toThrow();
  expect(() => parseReceipt(encodeJson({ ...receipt, unknown: true }, "base64url"), 200)).toThrow();
});
it("converts base units in both directions with a zero-minor-unit currency", () => {
  expect(convertMppAmount({ amount: "1.25", currency: "USD" }, 6)).toEqual({
    units: "1250000",
    currency: "USD",
  });
  expect(convertMppAmount({ units: "1250000", currency: "USD" }, 6)).toEqual({
    amount: "1.250000",
    currency: "USD",
  });
  expect(convertMppAmount({ amount: "100", currency: "JPY" }, 0)).toEqual({
    units: "100",
    currency: "JPY",
  });
  expect(convertMppAmount({ units: "100", currency: "JPY" }, 0)).toEqual({
    amount: "100",
    currency: "JPY",
  });
});
