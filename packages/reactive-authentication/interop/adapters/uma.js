// External Solid-OIDC + UMA adapter: the library's SolidUmaTokenProvider (Solid-OIDC §9 with an UMA 2.0
// authorization server) against a real, configured deployment. The resource server answers 401 with
// `WWW-Authenticate: UMA as_uri="…", ticket="…"`; the client checks that the `as_uri` is trusted, reads the UMA
// metadata at `as_uri` + `/.well-known/uma2-configuration` (which must advertise the Solid-OIDC ID token profile
// in `uma_profiles_supported`), logs in at the user's Solid-OIDC provider in a real browser (WebID → issuer,
// PKCE, DPoP-bound ID token), pushes that ID token as the claim token of an `uma-ticket` grant with a DPoP proof
// made with the ID token's key, and presents the resulting RPT.
//
// This is Solid UMA evidence only when every step above is observed on the wire: an ordinary OAuth Bearer or
// DPoP access token (Keycloak, a plain Solid-OIDC server) never satisfies these scenarios — uma.login-read
// requires the UMA challenge, the uma-ticket grant with the ID token claim format, and the RPT's use.
//
// Data safety (as in the Solid adapter):
// - Writes happen only below an explicitly configured `scratchContainer`: one run-owned resource created with
//   `If-None-Match: *` and recorded as owned only on 201 Created; uma.cleanup deletes exactly that. Without a
//   scratch container the target is read-only against `privateResource` and write scenarios are UNTESTED.
// - Probes outside the credential boundary are read-only GETs; the untrusted-AS probe goes to a local server.
// - Tickets, ID tokens, RPTs and WebIDs are never logged or reported (only compared in memory).
import { once } from "node:events";
import { createServer } from "node:http";
import {
  CachingAuthorizationServerProvider,
  CachingClientProvider,
  ClientIdClientProvider,
  CredentialBoundary,
  DynamicRegistrationClientProvider,
  ID_TOKEN_CLAIM_FORMAT,
  ReactiveFetchManager,
  SolidUmaTokenProvider,
  trustUmaServers,
  UMA_TICKET_GRANT,
  WebIdIssuerProvider,
  XASProvider,
} from "../../dist/mod.js";
import { loopbackRedirectProblem } from "../lib/callbackServer.js";
import { CheckError } from "../lib/checkError.js";
import { recordingFetch, schemeName } from "../lib/recorder.js";
import { codeProviders } from "./index.js";

/**
 * @typedef {object} SolidUmaTargetConfig
 * @property {string} webId the test account's WebID; its profile names the Solid-OIDC issuer
 * @property {string} storage the test account's storage (ends with `/`); the credential boundary
 * @property {string} [issuer] expected Solid-OIDC issuer (checked against the ID token)
 * @property {string[]} [umaServers] trusted UMA `as_uri` values (default: the resource's own origin only)
 * @property {string} [scratchContainer] container for run-owned test writes (inside `storage`, ends with `/`)
 * @property {string} [privateResource] an existing private resource of the test account (read-only mode)
 * @property {string} [otherProtected] a protected resource outside `storage` (read-only probe)
 * @property {string} [clientId] Client Identifier Document URL (default: dynamic registration)
 * @property {string} redirectUri loopback redirect URI
 * @property {boolean} [insecure] plain-HTTP fixtures in the harness's own offline tests only (refused for live targets)
 */

function inside(url, container) {
  const u = new URL(url);
  const c = new URL(container);
  return (
    u.origin === c.origin &&
    u.pathname.startsWith(c.pathname) &&
    !/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(u.pathname) &&
    u.search === "" &&
    u.hash === ""
  );
}

/** Trusted `as_uri` values; unset manifest placeholders resolve to empty strings and are dropped. */
function umaServersOf(config) {
  const listed = (config.umaServers ?? []).filter((as) => as !== "");
  return listed.length === 0 ? undefined : listed;
}

/** Validates a Solid UMA target configuration before any network request; returns problems. */
export function validate(config) {
  const problems = [];
  const https = (name, value) => {
    try {
      const parsed = new URL(value);
      if (
        parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && config.insecure === true)
      )
        problems.push(`${name} must be https`);
      return parsed;
    } catch {
      problems.push(`${name} is not a URL`);
      return undefined;
    }
  };
  if (https("storage", config.storage) !== undefined && !config.storage.endsWith("/"))
    problems.push("storage must end with /");
  https("webId", config.webId);
  if (config.issuer !== undefined) https("issuer", config.issuer);
  if (config.clientId !== undefined) https("clientId", config.clientId);
  const redirect = loopbackRedirectProblem(config.redirectUri);
  if (redirect !== undefined) problems.push(redirect);
  if (
    config.scratchContainer !== undefined &&
    https("scratchContainer", config.scratchContainer) !== undefined
  ) {
    if (!config.scratchContainer.endsWith("/")) problems.push("scratchContainer must end with /");
    if (!inside(config.scratchContainer, config.storage))
      problems.push(
        "scratchContainer must be inside storage (same origin, no dot segments, query or fragment)",
      );
  }
  if (
    config.privateResource !== undefined &&
    https("privateResource", config.privateResource) !== undefined &&
    !inside(config.privateResource, config.storage)
  ) {
    problems.push("privateResource must be inside storage");
  }
  if (
    config.otherProtected !== undefined &&
    https("otherProtected", config.otherProtected) !== undefined &&
    inside(config.otherProtected, config.storage)
  ) {
    problems.push("otherProtected must be outside storage");
  }
  if (config.scratchContainer === undefined && config.privateResource === undefined)
    problems.push("configure scratchContainer (writes) or privateResource (read-only)");
  for (const [index, as] of (umaServersOf(config) ?? []).entries())
    https(`umaServers[${index}]`, as);
  return problems;
}

/** Decodes a compact JWT's payload (no verification: the library already validated it; facts stay in memory). */
function jwtPayload(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** The `UMA` challenge in a WWW-Authenticate value: its `as_uri` and whether a ticket is present (never its value). */
export function umaChallengeOf(header) {
  if (header === null || !/(^|,)\s*UMA\s/i.test(header)) return undefined;
  const at = header.search(/(^|,)\s*UMA\s/i);
  const rest = header.slice(at).replace(/^,?\s*UMA\s+/i, "");
  const asUri = /(?:^|,)\s*as_uri="([^"]*)"/i.exec(rest)?.[1];
  const ticket = /(?:^|,)\s*ticket="[^"]+"/i.test(rest);
  return { asUri, ticket };
}

/**
 * Observes the wire below the recorder: UMA challenges, ID token claims from the OP's token responses and the
 * shape of `uma-ticket` grants. Values are kept in memory for comparisons only.
 */
function observer(base = globalThis.fetch.bind(globalThis)) {
  const facts = { challenges: [], idTokens: [], umaGrants: [] };
  async function fetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    let form;
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")
    ) {
      form = new URLSearchParams(await request.clone().text());
    }
    const response = await base(request);
    if (response.status === 401) {
      const uma = umaChallengeOf(response.headers.get("www-authenticate"));
      if (uma !== undefined)
        facts.challenges.push({
          origin: url.origin,
          path: url.pathname,
          method: request.method,
          ...uma,
        });
    }
    const grant = form?.get("grant_type");
    const json =
      response.ok && response.headers.get("content-type")?.includes("json")
        ? await response
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    if (
      (grant === "authorization_code" || grant === "refresh_token") &&
      typeof json?.id_token === "string"
    ) {
      facts.idTokens.push({ raw: json.id_token, claims: jwtPayload(json.id_token) });
    }
    if (grant === UMA_TICKET_GRANT) {
      const claimToken = form.get("claim_token");
      facts.umaGrants.push({
        origin: url.origin,
        path: url.pathname,
        status: response.status,
        dpop: request.headers.has("dpop"),
        hasTicket: (form.get("ticket") ?? "") !== "",
        claimTokenFormat: form.get("claim_token_format"),
        claimTokenIsIdToken:
          claimToken !== null && facts.idTokens.some((t) => t.raw === claimToken),
        tokenType: typeof json?.token_type === "string" ? json.token_type.toLowerCase() : undefined,
      });
    }
    return response;
  }
  return { fetch, facts };
}

/** A local resource server whose UMA challenge names an untrusted authorization server; records credentials only. */
async function untrustedUmaResource() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({
      credentials: req.headers.authorization !== undefined || req.headers.dpop !== undefined,
    });
    res
      .writeHead(401, {
        "www-authenticate": 'UMA as_uri="https://uma.untrusted.invalid", ticket="ra-interop-decoy"',
        "cache-control": "no-store",
      })
      .end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    seen,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/**
 * @param {SolidUmaTargetConfig} config
 * @param {{runId: string, context(): Promise<object>, capabilities: object}} env
 */
export async function scenarios(config, env) {
  const writable = config.scratchContainer !== undefined;
  const created = writable
    ? new URL(`ra-interop-${env.runId}.txt`, config.scratchContainer).href
    : undefined;
  const readable = created ?? config.privateResource;
  const body = `reactive-authentication Solid UMA interop ${env.runId}`;
  const plain = globalThis.fetch.bind(globalThis);
  const needsScratch = () =>
    writable ? undefined : "no dedicated scratchContainer configured: read-only target";
  // `env.codeProvider` is a seam for the harness's offline self-tests only; live runs use the browser login.
  const newCode = env.codeProvider ?? codeProviders(config, env);
  const umaServers = umaServersOf(config);
  const insecure = config.insecure === true;

  /** A fresh application instance: its own OIDC session, RPT cache, recorder and observer. */
  function client({ managerBoundary = [] } = {}) {
    const watched = observer();
    const recorder = recordingFetch(watched.fetch);
    const http = recorder.http(insecure);
    const code = newCode();
    const issuers = new WebIdIssuerProvider(async () => new URL(config.webId), http);
    const op = new CachingAuthorizationServerProvider(new XASProvider(issuers, http));
    const clients =
      config.clientId === undefined
        ? new CachingClientProvider(new DynamicRegistrationClientProvider(http))
        : new ClientIdClientProvider(new URL(config.clientId), http);
    const provider = new SolidUmaTokenProvider(config.redirectUri, code, op, clients, {
      http,
      verifyWebId: true,
      ...(umaServers === undefined
        ? {}
        : { trustAuthorizationServer: trustUmaServers(umaServers) }),
    });
    const boundary = new CredentialBoundary([config.storage, ...managerBoundary], {
      allowInsecureHttp: insecure || managerBoundary.length > 0,
    });
    const manager = new ReactiveFetchManager({
      providers: [provider],
      boundary,
      fetch: recorder.fetch,
    });
    return { manager, recorder, facts: watched.facts, code, provider };
  }

  const successfulGrants = (facts, since = 0) =>
    facts.umaGrants.slice(since).filter((g) => g.status === 200);
  const codeExchanges = (recorder) =>
    recorder.log.filter((e) => e.grantType === "authorization_code" && e.status === 200).length;
  const credentialed = (recorder, mark, prefix) =>
    recorder
      .since(mark)
      .filter(
        (e) =>
          `${e.origin}${e.path}`.startsWith(prefix) && (e.authorization !== undefined || e.dpop),
      );
  const status = async (responsePromise) => {
    const response = await responsePromise;
    await response.body?.cancel();
    return response.status;
  };
  const ok = (s) => s === 200 || s === 201 || s === 204 || s === 205;

  /** Names the precise reason when the deployment did not start a Solid UMA flow at all. */
  function requireUmaChallenge(c, finalStatus) {
    if (c.facts.challenges.length > 0) return;
    // Recorded challenge schemes are already reduced to known names or "other" (recorder.schemeName).
    const schemes = [
      ...new Set(
        c.recorder.log
          .filter((e) => e.status === 401)
          .map((e) => schemeName(e.challenge) ?? "none"),
      ),
    ];
    throw new CheckError(
      schemes.length === 0
        ? `the resource answered ${finalStatus} without a 401 challenge, so no UMA flow started`
        : `the resource's 401 carried no UMA challenge with as_uri and ticket (schemes: ${schemes.join(", ")}); an ordinary OAuth/DPoP challenge is not Solid UMA evidence`,
    );
  }

  return [
    {
      id: "uma.login-read",
      async run(ctx, state) {
        const c = client();
        state.main = c;
        state.created = [];
        if (writable) {
          // The first protected request (a create-only PUT) triggers the UMA flow. Ownership is recorded
          // only on 201 Created, so cleanup never deletes anything this run did not confirm creating.
          const made = await status(
            c.manager.fetch(created, {
              method: "PUT",
              headers: { "content-type": "text/plain", "if-none-match": "*" },
              body,
              signal: ctx.signal,
            }),
          );
          requireUmaChallenge(c, made);
          ctx.check(
            made === 201,
            made === 200 || made === 204
              ? `creation with If-None-Match: * answered ${made}, not 201 Created: this run cannot confirm it created the resource, so it is not recorded as run-owned and will not be deleted`
              : `creation of the run-owned resource answered ${made} (expected 201 Created)`,
          );
          state.created.push(created);
        } else {
          const read = await status(
            c.manager.fetch(config.privateResource, { signal: ctx.signal }),
          );
          requireUmaChallenge(c, read);
          ctx.equal(read, 200, "authenticated read of the configured private resource");
        }

        // 1. The resource server's UMA challenge.
        const first = c.facts.challenges[0];
        ctx.check(first.ticket, "the UMA challenge carried a permission ticket");
        ctx.check(
          typeof first.asUri === "string" &&
            URL.canParse(first.asUri) &&
            (new URL(first.asUri).protocol === "https:" || insecure),
          "the UMA challenge named an https as_uri",
        );
        const firstRequest = c.recorder.log.find(
          (e) => e.status === 401 && e.origin === first.origin && e.path === first.path,
        );
        ctx.check(
          firstRequest !== undefined &&
            firstRequest.authorization === undefined &&
            !firstRequest.dpop,
          "the challenged request carried no credentials",
        );
        if (umaServers !== undefined)
          ctx.check(
            umaServers.some((u) => new URL(u).href === new URL(first.asUri).href),
            "the challenge's as_uri is one of the configured trusted UMA servers",
          );
        else
          ctx.equal(
            new URL(first.asUri).origin,
            new URL(readable).origin,
            "the default policy trusts only an as_uri on the resource's origin",
          );

        // 2. The UMA authorization server's metadata (read unauthenticated at as_uri).
        const metadataPath = `${new URL(first.asUri).pathname.replace(/\/$/, "")}/.well-known/uma2-configuration`;
        const metadata = c.recorder.log.filter(
          (e) => e.origin === new URL(first.asUri).origin && e.path === metadataPath,
        );
        ctx.check(
          metadata.length >= 1 &&
            metadata.every(
              (e) =>
                e.method === "GET" && e.status === 200 && e.authorization === undefined && !e.dpop,
            ),
          "UMA metadata was read unauthenticated from as_uri/.well-known/uma2-configuration",
        );

        // 3. The Solid-OIDC login (WebID → issuer, PKCE, DPoP-bound ID token).
        ctx.equal(
          codeExchanges(c.recorder),
          1,
          "authorization code exchanges at the Solid-OIDC provider",
        );
        const tokenRequest = c.recorder.log.find((e) => e.grantType === "authorization_code");
        ctx.check(
          tokenRequest?.dpop === true && tokenRequest.status === 200,
          "the code was exchanged with a DPoP proof",
        );
        ctx.check(
          c.code.requests.every(
            (r) =>
              r.codeChallengeMethod === "S256" &&
              r.hasState &&
              r.hasNonce &&
              r.responseType === "code",
          ),
          "every authorization request used S256 PKCE, state and nonce",
        );
        ctx.check(
          /\bopenid\b/.test(c.code.requests.at(-1).scope) &&
            /\bwebid\b/.test(c.code.requests.at(-1).scope),
          "openid and webid scopes requested",
        );
        const idToken = c.facts.idTokens.at(-1)?.claims;
        ctx.check(idToken !== undefined, "the provider issued an ID token");
        ctx.same(idToken.webid, config.webId, "the ID token's webid claim is the configured WebID");
        if (config.issuer !== undefined)
          ctx.same(idToken.iss, config.issuer, "the ID token issuer is the configured issuer");
        ctx.check(
          typeof idToken.cnf?.jkt === "string",
          "the ID token is DPoP-bound (cnf.jkt), as Solid-OIDC §9.3 requires for the claim push",
        );
        const audiences = Array.isArray(idToken.aud) ? idToken.aud : [idToken.aud];
        ctx.check(audiences.includes("solid"), 'the ID token audience includes "solid"');

        // 4. The claim push: uma-ticket grant with the ticket, the ID token and a DPoP proof.
        // (A DPoP-nonce retry may add one unsuccessful attempt; every attempt must have the same shape.)
        const grants = c.facts.umaGrants;
        ctx.check(grants.length >= 1, "an uma-ticket grant was sent");
        ctx.check(
          grants.every((g) => g.origin === new URL(first.asUri).origin),
          "every uma-ticket grant went to the challenge's authorization server",
        );
        ctx.check(
          grants.every((g) => g.hasTicket),
          "every grant carried the permission ticket",
        );
        ctx.check(
          grants.every((g) => g.claimTokenFormat === ID_TOKEN_CLAIM_FORMAT),
          `every grant used claim_token_format ${ID_TOKEN_CLAIM_FORMAT}`,
        );
        ctx.check(
          grants.every((g) => g.claimTokenIsIdToken),
          "every claim token was the ID token issued by the Solid-OIDC provider",
        );
        ctx.check(
          grants.every((g) => g.dpop),
          "every grant carried a DPoP proof (made with the ID token's key)",
        );
        const issued = successfulGrants(c.facts);
        ctx.equal(issued.length, 1, "RPTs issued by the UMA authorization server");
        const grant = issued[0];
        ctx.check(
          grant.tokenType === "dpop" || grant.tokenType === "bearer",
          `RPT token_type ${grant.tokenType}`,
        );

        // 5. The RPT's use on the replayed request.
        const replay = c.recorder.log
          .slice(c.recorder.log.indexOf(firstRequest) + 1)
          .find(
            (e) => e.origin === first.origin && e.path === first.path && e.method === first.method,
          );
        ctx.equal(
          replay?.authorization,
          grant.tokenType === "dpop" ? "DPoP" : "Bearer",
          "the replayed request presented the RPT with its token type's scheme",
        );
        ctx.equal(
          replay.dpop,
          grant.tokenType === "dpop",
          "a DPoP proof accompanies a DPoP-bound RPT (and only then)",
        );

        if (writable) {
          const read = await c.manager.fetch(created, { signal: ctx.signal });
          ctx.equal(read.status, 200, "the created resource reads back");
          ctx.equal(await read.text(), body, "the written content reads back");
        }
        ctx.note({
          mode: writable ? "scratch-writes" : "read-only",
          rptTokenType: grant.tokenType,
          umaServerSameOrigin: new URL(first.asUri).origin === new URL(readable).origin,
          clientRegistration: config.clientId === undefined ? "dynamic" : "client-id-document",
        });
      },
    },
    {
      id: "uma.private-read",
      after: ["uma.login-read"],
      async run(ctx, { main }) {
        const anonymous = await status(plain(readable, { signal: ctx.signal }));
        ctx.check(
          anonymous === 401 || anonymous === 403,
          `the resource is private (unauthenticated GET answered ${anonymous})`,
        );
        const before = main.facts.umaGrants.length;
        const response = await main.manager.fetch(readable, { signal: ctx.signal });
        ctx.equal(response.status, 200, "authenticated GET status");
        const text = await response.text();
        if (writable) ctx.equal(text, body, "the written content reads back");
        const afterFirst = main.facts.umaGrants.length;
        ctx.equal(
          await status(main.manager.fetch(readable, { signal: ctx.signal })),
          200,
          "repeated GET",
        );
        ctx.equal(
          main.facts.umaGrants.length,
          afterFirst,
          "the RPT was reused for the same resource (no new grant)",
        );
        ctx.equal(
          codeExchanges(main.recorder),
          1,
          "the Solid-OIDC session was reused (no new login)",
        );
        ctx.note({ grantsForFirstGet: afterFirst - before });
      },
    },
    {
      id: "uma.write",
      needs: ["writes"],
      after: ["uma.login-read"],
      untested: needsScratch,
      async run(ctx, { main }) {
        const current = await main.manager.fetch(created, { signal: ctx.signal });
        const etag = current.headers.get("etag");
        await current.body?.cancel();
        ctx.check(etag !== null, "the created resource has an ETag");
        const updated = `${body} (updated)`;
        ctx.check(
          ok(
            await status(
              main.manager.fetch(created, {
                method: "PUT",
                headers: { "content-type": "text/plain", "if-match": etag },
                body: updated,
                signal: ctx.signal,
              }),
            ),
          ),
          "conditional update of the run-owned resource",
        );
        const read = await main.manager.fetch(created, { signal: ctx.signal });
        ctx.equal(await read.text(), updated, "the update reads back");
        ctx.equal(
          codeExchanges(main.recorder),
          1,
          "the Solid-OIDC session was reused (no new login)",
        );
      },
    },
    {
      id: "uma.boundary",
      after: ["uma.login-read"],
      async run(ctx, { main }) {
        // (a) Outside the credential boundary nothing is upgraded: a look-alike path and, when configured,
        //     another protected resource (read-only GETs).
        const mark = main.recorder.mark();
        const grants = main.facts.umaGrants.length;
        const lookalike = new URL(
          `ra-interop-absent-${env.runId}`,
          `${config.storage.replace(/\/$/, "")}-lookalike/`,
        ).href;
        await status(main.manager.fetch(lookalike, { signal: ctx.signal }));
        const probes = [lookalike];
        if (config.otherProtected !== undefined) {
          const s = await status(main.manager.fetch(config.otherProtected, { signal: ctx.signal }));
          ctx.check(
            s === 401 || s === 403,
            `the protected resource outside the storage stays unauthorized (${s})`,
          );
          probes.push(config.otherProtected);
        }
        for (const url of probes)
          ctx.equal(
            credentialed(main.recorder, mark, url).length,
            0,
            "credentialed requests outside the boundary",
          );
        ctx.equal(
          main.facts.umaGrants.length,
          grants,
          "no ID token was pushed for resources outside the boundary",
        );

        // (b) Inside the boundary, a challenge naming an untrusted UMA server is refused before any
        //     metadata request, login or claim push (a local resource server; the as_uri is unresolvable).
        const lure = await untrustedUmaResource();
        try {
          const c = client({ managerBoundary: [`${lure.url}/`] });
          const outcome = await c.manager.fetch(`${lure.url}/private`, { signal: ctx.signal }).then(
            (r) => r.status,
            () => "refused",
          );
          ctx.check(
            outcome === 401 || outcome === "refused",
            `the untrusted UMA challenge was not answered with credentials (${outcome})`,
          );
          ctx.equal(c.code.calls, 0, "no login for an untrusted UMA server");
          ctx.equal(c.facts.umaGrants.length, 0, "no claim push to an untrusted UMA server");
          ctx.check(
            c.recorder.log.every((e) => e.origin === lure.url),
            "no request left for any other server (metadata, OP, UMA AS)",
          );
          ctx.check(
            lure.seen.length >= 1 && lure.seen.every((s) => !s.credentials),
            "the resource never received credentials",
          );
        } finally {
          await lure.close();
        }
        ctx.note({ otherProtectedProbed: config.otherProtected !== undefined });
      },
    },
    {
      id: "uma.logout",
      after: ["uma.login-read"],
      async run(ctx) {
        const c = client();
        ctx.equal(
          await status(c.manager.fetch(readable, { signal: ctx.signal })),
          200,
          "GET before logout",
        );
        ctx.equal(
          await status(c.manager.fetch(readable, { signal: ctx.signal })),
          200,
          "second GET before logout",
        );
        ctx.equal(successfulGrants(c.facts).length, 1, "the cached RPT was reused before logout");
        await c.manager.logout();
        ctx.equal(
          await status(c.manager.fetch(readable, { signal: ctx.signal })),
          200,
          "GET after logout (authorized again)",
        );
        ctx.equal(
          successfulGrants(c.facts).length,
          2,
          "logout dropped the RPT: a new uma-ticket grant was needed",
        );
        ctx.equal(
          codeExchanges(c.recorder),
          2,
          "logout forgot the Solid-OIDC session: a new login was needed",
        );
      },
    },
    {
      id: "uma.cleanup",
      after: ["uma.login-read"],
      always: true, // runs even when uma.login-read failed after creating something
      untested: needsScratch,
      async run(ctx, state) {
        if (state.main === undefined)
          throw new Error("blocked: uma.login-read did not run, so nothing can be cleaned up");
        if (state.created.length === 0)
          throw new Error(
            "blocked: uma.login-read recorded nothing as run-owned (no 201 Created), so nothing is deleted",
          );
        for (const url of [...state.created].reverse()) {
          const deleted = await status(
            state.main.manager.fetch(url, { method: "DELETE", signal: ctx.signal }),
          );
          ctx.check(ok(deleted), `DELETE of the run-owned resource answered ${deleted}`);
        }
        const gone = await status(state.main.manager.fetch(created, { signal: ctx.signal }));
        ctx.check(gone === 404 || gone === 410, `the run-owned resource is gone (${gone})`);
      },
    },
  ];
}
