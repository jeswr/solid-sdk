// AUTHORED-BY Claude Opus 5.5
// Learn one session liveness read from the demonstration: never a guessed or unwitnessed URL,
// and only one whose credentials-only control replay was refused for lack of authentication.
import {
  compileOperation,
  createApprovalGate,
  type EffectVerification,
  type Gate,
  guardUrl,
  isHtmlInputType,
  isLoginDocument,
  type LivenessRead,
  livenessSignature,
  matchesLivenessSignature,
  type RefusalEvidence,
  refusalEvidence,
  refusalTarget,
  requiresEffectVerification,
  sentInputValue,
  type VerifiedLoginRoute,
} from "@jeswr/site-executor";
import { type Operation, SCHEMA, selectionWitnesses } from "@jeswr/site-model";
import { attr, parseHtml, selectAll } from "./html.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { isDangerousLink, sab } from "./util.js";
import type { Replayer } from "./verify.js";
import { learnEffectVerification } from "./write-effect.js";

/** At most this many ranked candidates per deletion are replayed as controls by the profiler. */
const ANONYMOUS_PROBES = 3;

const identityProperties = ["object", "identifier", "sku", "productID", "orderNumber"].map(
  (key) => `${SCHEMA}${key}`,
);

/** Identities removed by any demonstrated deletion; a liveness read must not address them. */
function deletedIdentities(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): Set<string> {
  const out = new Set<string>();
  for (const op of operations) {
    if (op.actionType !== `${SCHEMA}DeleteAction`) continue;
    const identities = [
      ...selectionWitnesses(op),
      ...op.inputs.filter(
        (p) => p.path[0] === `${SCHEMA}object` && identityProperties.includes(p.path.at(-1) ?? ""),
      ),
    ];
    for (const write of trace) {
      if (write.phase !== "demonstration" || write.blocked) continue;
      const values = matchRequest(op.request, write);
      if (!values) continue;
      for (const p of identities) {
        const value = values[p.name] ?? sentInputValue(op, values, p.name, origin);
        if (value) out.add(value);
      }
    }
  }
  return out;
}

function sameUrl(a: URL, b: URL): boolean {
  const query = (url: URL) => JSON.stringify([...url.searchParams].sort());
  return a.origin === b.origin && a.pathname === b.pathname && query(a) === query(b);
}

/** The exact URL a request was sent to, without its fragment. */
function exactUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return;
  }
}

/**
 * Login routes learned narrowly from the profiling session: the login operation's endpoint, the
 * URL of each sign-in page that is a login document (its password form is the page's content,
 * not a quick-login box beside item rows or a main listing), and the action target of that
 * page's password form when the sign-in posted to it. Each is a same-origin origin-plus-path;
 * a refusal redirect or login envelope must lead to one of them.
 */
export function learnedLoginRoutes(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): string[] {
  const routes = new Set<string>();
  const route = (href: string, base?: string) => {
    try {
      const url = new URL(href, base);
      if (url.origin !== origin || isDangerousLink(url.href)) return;
      return url.origin + url.pathname;
    } catch {
      return;
    }
  };
  const add = (href: string, base?: string) => {
    const found = route(href, base);
    if (found) routes.add(found);
  };
  for (const op of operations)
    if (op.actionType === sab("LoginAction") && !op.request.urlTemplate.includes("{"))
      add(op.request.urlTemplate);
  const signIn = trace.filter((r) => r.phase === "login" && !r.blocked);
  const targets = new Set<string>();
  for (const r of signIn) {
    if (
      r.method !== "GET" ||
      r.status === undefined ||
      r.status < 200 ||
      r.status >= 300 ||
      !/html/i.test(r.contentType ?? "") ||
      !r.bodySample ||
      r.bodyTruncated ||
      !isLoginDocument(r.bodySample, r.url)
    )
      continue;
    add(r.url);
    for (const form of selectAll(parseHtml(r.bodySample), "form")) {
      if (!selectAll(form, "input").some((el) => isHtmlInputType(el, "password"))) continue;
      const action = attr(form, "action")?.trim();
      const target = route(action || r.url, r.url);
      if (target) targets.add(target);
    }
  }
  for (const r of signIn) {
    const target = r.method === "POST" ? route(r.url) : undefined;
    if (target && targets.has(target)) routes.add(target);
  }
  return [...routes].sort().slice(0, 16);
}

/**
 * Credentials-only control replays of exactly this URL recorded in the trace: the signed-in
 * context's cookies minus the session credentials. A plain cookieless replay (verification's
 * signed-out replay) is never evidence, because a gate on a non-credential cookie answers it
 * differently from an expired session that still holds that cookie.
 */
function controlReplays(trace: readonly RecordedRequest[], url: string): RecordedRequest[] {
  return trace.filter(
    (r) =>
      r.resourceType === "replay-anonymous" &&
      r.credentialsOnlyControl === true &&
      !r.loginRouteProbe &&
      r.method === "GET" &&
      !r.blocked &&
      exactUrl(r.url) === url,
  );
}

/** Origin plus path of a same-origin, non-dangerous URL. */
function routeOf(href: string, origin: string, base?: string): string | undefined {
  try {
    const url = new URL(href, base);
    return url.origin === origin && !isDangerousLink(url.href)
      ? url.origin + url.pathname
      : undefined;
  } catch {
    return;
  }
}

/** A complete 2xx HTML answer that is a login document. */
function loginDocumentAnswer(r: RecordedRequest, routes: readonly string[], origin: string) {
  return (
    r.status !== undefined &&
    r.status >= 200 &&
    r.status < 300 &&
    /html/i.test(r.contentType ?? "") &&
    !r.bodyTruncated &&
    !!r.bodySample &&
    isLoginDocument(r.bodySample, r.url, routes, origin)
  );
}

/**
 * Login routes verified from refusal redirect targets (decision 5): the profiler fetched the
 * exact target URL as a credentials-only control and every such fetch answered a login
 * document, or redirected once, on the same origin, to an already-learned login route whose
 * fetched answer (every one) was a login document. A target that served anything else, or was
 * never fetched, stays unverified.
 */
export function verifiedLoginRoutes(
  trace: readonly RecordedRequest[],
  origin: string,
  learned: readonly string[],
): VerifiedLoginRoute[] {
  const probes = trace.filter(
    (r) =>
      r.resourceType === "replay-anonymous" &&
      r.credentialsOnlyControl === true &&
      r.loginRouteProbe === true &&
      r.method === "GET" &&
      !r.blocked,
  );
  const targets = new Map<string, RecordedRequest[]>();
  for (const r of probes) {
    if (r.loginRouteHopOf !== undefined) continue;
    const url = exactUrl(r.url);
    if (url) targets.set(url, [...(targets.get(url) ?? []), r]);
  }
  const out: VerifiedLoginRoute[] = [];
  for (const [url, fetched] of targets) {
    const route = routeOf(url, origin);
    if (!route || learned.includes(route)) continue;
    let via: string | undefined;
    const ok = fetched.every((r) => {
      if (loginDocumentAnswer(r, learned, origin)) return true;
      if (r.status === undefined || r.status < 300 || r.status >= 400 || !r.redirectedTo)
        return false;
      const hop = exactUrl(r.redirectedTo);
      const hopRoute = hop ? routeOf(hop, origin) : undefined;
      if (!hop || !hopRoute || hopRoute === route || !learned.includes(hopRoute)) return false;
      if (via !== undefined && via !== hop) return false;
      const answers = probes.filter((q) => q.loginRouteHopOf === url && exactUrl(q.url) === hop);
      if (!answers.length || !answers.every((q) => loginDocumentAnswer(q, learned, origin)))
        return false;
      via = hop;
      return true;
    });
    if (ok) out.push({ route, url, ...(via !== undefined ? { via } : {}) });
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

/** The sign-in routes plus the verified redirect-target routes, with their evidence. */
function livenessLoginRoutes(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): { loginRoutes: string[]; verifiedRoutes: VerifiedLoginRoute[] } {
  const learned = learnedLoginRoutes(operations, trace, origin);
  const verified = verifiedLoginRoutes(trace, origin, learned);
  const loginRoutes = [...new Set([...learned, ...verified.map((v) => v.route)])]
    .sort()
    .slice(0, 16);
  return {
    loginRoutes,
    verifiedRoutes: verified.filter((v) => loginRoutes.includes(v.route)),
  };
}

/**
 * The refusal witnessed for a candidate: at least one credentials-only control replay of the
 * exact bound URL, every one an authentication refusal of the same kind (and, for a redirect or
 * login envelope, the same login route) that fails the liveness signature. A replay that timed
 * out or failed is never recorded with a status, so it is no evidence.
 */
function controlRefusal(
  trace: readonly RecordedRequest[],
  candidate: LivenessCandidate,
  loginRoutes: readonly string[],
  origin: string,
): RefusalEvidence | undefined {
  const replays = controlReplays(trace, candidate.url);
  let refusal: RefusalEvidence | undefined;
  for (const r of replays) {
    const redirect = r.status !== undefined && r.status >= 300 && r.status < 400;
    if (r.status === undefined || (r.bodyTruncated && !redirect)) return;
    const body = r.bodySample ?? "";
    const kind = refusalEvidence(
      {
        url: r.url,
        status: r.status,
        ...(r.contentType !== undefined ? { contentType: r.contentType } : {}),
        body,
        ...(r.redirectedTo !== undefined ? { location: r.redirectedTo } : {}),
        challenge: r.authenticationChallenge === true,
      },
      loginRoutes,
      origin,
    );
    if (
      !kind ||
      (refusal && (refusal.kind !== kind.kind || refusal.route !== kind.route)) ||
      matchesLivenessSignature(
        candidate.read.signature,
        r.status,
        r.contentType,
        body,
        candidate.extraction,
      )
    )
      return;
    refusal ??= kind;
  }
  return refusal;
}

interface LivenessCandidate {
  read: Omit<LivenessRead, "anonymous">;
  operation: Operation;
  extraction: NonNullable<Operation["extraction"]>;
  /** The exact compiled URL of the bound read. */
  url: string;
  values: Record<string, string>;
  rank: number[];
}

/**
 * Ranked liveness candidates for a deletion (not-found or collection absence): signed-in, read-gated GETs witnessed in
 * the deletion's authentication context, returning success with at least one item-level field
 * and no failure or authentication marker. Collection reads are preferred, then reads with
 * fewer inputs, then the earliest witness. Inputs are the witnessed constants only, a candidate
 * never addresses an identity deleted by the demonstration, and a token-decorated read (one
 * with CSRF rules) is never a candidate because it cannot be replayed anonymously as the same
 * read.
 */
export function livenessCandidates(
  operation: Operation,
  verification: EffectVerification,
  operations: readonly Operation[],
  learnedOperations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): LivenessCandidate[] {
  const writes = trace.filter(
    (r) => r.phase === "demonstration" && !r.blocked && matchRequest(operation.request, r),
  );
  const context = writes[0]?.authenticationContext;
  if (!context || writes.some((w) => w.authenticationContext !== context)) return [];
  const deleted = deletedIdentities(operations, trace, origin);
  for (const write of writes) {
    const value = sentInputValue(
      operation,
      matchRequest(operation.request, write) ?? {},
      verification.identityInput,
      origin,
    );
    if (value) deleted.add(value);
  }
  const candidates: LivenessCandidate[] = [];
  const seen = new Set<string>();
  for (const read of learnedOperations) {
    const extraction = read.extraction;
    if (
      read.effect !== "read" ||
      read.request.method !== "GET" ||
      read.session !== "signed-in" ||
      read.csrf?.length ||
      !extraction
    )
      continue;
    for (const sample of trace) {
      if (
        sample.phase !== "demonstration" ||
        sample.blocked ||
        sample.method !== "GET" ||
        sample.authenticationContext !== context ||
        sample.status === undefined ||
        sample.status < 200 ||
        sample.status >= 300 ||
        sample.redirectedTo ||
        sample.responsePageFailure === true ||
        sample.bodyTruncated ||
        !sample.bodySample
      )
        continue;
      const values = matchRequest(read.request, sample);
      if (!values) continue;
      let url: URL;
      let compiled: string | undefined;
      try {
        url = new URL(sample.url);
        if (url.origin !== origin || isDangerousLink(url.href)) continue;
        const defaults = Object.fromEntries(
          read.inputs.flatMap((p) => (p.default === undefined ? [] : [[p.name, p.default]])),
        );
        const request = compileOperation(read, { ...defaults, ...values }, origin);
        if (request.csrf.length || !sameUrl(request.url, url)) continue;
        compiled = exactUrl(request.url.href);
      } catch {
        continue;
      }
      if (!compiled) continue;
      if (read.inputs.some((p) => p.required && values[p.name] === undefined && !p.default))
        continue;
      const addressed = [
        ...url.pathname.split("/").map((part) => {
          try {
            return decodeURIComponent(part);
          } catch {
            return part;
          }
        }),
        ...url.searchParams.values(),
        ...Object.values(values),
      ];
      if (addressed.some((part) => deleted.has(part))) continue;
      const signature = livenessSignature(
        sample.status,
        sample.contentType,
        sample.bodySample,
        extraction,
      );
      if (!signature) continue;
      const bind: LivenessRead["bind"] = {};
      for (const p of read.inputs)
        if (values[p.name] !== undefined) bind[p.name] = { value: values[p.name] as string };
      const key = JSON.stringify([read.id, compiled, signature]);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        read: { operation: read.id, bind, signature },
        operation: read,
        extraction,
        url: compiled,
        values,
        rank: [extraction.itemPath !== undefined ? 0 : 1, Object.keys(bind).length, sample.seq],
      });
    }
  }
  return candidates.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const diff = (a.rank[i] ?? 0) - (b.rank[i] ?? 0);
      if (diff) return diff;
    }
    return 0;
  });
}

/**
 * The liveness read for a deletion: the best-ranked candidate whose exact bound URL the trace
 * holds credentials-only control replays of, every one refused for lack of authentication with
 * one kind (a redirect to a learned login route, a login JSON envelope, a 401/403 with
 * WWW-Authenticate or narrow authentication wording, or a login page) without reproducing the
 * liveness signature. The kind and route are pinned. A read that renders without the session
 * credentials, a replay that timed out or failed, a plain 403/5xx, a non-login redirect, a
 * cookieless replay, or a read restored without control evidence never qualifies.
 */
export function learnLivenessRead(
  operation: Operation,
  verification: EffectVerification,
  operations: readonly Operation[],
  learnedOperations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): LivenessRead | undefined {
  const { loginRoutes, verifiedRoutes } = livenessLoginRoutes(operations, trace, origin);
  for (const candidate of livenessCandidates(
    operation,
    verification,
    operations,
    learnedOperations,
    trace,
    origin,
  )) {
    const refusal = controlRefusal(trace, candidate, loginRoutes, origin);
    if (refusal)
      return {
        ...candidate.read,
        anonymous: {
          refusal: refusal.kind,
          loginRoutes,
          ...(refusal.route !== undefined ? { route: refusal.route } : {}),
          ...(verifiedRoutes.length ? { verifiedRoutes } : {}),
        },
      };
  }
  return;
}

/**
 * Replay the best liveness candidates of each verified deletion (not-found or collection
 * absence) once as a credentials-only control (the signed-in context's cookies minus the
 * session credentials, no session headers), so the trace holds the evidence learning needs.
 * Only witnessed, read-gated GETs are sent: each URL is authorized through the gate before
 * anything is transmitted, and a URL already replayed as a control is not sent again.
 */
export async function probeLivenessReads(
  operations: readonly Operation[],
  learnedOperations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
  replayer: Replayer,
  gate: Gate = createApprovalGate(),
): Promise<void> {
  const probed = new Set<string>();
  for (const operation of operations) {
    if (
      operation.actionType !== `${SCHEMA}DeleteAction` ||
      operation.provenance.method !== "demonstration" ||
      !requiresEffectVerification(operation)
    )
      continue;
    const verification = learnEffectVerification(operation, learnedOperations, trace, origin);
    if (!verification) continue;
    const candidates = livenessCandidates(
      operation,
      verification,
      operations,
      learnedOperations,
      trace,
      origin,
    );
    for (const candidate of candidates.slice(0, ANONYMOUS_PROBES)) {
      const read = candidate.operation;
      const authorizer = (summary: string, purpose: string) => async (url: string) => {
        const guarded = guardUrl(url, origin);
        const decision = await gate.authorize({
          site: origin,
          target: {
            kind: "operation",
            id: read.id,
            label: read.label,
            actionType: read.actionType,
          },
          effect: "read",
          inputs: candidate.values,
          summary: summary.replace("{host}", guarded.host),
          digest: JSON.stringify([read.id, guarded.href, candidate.values, purpose]),
        });
        if (decision.kind !== "allow") throw new Error("Anonymous liveness read denied");
      };
      const control = async (
        url: string,
        authorize: (url: string) => Promise<void>,
        accept: string,
        extra: Record<string, string>,
        loginRouteProbe?: { hopOf?: string },
      ) => {
        try {
          await authorize(url);
        } catch {
          return;
        }
        return replayer
          .get(url, {
            signedIn: false,
            credentialsOnly: true,
            headers: { ...extra, accept, "cache-control": "no-cache", pragma: "no-cache" },
            authorize,
            ...(loginRouteProbe ? { loginRouteProbe } : {}),
          })
          .catch(() => undefined);
      };
      if (!probed.has(candidate.url) && !controlReplays(trace, candidate.url).length) {
        probed.add(candidate.url);
        await control(
          candidate.url,
          authorizer("Check that {host} refuses a signed-in read without the session", "anonymous"),
          candidate.extraction.format === "json" ? "application/json" : "text/html",
          read.request.headers ?? {},
        );
      }
      // Decision 5: verify each refusal's redirect target that is no learned login route yet by
      // fetching it as a credentials-only control (read gate first, no redirect followed except
      // one same-origin hop to an already-learned login route).
      const learned = learnedLoginRoutes(operations, trace, origin);
      for (const replay of controlReplays(trace, candidate.url)) {
        if (replay.status === undefined) continue;
        const target = refusalTarget(
          {
            url: replay.url,
            status: replay.status,
            ...(replay.contentType !== undefined ? { contentType: replay.contentType } : {}),
            body: replay.bodySample ?? "",
            ...(replay.redirectedTo !== undefined ? { location: replay.redirectedTo } : {}),
          },
          origin,
        );
        const route = target && routeOf(target, origin);
        if (
          !target ||
          !route ||
          learned.includes(route) ||
          probed.has(`route ${target}`) ||
          trace.some((r) => r.loginRouteProbe && !r.loginRouteHopOf && exactUrl(r.url) === target)
        )
          continue;
        probed.add(`route ${target}`);
        const verify = authorizer(
          "Check that {host} serves its sign-in page at a refusal's redirect target",
          "login-route",
        );
        const answer = await control(target, verify, "text/html", {}, {});
        const hop = answer?.location && exactUrl(new URL(answer.location, target).href);
        const hopRoute = hop && routeOf(hop, origin);
        if (
          answer &&
          answer.status >= 300 &&
          answer.status < 400 &&
          hop &&
          hopRoute &&
          hopRoute !== route &&
          learned.includes(hopRoute) &&
          !probed.has(`hop ${target} ${hop}`)
        ) {
          probed.add(`hop ${target} ${hop}`);
          await control(hop, verify, "text/html", {}, { hopOf: target });
        }
      }
    }
  }
}
