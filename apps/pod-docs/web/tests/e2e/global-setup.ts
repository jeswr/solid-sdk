// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Playwright globalSetup for the task #123 401-budget e2e. Runs once after the
// webServers (CSS@3000 + vite@5173) are up. It:
//   1. creates a fresh CSS account + pod (the verified solid-test-infrastructure recipe);
//   2. seeds the WebID profile (foaf:name + pim:storage — a fresh CSS pod has neither,
//      so without this the app sees no display name / no storage and looks broken);
//   3. seeds the DOCUMENTS CONTAINER `pod-docs/` with MANY separate `pd:Document`
//      RESOURCES (the regression surface): pod-docs' <DocumentBrowser> loads by listing
//      the container AND THEN reading EACH child document (DocsStore.list → read per
//      child), and the App ALSO reads the WebID profile — so a container of N documents
//      drives N+1 distinct pod reads on load. Under the OLD reactive manager EACH of
//      those reads paid a wasted 401; the proactive patch keeps the count flat. The
//      document count is the regression surface — the 401 count must NOT scale with it.
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
const NAME = "Alice Docs";
const EMAIL = "alice@example.com";
const PASSWORD = "test-password-123";
// The pod root + the conventional DOCUMENTS CONTAINER pod-docs' DocsStore browses when
// no Type-Index registration exists — `<podRoot>pod-docs/` (see src/store.ts DOCS_SLUG).
// We seed N separate `pd:Document` RESOURCES into that container; the browser lists the
// container and READS EACH child — the count is the regression surface (the 401 count
// must NOT scale with it: under the old reactive manager each of those N+1 reads paid
// its own 401).
const POD_ROOT = `${BASE}/${POD}/`;
const DOCS_CONTAINER = `${POD_ROOT}pod-docs/`;
const DOCUMENT_COUNT = 12;

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
  // never pre-exists. So a 4xx here IS a genuine error.
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
  //    a storage root). NO solid:publicTypeIndex registration is seeded — DocsStore then
  //    falls back to the conventional `${podRoot}pod-docs/` container, which is exactly
  //    where we seed the documents below.
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

  // 4. seed N separate `pd:Document` RESOURCES in the documents container (the regression
  //    surface). Unlike pod-mail (which models messages as sibling subjects in ONE doc),
  //    pod-docs stores each document as its OWN pod resource (see src/store.ts / document.ts),
  //    so the listing reads the container AND THEN GETs each child — N+1 distinct reads on
  //    load. A minimal valid document is `<#it> a pd:Document; dct:title "…"` (parseDocument
  //    only requires the `pd:Document` type; the listing keeps only children that parse to
  //    one). The point of the budget is that those N+1 reads pay a FLAT 401 count regardless
  //    of how many documents the container holds. A PUT to `<container><slug>` auto-creates
  //    the container on CSS, so no separate container-create call is needed.
  for (let k = 0; k < DOCUMENT_COUNT; k++) {
    const docUrl = `${DOCS_CONTAINER}doc-${String(k).padStart(2, "0")}.ttl`;
    await authedPut(
      docUrl,
      `@prefix pd: <https://w3id.org/jeswr/pod-docs#>.
@prefix dct: <http://purl.org/dc/terms/>.
@prefix xsd: <http://www.w3.org/2001/XMLSchema#>.
<#it> a pd:Document;
  dct:title "Document ${k}";
  pd:body "Body of document ${k}";
  dct:created "2026-06-1${k % 10}T12:00:00Z"^^xsd:dateTime;
  dct:modified "2026-06-1${k % 10}T12:00:00Z"^^xsd:dateTime.
`,
      "text/turtle",
    );
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
        podRoot: POD_ROOT,
        docsContainer: DOCS_CONTAINER,
        documentCount: DOCUMENT_COUNT,
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`[global-setup] seeded ${WEBID} with ${DOCUMENT_COUNT} documents in pod-docs/`);
}
