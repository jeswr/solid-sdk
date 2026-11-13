// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import {
  cookiesFor,
  createApprovalGate,
  createExecutor,
  type ExecutorOptions,
  type SessionProvider,
  secretRedactor,
  siteOrigin,
} from "@jeswr/site-executor";
import { type ActionRequest, type Operation, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { rememberSessionHeader } from "./fallback/redact.js";
import type { TaskExecutor } from "./types.js";

const secrets = new WeakMap<SessionProvider, Map<string, Set<string>>>();

function secretSet(sessions: SessionProvider, site: string, persona?: string): Set<string> {
  let store = secrets.get(sessions);
  if (!store) {
    store = new Map();
    secrets.set(sessions, store);
  }
  const key = JSON.stringify([siteOrigin(site), persona ?? null]);
  let values = store.get(key);
  if (!values) {
    values = new Set();
    store.set(key, values);
  }
  return values;
}

function redact(values: Set<string>, text: string): string {
  return secretRedactor(values)(text);
}

export interface ExecutorFetchOptions {
  model: SiteModel;
  sessions: SessionProvider;
  persona?: string;
  fetch?: ExecutorOptions["fetch"];
}

/** Host-only executor transport configuration; it never exposes an HTTP response to a planner. */
export type ExecutorFetch = Readonly<ExecutorFetchOptions & { site: string }>;

export function createExecutorFetch(options: ExecutorFetchOptions): ExecutorFetch {
  return Object.freeze({ ...options, site: siteOrigin(options.model.site) });
}

/** Submit the learned login operation through the existing compiler, CSRF logic and cookie jar. */
export async function loginWithPassword(
  model: SiteModel,
  executorFetch: ExecutorFetch,
  credentials: { username: string; password: string },
): Promise<void> {
  const values = secretSet(executorFetch.sessions, model.site, executorFetch.persona);
  values.add(credentials.password);
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
    const hostModel = { ...model, operations: [op], flows: [], login: undefined };
    const gate = createApprovalGate();
    const executor = createExecutor({ ...executorFetch, model: hostModel, gate });
    const request: ActionRequest = {
      node: "urn:agent-browser:login",
      types: [op.actionType],
      values: (path) => {
        const value = inputs.get(path[0] ?? "");
        return value === undefined ? [] : [value];
      },
    };
    let result = await executor.execute(request);
    if (result.status === "needs-approval" && result.approval) {
      // Calling loginWithPassword is the host's explicit authority for this single login operation.
      gate.approve(result.approval.id);
      result = await executor.execute(request, { approvalId: result.approval.id });
    }
    // Verify sign-in independently after an uncertain login redirect. Never replay
    // the POST or manufacture a created identity from the landing page.
    const uncertain = result.outcome?.status === "uncertain" && result.committed.length === 1;
    if (result.status !== "done" && !(uncertain && route.probeUrl)) throw new Error();
    const bundle = await executorFetch.sessions.get(executorFetch.site, executorFetch.persona);
    for (const c of bundle?.cookies ?? []) values.add(c.value);
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
        model: { ...hostModel, operations: [probe] },
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
export function createTaskExecutor(options: Omit<ExecutorOptions, "gate">): TaskExecutor {
  const gate = createApprovalGate();
  const executor = createExecutor({ ...options, gate });
  const values = secretSet(options.sessions, options.model.site, options.persona);
  return {
    ...executor,
    approve: gate.approve,
    reject: gate.reject,
    redact: (text) => redact(values, text),
    async execute(request, opts) {
      const remember = async () => {
        const bundle = await options.sessions.get(siteOrigin(options.model.site), options.persona);
        for (const c of bundle?.cookies ?? []) values.add(c.value);
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
