// AUTHORED-BY Claude Opus 5.5
// Learn one session liveness read from the demonstration: never a guessed or unwitnessed URL,
// and only one whose anonymous replay was refused for lack of authentication.
import {
  type AuthenticationRefusal,
  authenticationRefusal,
  compileOperation,
  createApprovalGate,
  type EffectVerification,
  type Gate,
  guardUrl,
  isHtmlInputType,
  type LivenessRead,
  livenessSignature,
  matchesLivenessSignature,
  requiresEffectVerification,
  sentInputValue,
} from "@jeswr/site-executor";
import { type Operation, SCHEMA, selectionWitnesses } from "@jeswr/site-model";
import { parseHtml, selectAll } from "./html.js";
import { matchRequest } from "./templates.js";
import type { RecordedRequest } from "./types.js";
import { isDangerousLink, sab } from "./util.js";
import type { Replayer } from "./verify.js";
import { learnEffectVerification } from "./write-effect.js";

/** At most this many ranked candidates per deletion are replayed anonymously by the profiler. */
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
 * Login routes learned from the profiling session: the login operation's endpoint, the URL the
 * sign-in form was posted to, and every page served during sign-in that carried a password form.
 * Each is a same-origin origin-plus-path; a refusal redirect must lead to one of them.
 */
export function learnedLoginRoutes(
  operations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): string[] {
  const routes = new Set<string>();
  const add = (href: string) => {
    try {
      const url = new URL(href);
      if (url.origin === origin && !isDangerousLink(url.href))
        routes.add(url.origin + url.pathname);
    } catch {
      /* Not a URL: no route. */
    }
  };
  for (const op of operations)
    if (op.actionType === sab("LoginAction") && !op.request.urlTemplate.includes("{"))
      add(op.request.urlTemplate);
  for (const r of trace) {
    if (r.phase !== "login" || r.blocked) continue;
    if (r.method === "POST") add(r.url);
    else if (
      r.method === "GET" &&
      r.status !== undefined &&
      r.status >= 200 &&
      r.status < 300 &&
      /html/i.test(r.contentType ?? "") &&
      r.bodySample &&
      selectAll(parseHtml(r.bodySample), "input").some((el) => isHtmlInputType(el, "password"))
    )
      add(r.url);
  }
  return [...routes].sort().slice(0, 16);
}

/** Anonymous replays (no credentials, no cookies) of exactly this URL recorded in the trace. */
function anonymousReplays(trace: readonly RecordedRequest[], url: string): RecordedRequest[] {
  return trace.filter(
    (r) =>
      r.resourceType === "replay-anonymous" &&
      r.method === "GET" &&
      !r.blocked &&
      exactUrl(r.url) === url,
  );
}

/**
 * The refusal witnessed for a candidate: at least one anonymous replay of the exact bound URL,
 * every one an authentication refusal that fails the liveness signature. A replay that timed
 * out or failed is never recorded with a status, so it is no evidence.
 */
function anonymousRefusal(
  trace: readonly RecordedRequest[],
  candidate: LivenessCandidate,
  loginRoutes: readonly string[],
  origin: string,
): AuthenticationRefusal | undefined {
  const replays = anonymousReplays(trace, candidate.url);
  let refusal: AuthenticationRefusal | undefined;
  for (const r of replays) {
    const redirect = r.status !== undefined && r.status >= 300 && r.status < 400;
    if (r.status === undefined || (r.bodyTruncated && !redirect)) return;
    const body = r.bodySample ?? "";
    const kind = authenticationRefusal(
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
 * Ranked liveness candidates for a not-found deletion: signed-in, read-gated GETs witnessed in
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
 * The liveness read for a not-found deletion: the best-ranked candidate whose exact bound URL
 * the trace holds an anonymous replay of, refused for lack of authentication (a redirect to a
 * learned login route, a 401/403 with WWW-Authenticate or authentication wording, or a login
 * page) without reproducing the liveness signature. A read that renders for anonymous visitors,
 * an anonymous replay that timed out or failed, a plain 403/5xx, a non-login redirect, or a read
 * restored without any anonymous evidence never qualifies.
 */
export function learnLivenessRead(
  operation: Operation,
  verification: EffectVerification,
  operations: readonly Operation[],
  learnedOperations: readonly Operation[],
  trace: readonly RecordedRequest[],
  origin: string,
): LivenessRead | undefined {
  const loginRoutes = learnedLoginRoutes(operations, trace, origin);
  for (const candidate of livenessCandidates(
    operation,
    verification,
    operations,
    learnedOperations,
    trace,
    origin,
  )) {
    const refusal = anonymousRefusal(trace, candidate, loginRoutes, origin);
    if (refusal)
      return {
        ...candidate.read,
        anonymous: { refusal, loginRoutes },
      };
  }
  return;
}

/**
 * Replay the best liveness candidates of each not-found deletion once without credentials or
 * cookies, so the trace holds the anonymous evidence learning needs. Only witnessed, read-gated
 * GETs are sent: each URL is authorized through the gate before anything is transmitted, and a
 * URL already replayed anonymously is not sent again.
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
    if (!verification?.notFound) continue;
    const candidates = livenessCandidates(
      operation,
      verification,
      operations,
      learnedOperations,
      trace,
      origin,
    );
    for (const candidate of candidates.slice(0, ANONYMOUS_PROBES)) {
      if (probed.has(candidate.url) || anonymousReplays(trace, candidate.url).length) continue;
      probed.add(candidate.url);
      const read = candidate.operation;
      const authorize = async (url: string) => {
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
          summary: `Check that ${guarded.host} refuses a signed-in read without the session`,
          digest: JSON.stringify([read.id, guarded.href, candidate.values, "anonymous"]),
        });
        if (decision.kind !== "allow") throw new Error("Anonymous liveness read denied");
      };
      try {
        await authorize(candidate.url);
      } catch {
        continue;
      }
      await replayer
        .get(candidate.url, {
          signedIn: false,
          headers: {
            ...read.request.headers,
            accept: candidate.extraction.format === "json" ? "application/json" : "text/html",
            "cache-control": "no-cache",
            pragma: "no-cache",
          },
          authorize,
        })
        .catch(() => undefined);
    }
  }
}
