// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Playwright globalSetup for the task #123 401-budget e2e. Runs once after the
// webServers (CSS@3000 + vite@5173) are up. It:
//   1. creates a fresh CSS account + pod (the verified solid-test-infrastructure recipe);
//   2. seeds the WebID profile (foaf:name + pim:storage — a fresh CSS pod has neither,
//      so without this the app sees no display name / no storage and looks broken);
//   3. seeds the gallery's `photos/` container with MANY schema:Photograph resources
//      (`photo-0..N-1.ttl`) — this is the REGRESSION SURFACE: pod-photos' listGallery
//      lists the photos container AND THEN reads EACH photo document individually
//      (one container GET + one read per photo — the N+1 walk in src/ui/gallery.ts),
//      so N photos => N+1 pod reads. The budget spec asserts the 401 count does NOT
//      scale with N.
// It writes the seeded credentials to a JSON sidecar the spec reads (the spec drives
// the real OIDC popup login with this account; the seeded data is its pod contents).
//
// SELF-CONTAINED: a cross-file .ts/.mjs import from a Playwright globalSetup trips the
// config transpiler (CJS/ESM mismatch), so everything is inlined (the harness rule).
// LOCAL-ONLY: every fetch targets http://localhost:3000 (the local CSS) — never the
// live deploy.
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const BASE = "http://localhost:3000";
const ISSUER = `${BASE}/`;
const TOKEN_ENDPOINT = `${BASE}/.oidc/token`;
const POD = "alice";
const WEBID = `${BASE}/${POD}/profile/card#me`;
const NAME = "Alice Photos";
const EMAIL = "alice@example.com";
const PASSWORD = "test-password-123";
// The photos container — the conventional fallback the app uses when no Type-Index
// registration is present (see photos-root.ts PHOTOS_SLUG → `${podRoot}photos/`).
// The photos container's child count is the regression surface (the 401 count must
// NOT scale with it).
const PHOTOS_CONTAINER = `${BASE}/${POD}/photos/`;
const PHOTO_COUNT = 12;

// Where the spec reads the seeded account + container facts.
const CREDS_PATH = fileURLToPath(new URL("./.seeded-account.json", import.meta.url));

interface Jar {
  cookie?: string;
}

async function jsonPost(url: string, body: unknown, jar: Jar) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (jar.cookie) headers.cookie = jar.cookie;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  const sc = res.headers.get("set-cookie");
  if (sc) jar.cookie = sc.split(";")[0];
  return { status: res.status, json: await res.json() };
}

async function controls(jar: Jar) {
  const res = await fetch(`${BASE}/.account/`, {
    headers: jar.cookie ? { cookie: jar.cookie } : {},
  });
  return (await res.json()).controls;
}

export default async function globalSetup() {
  // Guard: make sure :3000 is really a CSS (a stray dev server poisons everything with
  // 308/HTML). The solid-test-infrastructure gotcha.
  const probe = await fetch(`${BASE}/.account/`, { headers: { accept: "application/json" } });
  if (!probe.ok || !(probe.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(
      `Whatever is listening on ${BASE} is not a Community Solid Server ` +
        `(/.account/ -> ${probe.status} ${probe.headers.get("content-type")}). ` +
        "Check 'lsof -i :3000' — a stray dev server on :3000 is the usual culprit.",
    );
  }

  // 1. account -> password -> pod -> client credentials (the verified recipe). The CSS
  // webServer is NOT reused (reuseExistingServer:false in playwright.config), so the
  // server is FRESH every run — locally AND in CI — and the fixed `alice` account / pod
  // never pre-exists (the roborev LOW re-run finding). So a 4xx here IS a genuine error.
  const jar: Jar = {};
  await jsonPost(`${BASE}/.account/account/`, {}, jar); // {} body — an EMPTY body 500s with a JSON content-type
  const c = await controls(jar);
  await jsonPost(c.password.create, { email: EMAIL, password: PASSWORD }, jar);
  const pod = await jsonPost(c.account.pod, { name: POD }, jar);
  if (pod.status >= 400) throw new Error(`pod create failed: ${JSON.stringify(pod.json)}`);
  const cc = await jsonPost(c.account.clientCredentials, { name: "seed", webId: WEBID }, jar);

  // 2. exchange client-credentials for a DPoP-bound token (jose-built proofs; the
  //    resource writes carry the `ath` claim).
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "ES256" };
  const proof = (method: string, url: string, ath?: string) =>
    new SignJWT({ htu: url, htm: method, jti: randomUUID(), ...(ath ? { ath } : {}) })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .setIssuedAt()
      .sign(privateKey);
  const basic = Buffer.from(
    `${encodeURIComponent(cc.json.id)}:${encodeURIComponent(cc.json.secret)}`,
  ).toString("base64");
  const tr = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      dpop: await proof("POST", TOKEN_ENDPOINT),
    },
    body: "grant_type=client_credentials&scope=webid",
  });
  if (!tr.ok) throw new Error(`token ${tr.status}: ${await tr.text()}`);
  const { access_token } = await tr.json();
  const ath = createHash("sha256").update(access_token).digest("base64url");

  const authedPut = async (url: string, body: string, contentType: string) => {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: `DPoP ${access_token}`,
        dpop: await proof("PUT", url, ath),
        "content-type": contentType,
      },
      body,
    });
    if (!res.ok && res.status !== 205) {
      throw new Error(`PUT ${url} -> ${res.status}: ${await res.text()}`);
    }
  };

  // 3. seed the bare profile (foaf:name + pim:storage so the app has a display name +
  //    a storage root). NO solid:publicTypeIndex registration is seeded — the app then
  //    falls back to the conventional `${podRoot}photos/` container (and shows a "no
  //    registration" banner), which is exactly where we seed the photos below.
  await authedPut(
    `${BASE}/${POD}/profile/card`,
    `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix pim: <http://www.w3.org/ns/pim/space#>.
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.
<> a foaf:PersonalProfileDocument; foaf:maker <${WEBID}>; foaf:primaryTopic <${WEBID}>.
<${WEBID}> a foaf:Person;
  solid:oidcIssuer <${ISSUER}>;
  pim:storage <${BASE}/${POD}/>;
  foaf:name "${NAME}";
  vcard:hasPhoto <https://avatars.githubusercontent.com/u/9132?v=4>.
`,
    "text/turtle",
  );

  // 4. seed MANY schema:Photograph resources under photos/ — the regression surface. A
  //    PUT to `photos/photo-K.ttl` auto-creates the `photos/` container; each photo is a
  //    distinct URL listGallery GETs individually when the gallery loads (the listing +
  //    one read per photo — the N+1 walk in src/ui/gallery.ts), so N photos => N+1 reads.
  //    parsePhoto requires `<#it> a schema:Photograph` (with schema:name/contentUrl) to
  //    count as a photo row — so each seeded resource renders one `.pod-photos-tile`.
  for (let k = 0; k < PHOTO_COUNT; k++) {
    await authedPut(
      `${PHOTOS_CONTAINER}photo-${k}.ttl`,
      // The @jeswr/pod-photos data layer's vocab pins schema.org to the HTTPS namespace
      // (src/photos/vocab.ts SCHEMA = "https://schema.org/"); parsePhoto only counts a
      // resource as a photo when `<#it> a https://schema.org/Photograph`. Seeding with
      // the HTTP namespace makes every resource parse-but-not-a-photo → an EMPTY gallery
      // (the cause of the first e2e run's 0 tiles). Use HTTPS schema.org to match.
      `@prefix schema: <https://schema.org/>.
<#it> a schema:Photograph;
  schema:name "Photo ${k}";
  schema:contentUrl <${PHOTOS_CONTAINER}photo-${k}.jpg>.
`,
      "text/turtle",
    );
  }

  // 4b. PROVE the seeded resources are PRIVATE (the 401-budget test's load-bearing
  //     precondition). The regression guard only proves proactive auth if the photos
  //     are auth-REQUIRED: were they PUBLIC, the OLD unauthenticated-first reactive
  //     behaviour would ALSO see zero resource-server 401s, so the budget test could pass
  //     WITHOUT the proactive patch (roborev MEDIUM finding). CSS pods are private to the
  //     owner by default, but we ASSERT it rather than assume it: an UNAUTHENTICATED GET
  //     on both the container AND a seeded photo MUST be denied (401/403). If either is
  //     public, fail the setup loudly — the budget test would be meaningless.
  for (const url of [PHOTOS_CONTAINER, `${PHOTOS_CONTAINER}photo-0.ttl`]) {
    const anon = await fetch(url, { headers: { accept: "text/turtle" } });
    if (anon.status !== 401 && anon.status !== 403) {
      throw new Error(
        `Seeded resource ${url} is NOT private (unauthenticated GET -> ${anon.status}, ` +
          "expected 401/403). The 401-budget e2e requires auth-gated photos — a public " +
          "resource would let the OLD unauthenticated-first behaviour also pay zero 401s, " +
          "so the regression guard would not prove the proactive auth-fetch. Check the pod ACL.",
      );
    }
  }

  // 5. hand the spec the seeded facts (login credentials + the regression container).
  writeFileSync(
    CREDS_PATH,
    JSON.stringify(
      {
        base: BASE,
        webId: WEBID,
        email: EMAIL,
        password: PASSWORD,
        podRoot: `${BASE}/${POD}/`,
        photosContainer: PHOTOS_CONTAINER,
        photoCount: PHOTO_COUNT,
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`[global-setup] seeded ${WEBID} with ${PHOTO_COUNT} photos under photos/`);
}
