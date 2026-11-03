// AUTHORED-BY Codex GPT-6.1-Sol
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth } from "./index.js";
import { createMockLwsAs, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each([
  "resource_metadata",
  "legacy",
] as const)("LWS %s exchanges the Solid ID token, reuses its session and cache, and relogs after logout", async (challenge) => {
  const op = createMockOp();
  const as = createMockLwsAs({
    challenge,
    subject: {
      issuer: op.issuer,
      subject: op.subject,
      clientId: op.clientId,
      publicKey: op.publicKey,
      tokenType: "id_token",
    },
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return new URL(request.url).origin === new URL(as.issuer).origin
      ? as.fetch(request)
      : op.fetch(request);
  });
  const ui = { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) };
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    boundary: { roots: [op.root, as.root], automatic: false },
    lws: { subject: "oidc-id-token" },
    ui,
  });
  // First authenticate directly with LWS; the Solid DPoP path then uses the same OP session.
  expect((await auth.fetch(as.root + "private")).status).toBe(200);
  expect((await auth.identity())?.protocol).toBe("lws");
  expect((await auth.fetch(op.root + "private")).status).toBe(200);
  expect(op.stats.tokens).toBe(2); // Different storage context on the Solid request.
  expect((await auth.fetch(as.root + "private")).status).toBe(200);
  expect(as.stats.exchanges).toBe(2); // The binding captures the active Solid credential context.
  await auth.logout();
  await auth.login();
  expect((await auth.fetch(as.root + "private")).status).toBe(200);
  expect(op.stats.tokens).toBe(3);
  expect(as.stats.exchanges).toBe(3);
  const request = as.requests.find((r) => r.url === as.tokenEndpoint)!;
  const form = new URLSearchParams(await request.text());
  expect(form.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:id_token");
  expect(form.get("resource")).toBe(as.storage);
  expect(request.headers.has("dpop")).toBe(false);
  const authenticated = as.requests.filter((r) => r.headers.has("authorization"));
  expect(authenticated.every((r) => r.headers.get("authorization")?.startsWith("Bearer "))).toBe(
    true,
  );
});

function mockTokenFixture(tokenType: "jwt" | "id_token" = "jwt") {
  const keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const subject = {
    issuer: "https://agent.example/id",
    subject: "https://agent.example/id",
    clientId: "https://agent.example/id",
    publicKey: keys.publicKey.export({ format: "jwk" }),
    tokenType,
  };
  const as = createMockLwsAs({ challenge: "resource_metadata", subject });
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: subject.issuer,
    sub: subject.subject,
    client_id: subject.clientId,
    azp: subject.clientId,
    aud: [as.issuer],
    iat: now,
    exp: now + 300,
    jti: crypto.randomUUID(),
  };
  const jwt = (patch = {}, header = { alg: "ES256" }) => {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const data = encoded(header) + "." + encoded({ ...claims, ...patch });
    return (
      data +
      "." +
      sign("sha256", Buffer.from(data), {
        key: keys.privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url")
    );
  };
  const form = () =>
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      resource: as.storage,
      subject_token_type: "urn:ietf:params:oauth:token-type:" + tokenType,
      client_id: subject.clientId,
      subject_token: jwt(),
    });
  return { as, jwt, form };
}

test.each([
  "malformed",
  "algorithm",
  "signature",
  "iss",
  "sub",
  "exp",
  "iat",
  "grant",
  "resource",
  "type",
  "client",
  "client-claim",
  "aud",
  "no-aud",
  "jti",
])("mock LWS AS refuses invalid subject input: %s", async (kind) => {
  const f = mockTokenFixture();
  const form = f.form();
  const patches: Record<string, object> = {
    iss: { iss: "https://evil.example/" },
    sub: { sub: "https://evil.example/" },
    exp: { exp: 0 },
    iat: { iat: Date.now() / 1000 + 60 },
    "client-claim": { client_id: "different" },
    aud: { aud: [] },
    "no-aud": { aud: undefined },
    jti: { jti: undefined },
  };
  if (patches[kind]) form.set("subject_token", f.jwt(patches[kind]));
  if (kind === "malformed") form.delete("subject_token");
  if (kind === "algorithm") form.set("subject_token", f.jwt({}, { alg: "none" }));
  if (kind === "signature") {
    const other = mockTokenFixture();
    form.set("subject_token", other.jwt());
  }
  const fields: Record<string, string> = {
    grant: "grant_type",
    resource: "resource",
    type: "subject_token_type",
    client: "client_id",
  };
  if (fields[kind]) form.set(fields[kind]!, "invalid");
  expect((await f.as.fetch(f.as.tokenEndpoint, { method: "POST", body: form })).status).toBe(400);
  expect(f.as.stats.exchanges).toBe(0);
});

test("mock LWS AS refuses CID replay and ID token authorized-party mismatch", async () => {
  const f = mockTokenFixture();
  const form = f.form();
  expect((await f.as.fetch(f.as.tokenEndpoint, { method: "POST", body: form })).status).toBe(200);
  expect((await f.as.fetch(f.as.tokenEndpoint, { method: "POST", body: form })).status).toBe(400);
  const oidc = mockTokenFixture("id_token");
  const idForm = oidc.form();
  idForm.set("subject_token", oidc.jwt({ azp: "wrong" }));
  expect(
    (await oidc.as.fetch(oidc.as.tokenEndpoint, { method: "POST", body: idForm })).status,
  ).toBe(400);
});
