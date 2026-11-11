// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { nonReactiveFetch } from "@jeswr/reactive-authentication";
import { LiteralAs, LiteralFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { boundedDocumentFetch } from "./documents.js";
import { secureUrl } from "./options.js";
import type { Identity, PodAuth } from "./types.js";

/** Map pod → pod, account/password/webid/profile → account-id, sign-in → sign-in in the shell. */
export type RegistrationStep = "account" | "password" | "pod" | "webid" | "profile" | "sign-in";
export type RegistrationErrorCode =
  | "username-taken"
  | "weak-password"
  | "registration-closed"
  | "invalid-username"
  | "invalid-display-name"
  | "unsafe-control"
  | "invalid-response"
  | "registration-failed"
  | "identity-mismatch"
  | "registration-in-progress";
/**
 * `unknown`: the predicted pod answered 401/403. CSS denies unauthenticated reads of missing
 * children too, so this cannot distinguish a private pod from a free name.
 */
export type UsernameAvailability = "available" | "taken" | "unknown" | "invalid";
export interface RegistrationPreview {
  pod: string;
  webId: string;
}
/** Public, confirmed results only. No passwords, account authorization tokens or response bodies. */
export interface RegistrationCreated {
  account?: true;
  password?: true;
  podUrl?: string;
  webId?: string;
  profile?: true;
  /** CSS requires an email-shaped login ID; this reserved address is not a recovery email. */
  loginId?: string;
  signInHint?: Readonly<{ issuer: string }>;
}
export class RegistrationError extends Error {
  readonly code: RegistrationErrorCode;
  readonly step: RegistrationStep | "check";
  readonly created: Readonly<RegistrationCreated>;
  constructor(
    code: RegistrationErrorCode,
    step: RegistrationStep | "check",
    created: RegistrationCreated = {},
  ) {
    // Never retain raw causes: transports, providers and JSON errors may echo credentials.
    super(`Registration failed (${code}) at ${step}`);
    this.name = "RegistrationError";
    this.code = code;
    this.step = step;
    this.created = Object.freeze({ ...created });
  }
}
export interface RegistrationRequest {
  username: string;
  displayName: string;
  password: string;
}
export interface RegistrationOperationOptions {
  signal?: AbortSignal;
  /** Called before each step, with a frozen snapshot of previously confirmed results. */
  onStep?: (step: RegistrationStep, created: Readonly<RegistrationCreated>) => void;
}
export interface RegistrationOptions {
  accountApi: string | null;
  podHost?: string;
  podAuth: Pick<PodAuth, "login" | "fetch">;
  /** Pristine transport, never podAuth.fetch. Captured at construction. */
  fetch?: typeof fetch;
  /** Explicit local test/development opt-in; production always refuses HTTP. */
  allowInsecureLoopback?: boolean;
}
export interface Registration {
  readonly methods: readonly ["password"];
  available(options?: { signal?: AbortSignal }): Promise<boolean>;
  checkUsername(name: string, options?: { signal?: AbortSignal }): Promise<UsernameAvailability>;
  previewUrls(name: string): RegistrationPreview;
  register(request: RegistrationRequest, options?: RegistrationOperationOptions): Promise<Identity>;
}

const validUsername = (name: string) =>
  typeof name === "string" && name.length >= 3 && name.length <= 30 && !/[^a-z0-9-]/u.test(name);
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

/** CSS v7 account flow. Each call owns its account token; no cookies or credentials are cached. */
export function createRegistration(options: RegistrationOptions): Registration {
  const { accountApi, podAuth } = options;
  const insecure =
    options.allowInsecureLoopback === true &&
    (globalThis as { process?: { env: { NODE_ENV?: string } } }).process?.env.NODE_ENV !==
      "production";
  const endpoint = (value: string): URL => {
    const url = secureUrl(value, insecure, "registration endpoint");
    if (url.search || url.hash || /[<>"{}|^`\\\s]/u.test(url.href))
      throw new TypeError("Invalid registration endpoint");
    return url;
  };
  const api = accountApi === null ? null : endpoint(accountApi);
  // CSS may be mounted below a prefix. Its account index is one level below its issuer.
  const directory = api === null ? null : new URL(`${api.href.replace(/\/+$/, "")}/`);
  const issuer = directory === null ? null : new URL("../", directory).href;
  const host = options.podHost === undefined ? issuer : endpoint(options.podHost).href;
  const transport = options.fetch ?? nonReactiveFetch();
  const publicFetch = refuseRedirects(transport);
  const profileFetch = refuseRedirects(podAuth.fetch);
  let running = false;
  const previewUrls = (name: string): RegistrationPreview => {
    if (!validUsername(name)) throw new RegistrationError("invalid-username", "check");
    if (host === null) throw new RegistrationError("registration-closed", "check");
    const pod = new URL(`${name}/`, `${host.replace(/\/+$/, "")}/`).href;
    return { pod, webId: `${pod}profile/card#me` };
  };
  const control = (document: Json, group: string, key: string): string => {
    const value = object(object(document.controls)[group])[key];
    if (typeof value !== "string" || value.length === 0)
      throw new RegistrationError("registration-closed", "account");
    try {
      const url = endpoint(new URL(value, api!).href);
      if (url.origin !== api!.origin) throw new Error();
      return url.href;
    } catch {
      throw new RegistrationError("unsafe-control", "account");
    }
  };
  const json = async (
    url: string,
    token: string,
    signal: AbortSignal | undefined,
    body?: Json,
    accepted?: () => void,
    passwordEnrollment = false,
  ): Promise<Json> => {
    signal?.throwIfAborted();
    const jsonFetch = boundedDocumentFetch(async (input, init) => {
      const response = await publicFetch(input, init);
      if (response.redirected || (response.url !== "" && response.url !== url)) {
        void response.body?.cancel().catch(() => {});
        throw new RegistrationError("unsafe-control", "account");
      }
      if (response.ok) accepted?.();
      return response;
    }, insecure);
    const response = await jsonFetch(url, {
      method: body === undefined ? "GET" : "POST",
      signal,
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `CSS-Account-Token ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      // CSS 7 wraps pod-name conflicts as 400. Re-probe instead of parsing server error text.
      // The name was validated locally, so a 400 is a conflict unless the pod is visibly absent.
      if (
        response.status === 400 &&
        typeof body?.name === "string" &&
        (await checkUsername(body.name, { signal })) !== "available"
      )
        throw new RegistrationError("username-taken", "pod");
      // The local password policy already passed, so a 400 from password enrollment means the
      // derived login ID exists: the name was registered before, even if HEAD said "unknown".
      // CSS 7 needs a login method before pod creation, and removes the login-less account
      // this leaves after 30 minutes, so retries never accumulate password-bearing duplicates.
      const code =
        response.status === 409
          ? "username-taken"
          : response.status === 400 && passwordEnrollment
            ? "username-taken"
            : [403, 404, 405].includes(response.status)
              ? "registration-closed"
              : "registration-failed";
      throw new RegistrationError(code, "account");
    }
    return object(await response.json());
  };
  const checkUsername: Registration["checkUsername"] = async (name, opts) => {
    if (!validUsername(name)) return "invalid";
    try {
      opts?.signal?.throwIfAborted();
      const response = await publicFetch(previewUrls(name).pod, {
        method: "HEAD",
        credentials: "omit",
        signal: opts?.signal,
      });
      opts?.signal?.throwIfAborted();
      void response.body?.cancel().catch(() => {});
      if (response.redirected || (response.url !== "" && response.url !== previewUrls(name).pod))
        throw new Error();
      if (response.status === 404) return "available";
      if (response.ok) return "taken";
      if (response.status === 401 || response.status === 403) return "unknown";
      throw new Error();
    } catch {
      throw new RegistrationError("registration-failed", "check");
    }
  };
  return {
    methods: Object.freeze(["password"]),
    previewUrls,
    checkUsername,
    available: async (opts) => {
      if (api === null) return false;
      const document = await json(api.href, "", opts?.signal).catch(() => {
        throw new RegistrationError("registration-failed", "check");
      });
      try {
        control(document, "account", "create");
        control(document, "password", "login");
        return true;
      } catch {
        return false;
      }
    },
    register: async (request, opts = {}) => {
      if (running) throw new RegistrationError("registration-in-progress", "account");
      running = true;
      let step: RegistrationStep = "account";
      const created: RegistrationCreated = {};
      let token = "";
      let password = "";
      const enter = (next: RegistrationStep) => {
        opts.signal?.throwIfAborted();
        step = next;
        opts.onStep?.(step, Object.freeze({ ...created }));
        opts.signal?.throwIfAborted();
      };
      try {
        // Snapshot caller fields within the sanitizing boundary, before the first await.
        const { username, displayName } = request;
        password = request.password;
        opts = { signal: opts.signal, onStep: opts.onStep };
        if (api === null || issuer === null)
          throw new RegistrationError("registration-closed", step);
        const preview = previewUrls(username);
        if (
          !displayName.trim() ||
          // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls n3 can emit literally.
          /[\u0000-\u001f\u007f-\u009f]/u.test(displayName.replace(/[\n\r\t]/g, ""))
        )
          throw new RegistrationError("invalid-display-name", step);
        if (password.length < 8 || password.trim() !== password)
          throw new RegistrationError("weak-password", "password");
        if ((await checkUsername(username, opts)) === "taken")
          throw new RegistrationError("username-taken", step);
        let document = await json(api.href, "", opts.signal);
        const create = control(document, "account", "create");
        const login = control(document, "password", "login");
        enter("account");
        const account = await json(create, "", opts.signal, {}, () => {
          created.account = true;
          created.loginId = `${username}@registration.invalid`;
          created.signInHint = Object.freeze({ issuer });
        });
        token = authorization(account);
        document = await json(api.href, token, opts.signal);
        // Validate every needed scoped control before sending the password or creating a pod.
        const passwordCreate = control(document, "password", "create");
        const podCreate = control(document, "account", "pod");
        const webIdControl = control(document, "account", "webId");
        enter("password");
        await json(
          passwordCreate,
          token,
          opts.signal,
          { email: created.loginId, password },
          () => {
            created.password = true;
          },
          true,
        );
        token = authorization(
          await json(login, token, opts.signal, { email: created.loginId, password }),
        );
        password = "";
        enter("pod");
        const result = await json(podCreate, token, opts.signal, {
          name: username,
          settings: { linkStorage: true },
        });
        if (result.pod !== preview.pod) throw new RegistrationError("invalid-response", step);
        created.podUrl = preview.pod;
        if (result.webId !== preview.webId) throw new RegistrationError("invalid-response", step);
        created.webId = preview.webId;
        enter("webid");
        const links = object((await json(webIdControl, token, opts.signal)).webIdLinks);
        if (!Object.hasOwn(links, preview.webId)) {
          const linked = await json(webIdControl, token, opts.signal, { webId: preview.webId });
          if (linked.webId !== preview.webId || linked.oidcIssuer !== issuer)
            throw new RegistrationError("invalid-response", step);
        }
        // Discard account authorization before interactive OIDC. It never enters the browser jar.
        token = "";
        enter("profile");
        const signedIn = await podAuth.login({ issuer }, { signal: opts.signal });
        if (signedIn.webId !== preview.webId || signedIn.issuer !== issuer)
          throw new RegistrationError("identity-mismatch", step);
        opts.signal?.throwIfAborted();
        const dataset = new Store();
        const person = new TermWrapper(preview.webId, dataset, DataFactory);
        for (const predicate of [
          "http://xmlns.com/foaf/0.1/name",
          "http://www.w3.org/2006/vcard/ns#fn",
        ])
          SetFrom.subjectPredicate(person, predicate, LiteralAs.string, LiteralFrom.string).add(
            displayName,
          );
        // INSERT preserves the server's issuer/storage/ACL assertions. All RDF comes from n3.
        const response = await profileFetch(preview.webId.split("#")[0]!, {
          method: "PATCH",
          signal: opts.signal,
          credentials: "omit",
          headers: { "content-type": "application/sparql-update" },
          body: `INSERT DATA {\n${new Writer({ format: "N-Triples" }).quadsToString([...dataset])}\n}`,
        });
        void response.body?.cancel().catch(() => {});
        if (
          !response.ok ||
          response.redirected ||
          (response.url !== "" && response.url !== preview.webId.split("#")[0])
        )
          throw new RegistrationError("registration-failed", step);
        created.profile = true;
        enter("sign-in");
        const identity = await podAuth.login({ issuer }, { signal: opts.signal });
        opts.signal?.throwIfAborted();
        if (identity.webId !== preview.webId || identity.issuer !== issuer)
          throw new RegistrationError("identity-mismatch", step);
        return identity;
      } catch (error) {
        throw new RegistrationError(
          error instanceof RegistrationError ? error.code : "registration-failed",
          error instanceof RegistrationError && error.code === "weak-password" ? "password" : step,
          created,
        );
      } finally {
        token = "";
        password = "";
        running = false;
      }
    },
  };
}

function authorization(document: Json): string {
  const value = document.authorization;
  if (typeof value !== "string" || value.length === 0 || /[^\w-]/u.test(value))
    throw new RegistrationError("invalid-response", "account");
  return value;
}
