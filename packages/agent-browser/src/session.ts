// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import {
  type CookieSecretContext,
  cookiesFor,
  createApprovalGate,
  createExecutor,
  type ExecutorOptions,
  registerCookieSecrets,
  registerSecret,
  type SessionProvider,
  secretRedactor,
  siteOrigin,
} from "@jeswr/site-executor";
import { type ActionRequest, type Operation, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { rememberSessionHeader } from "./fallback/redact.js";
import type { TaskExecutor } from "./types.js";

export type CredentialContext = NonNullable<ExecutorOptions["credentialContext"]> & {
  secrets: Set<string>;
};

const secrets = new WeakMap<SessionProvider, Map<string, CredentialContext>>();

/** One host-only context per site/persona, shared by login, learning, replay and rebuilds. */
export function taskCredentialContext(options: {
  sessions: SessionProvider;
  site: string;
  persona?: string;
  model?: CookieSecretContext["model"];
  cookieContext?: CookieSecretContext;
  credentialContext?: ExecutorOptions["credentialContext"];
}): CredentialContext {
  const { sessions, site, persona } = options;
  let store = secrets.get(sessions);
  if (!store) {
    store = new Map();
    secrets.set(sessions, store);
  }
  const key = JSON.stringify([siteOrigin(site), persona ?? null]);
  let values = store.get(key);
  if (!values) {
    values = { secrets: options.credentialContext?.secrets ?? new Set() };
    store.set(key, values);
  }
  for (const context of [
    { model: options.model },
    options.cookieContext,
    options.credentialContext,
  ]) {
    values.declaredNames = [
      ...new Set([
        ...(values.declaredNames ?? []),
        ...(context?.declaredNames ?? []),
        ...(context?.model?.login?.flatMap((r) => r.sessionCookies ?? []) ?? []),
        ...(context?.model?.operations.flatMap(
          (o) => o.csrf?.flatMap((r) => (r.source.kind === "cookie" ? [r.source.name] : [])) ?? [],
        ) ?? []),
      ]),
    ];
    // The control's drop list: declared credentials and login session cookies, never the CSRF
    // cookie sources above, which stay in the redaction union only (round 22).
    values.credentialCookieNames = [
      ...new Set([
        ...(values.credentialCookieNames ?? []),
        ...(context?.credentialCookieNames ?? []),
        ...(context?.model?.login?.flatMap((r) => r.sessionCookies ?? []) ?? []),
      ]),
    ];
    values.loginCookieNames = [
      ...new Set([...(values.loginCookieNames ?? []), ...(context?.loginCookieNames ?? [])]),
    ];
  }
  for (const value of options.credentialContext?.secrets ?? [])
    registerSecret(values.secrets, value);
  return values;
}

function redact(values: Set<string>, text: string): string {
  return secretRedactor(values)(text);
}

function cookieContext(
  model: SiteModel,
  context: CookieSecretContext | undefined,
  declaredNames: readonly string[] = [],
): CookieSecretContext {
  return {
    ...context,
    model,
    declaredNames: [...(context?.declaredNames ?? []), ...declaredNames],
  };
}

export interface ExecutorFetchOptions {
  model: SiteModel;
  cookieContext?: CookieSecretContext;
  credentialContext?: ExecutorOptions["credentialContext"];
  sessions: SessionProvider;
  persona?: string;
  fetch?: ExecutorOptions["fetch"];
}

/** Host-only executor transport configuration; it never exposes an HTTP response to a planner. */
export type ExecutorFetch = Readonly<ExecutorFetchOptions & { site: string }>;

export function createExecutorFetch(options: ExecutorFetchOptions): ExecutorFetch {
  const site = siteOrigin(options.model.site);
  const credentialContext = taskCredentialContext({ ...options, site });
  return Object.freeze({ ...options, site, credentialContext });
}

/** Submit the learned login operation through the existing compiler, CSRF logic and cookie jar. */
export async function loginWithPassword(
  model: SiteModel,
  executorFetch: ExecutorFetch,
  credentials: { username: string; password: string },
): Promise<void> {
  const context = taskCredentialContext({ ...executorFetch, site: model.site });
  const values = context.secrets;
  registerSecret(values, credentials.password);
  const route = model.login?.find((r) => r.method === "password" && r.operation);
  const operation = model.operations.find((o) => o.id === route?.operation);
  if (!route || !operation) throw new Error("Model has no password login operation.");
  if (executorFetch.site !== siteOrigin(model.site))
    throw new Error("Login transport belongs to another site.");
  try {
    const inputs = new Map<string, string>();
    const credentialPath = (name: string) =>
      `urn:agent-browser:credential:${encodeURIComponent(name)}`;
    const op: Operation = {
      ...operation,
      extraction: undefined,
      inputs: operation.inputs.map((p) => {
        const path = credentialPath(p.name);
        if (/pass(word|wd)?/i.test(p.name)) inputs.set(path, credentials.password);
        else if (/user(name)?|email|login/i.test(p.name)) inputs.set(path, credentials.username);
        return { ...p, path: [path] };
      }),
    };
    // A private one-operation model gives empty credential paths a host-only binding.
    // Neither this model nor the in-memory request is rendered or passed to runTask.
    const hostModel = { ...model, operations: [op], flows: [], login: [route] };
    let loginGranted = false;
    const executor = createExecutor({
      ...executorFetch,
      credentialContext: context,
      model: hostModel,
      // Calling this host-only API authorizes this single learned login. Credentials
      // stay registered for extraction redaction and never become approval fields.
      gate: {
        async authorize(request) {
          if (request.effect === "read") return { kind: "allow" };
          if (!loginGranted && request.site === executorFetch.site && request.target.id === op.id) {
            loginGranted = true;
            return { kind: "allow" };
          }
          return { kind: "deny", reason: "Host login grant already consumed." };
        },
      },
    });
    const request: ActionRequest = {
      node: "urn:agent-browser:login",
      types: [op.actionType],
      values: (path) => {
        const value = inputs.get(path[0] ?? "");
        return value === undefined ? [] : [value];
      },
    };
    const result = await executor.execute(request);
    // Verify sign-in independently after an uncertain login redirect. Never replay
    // the POST or manufacture a created identity from the landing page.
    const uncertain = result.outcome?.status === "uncertain" && result.committed.length === 1;
    if (result.status !== "done" && !(uncertain && route.probeUrl)) throw new Error();
    const bundle = await executorFetch.sessions.get(executorFetch.site, executorFetch.persona);
    for (const c of bundle?.cookies ?? [])
      registerCookieSecrets(values, c, cookieContext(model, context, bundle?.credentialCookies));
    const cookies = cookiesFor(
      bundle?.cookies ?? [],
      new URL(route.probeUrl ?? model.site),
      new Date(),
    );
    if (!route.sessionCookies?.some((name) => cookies.some((c) => c.name === name)))
      throw new Error();
    if (route.probeUrl) {
      const probe: Operation = {
        ...op,
        id: `${op.id}-probe`,
        actionType: `${SCHEMA}ViewAction`,
        inputs: [],
        request: { method: "GET", urlTemplate: route.probeUrl },
        csrf: undefined,
        effect: "read",
        session: "signed-in",
      };
      const verifier = createExecutor({
        ...executorFetch,
        credentialContext: context,
        model: { ...hostModel, operations: [probe], login: undefined },
      });
      const checked = await verifier.execute({
        node: "urn:agent-browser:probe",
        types: [probe.actionType],
        values: () => [],
      });
      if (checked.status !== "done") throw new Error();
    }
  } catch {
    throw new Error("Password login failed; check credentials and the learned login route.");
  }
}

/** Expose the existing gate's decision methods without changing the executor contract. */
export function createTaskExecutor(
  options: Omit<ExecutorOptions, "gate"> & Pick<ExecutorFetchOptions, "cookieContext">,
): TaskExecutor {
  const gate = createApprovalGate();
  const credentialContext = taskCredentialContext({ ...options, site: options.model.site });
  const executor = createExecutor({ ...options, credentialContext, gate });
  const values = credentialContext.secrets;
  return {
    ...executor,
    approve: gate.approve,
    reject: gate.reject,
    redact: (text) => redact(values, text),
    withModel: (model, context = credentialContext) =>
      createTaskExecutor({ ...options, credentialContext: context, model }),
    async execute(request, opts) {
      const remember = async () => {
        const bundle = await options.sessions.get(siteOrigin(options.model.site), options.persona);
        for (const c of bundle?.cookies ?? [])
          registerCookieSecrets(
            values,
            c,
            cookieContext(options.model, credentialContext, bundle?.credentialCookies),
          );
        for (const v of Object.values(bundle?.headers ?? {})) {
          rememberSessionHeader(values, v);
        }
      };
      await remember();
      const result = await executor.execute(request, opts);
      try {
        await remember();
      } catch {
        return { ...result, refreshError: "Session secret refresh failed after execution." };
      }
      return result;
    },
  };
}
