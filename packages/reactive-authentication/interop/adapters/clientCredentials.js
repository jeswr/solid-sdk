// Client credentials (a script or service acting as its own WebID), with the library in Node and no browser:
// ClientCredentialsTokenProvider obtains DPoP-bound tokens with the OAuth 2.0 client credentials grant and the
// reactive client upgrades challenged requests with them. Separate from interactive Solid-OIDC.
//
// Community Solid Server issues these credentials through its account API (JSON controls: password login, then
// `controls.account.clientCredentials`); for local disposable targets the adapter creates a credential for the
// seeded test account at the start and deletes it at the end. Live targets pass an existing id/secret instead.
import {
  ClientCredentialsTokenProvider,
  CredentialBoundary,
  ReactiveFetchManager,
  XASProvider,
} from "../../dist/mod.js";
import { recordingFetch } from "../lib/recorder.js";
import { inside } from "./solid.js";

/**
 * @typedef {object} ClientCredentialsConfig
 * @property {string} issuer
 * @property {string} storage the account's storage root (explicit credential boundary)
 * @property {string} webId the WebID the credential acts as
 * @property {string} scratchContainer run-owned data goes below it
 * @property {string} [otherProtected] a protected resource outside the boundary (read-only probe)
 * @property {{email: string, password: string}} [account] CSS account login, to create a disposable credential
 * @property {string} [clientId] an existing credential (instead of `account`)
 * @property {string} [clientSecret]
 * @property {boolean} [insecure]
 */
export function validate(config, env = {}) {
  const problems = [];
  const url = (name, value) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && config.insecure !== true)
        problems.push(`${name} must be https`);
      return parsed;
    } catch {
      problems.push(`${name} is not a URL`);
      return undefined;
    }
  };
  url("issuer", config.issuer);
  url("webId", config.webId);
  if (url("storage", config.storage) !== undefined && !config.storage.endsWith("/"))
    problems.push("storage must end with /");
  // The same containment rules as the Solid adapter: origin, path-segment boundary, no traversal, query or fragment.
  if (
    url("scratchContainer", config.scratchContainer) !== undefined &&
    !(config.scratchContainer.endsWith("/") && inside(config.scratchContainer, config.storage))
  ) {
    problems.push(
      "scratchContainer must be a container inside storage (same origin, path-segment boundary, no dot segments, query or fragment)",
    );
  }
  if (
    config.otherProtected !== undefined &&
    url("otherProtected", config.otherProtected) !== undefined &&
    inside(config.otherProtected, config.storage)
  )
    problems.push("otherProtected must be outside storage");
  if ((config.account === undefined) === (config.clientId === undefined))
    problems.push(
      "configure exactly one of account (create a disposable credential) or clientId/clientSecret",
    );
  if (config.clientId !== undefined && typeof config.clientSecret !== "string")
    problems.push("clientSecret is required with clientId");
  // Creating credentials with an account password is for disposable local servers only; live targets pass an id/secret.
  if (config.account !== undefined && env.live === true)
    problems.push(
      "account-based credential creation is for disposable local targets only; configure clientId/clientSecret for live targets",
    );
  return problems;
}

/**
 * CSS account API: log in, then create a client credential for `webId`. Returns {id, secret, remove()}.
 * Every control URL the server returns must be on the issuer's origin, and redirects are never followed, so the
 * account password and token can only ever go to the configured local server.
 */
export async function createCredential(config, name, signal) {
  const origin = new URL(config.issuer).origin;
  const onIssuer = (value) => {
    const url = new URL(value);
    if (url.origin !== origin)
      throw new Error("the CSS account API returned a control URL outside the issuer's origin");
    return url;
  };
  const json = async (url, init = {}) => {
    const response = await fetch(onIssuer(url), {
      ...init,
      redirect: "manual",
      signal,
      headers: { accept: "application/json", ...init.headers },
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("the CSS account API answered with a redirect, which is not followed");
    if (!response.ok) throw new Error(`CSS account API answered ${response.status}`);
    return await response.json();
  };
  const { controls } = await json(new URL(".account/", config.issuer));
  const { authorization } = await json(controls.password.login, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config.account),
  });
  const auth = { authorization: `CSS-Account-Token ${authorization}` };
  const account = await json(new URL(".account/", config.issuer), { headers: auth });
  const created = await json(account.controls.account.clientCredentials, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ name, webId: config.webId }),
  });
  const resource = onIssuer(created.resource);
  return {
    id: created.id,
    secret: created.secret,
    async remove() {
      const response = await fetch(resource, {
        method: "DELETE",
        headers: auth,
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      await response.body?.cancel();
      return response.status;
    },
  };
}

const status = async (promise) => {
  const response = await promise;
  await response.body?.cancel();
  return response.status;
};

export async function scenarios(config, env) {
  const container = new URL(`ra-interop-cc-${env.runId}/`, config.scratchContainer).href;
  const resource = `${container}data.txt`;
  const body = `reactive-authentication client credentials ${env.runId}`;
  const owned = [];
  let credential;

  const client = () => {
    const recorder = recordingFetch();
    const http = recorder.http(config.insecure === true);
    const provider = new ClientCredentialsTokenProvider(
      new XASProvider({ getIssuer: async () => new URL(config.issuer) }, http),
      credential.id,
      credential.secret,
      { http },
    );
    const manager = new ReactiveFetchManager({
      providers: [provider],
      boundary: new CredentialBoundary([config.storage], {
        allowInsecureHttp: config.insecure === true,
      }),
      fetch: recorder.fetch,
    });
    return { manager, recorder };
  };
  const grants = (recorder) =>
    recorder.log.filter((e) => e.grantType === "client_credentials" && e.status === 200);
  const create = async (manager, url, type, content, signal) => {
    const created = await status(
      manager.fetch(url, {
        method: "PUT",
        headers: { "content-type": type, "if-none-match": "*" },
        body: content,
        signal,
      }),
    );
    if (created === 201) owned.push(url); // ownership only for a confirmed creation
    return created;
  };

  const list = [
    {
      id: "cc.token-write",
      async run(ctx, state) {
        credential =
          config.account === undefined
            ? { id: config.clientId, secret: config.clientSecret }
            : await createCredential(config, `ra-interop-${env.runId}`, ctx.signal);
        ctx.check(
          typeof credential.id === "string" && typeof credential.secret === "string",
          "a client credential is available",
        );
        state.main = client();
        const { manager, recorder } = state.main;
        ctx.equal(
          await create(manager, container, "text/turtle", "", ctx.signal),
          201,
          "the run-owned container was created (If-None-Match: *)",
        );
        ctx.equal(
          await create(manager, resource, "text/plain", body, ctx.signal),
          201,
          "the run-owned resource was created",
        );
        const writes = recorder.log.filter(
          (e) => `${e.origin}${e.path}` === container && e.method === "PUT",
        );
        ctx.check(
          writes[0]?.authorization === undefined && writes[0]?.status === 401,
          "the first attempt was sent without credentials and challenged",
        );
        ctx.equal(
          writes.at(-1).authorization,
          "DPoP",
          "the replay used a DPoP-bound client credentials token",
        );
        ctx.check(writes.at(-1).dpop, "the replay carried a DPoP proof");
        const tokenRequests = grants(recorder);
        ctx.equal(tokenRequests.length, 1, "client credentials grants");
        ctx.equal(
          tokenRequests[0].authorization,
          "Basic",
          "the client authenticated with client_secret_basic",
        );
        ctx.check(tokenRequests[0].dpop, "the grant carried a DPoP proof");
        ctx.note({
          credential:
            config.account === undefined ? "configured" : "created via the CSS account API",
        });
      },
    },
    {
      id: "cc.private-read",
      after: ["cc.token-write"],
      async run(ctx, { main }) {
        ctx.check(
          [401, 403].includes(await status(fetch(resource, { signal: ctx.signal }))),
          "the resource is private",
        );
        const response = await main.manager.fetch(resource, { signal: ctx.signal });
        ctx.equal(response.status, 200, "authenticated read");
        ctx.equal(await response.text(), body, "the content reads back");
        ctx.equal(grants(main.recorder).length, 1, "the cached token was reused");
      },
    },
    {
      id: "cc.boundary",
      after: ["cc.token-write"],
      untested: () =>
        config.otherProtected === undefined ? "no otherProtected resource configured" : undefined,
      async run(ctx, { main }) {
        const mark = main.recorder.mark();
        ctx.equal(
          await status(main.manager.fetch(config.otherProtected, { signal: ctx.signal })),
          401,
          "the protected resource outside the boundary stays challenged",
        );
        ctx.equal(
          main.recorder.since(mark).filter((e) => e.authorization !== undefined || e.dpop).length,
          0,
          "credentialed requests outside the boundary",
        );
      },
    },
    {
      id: "cc.forget",
      after: ["cc.token-write"],
      async run(ctx) {
        const { manager, recorder } = client();
        ctx.equal(
          await status(manager.fetch(resource, { signal: ctx.signal })),
          200,
          "read with a fresh instance",
        );
        await manager.logout();
        ctx.equal(
          await status(manager.fetch(resource, { signal: ctx.signal })),
          200,
          "read after logout",
        );
        ctx.equal(grants(recorder).length, 2, "logout forgot the token: a new grant was needed");
      },
    },
    {
      id: "cc.cleanup",
      after: ["cc.token-write"],
      always: true,
      async run(ctx, { main }) {
        if (owned.length === 0 && credential?.remove === undefined)
          throw new Error("blocked: nothing was created");
        for (const url of [...owned].reverse()) {
          ctx.check(
            [200, 204, 205].includes(
              await status(main.manager.fetch(url, { method: "DELETE", signal: ctx.signal })),
            ),
            "DELETE of a run-owned resource",
          );
        }
        owned.length = 0;
        if (credential?.remove !== undefined)
          ctx.check(
            [200, 204, 205].includes(await credential.remove()),
            "the disposable client credential was deleted",
          );
      },
    },
  ];
  return list;
}
