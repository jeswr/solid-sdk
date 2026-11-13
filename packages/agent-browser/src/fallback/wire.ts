// AUTHORED-BY Codex GPT-6.1-Sol
import {
  clusterRequests,
  type EndpointCandidate,
  type FormInfo,
  formCsrfRules,
  type RecordedRequest,
  type SessionTokens,
} from "@jeswr/site-profiler";

/** Form evidence can type a transmitted field or locate CSRF, never add a wire field/default. */
export function wireCandidates(
  requests: RecordedRequest[],
  origin: string,
  forms: FormInfo[],
  tokens: SessionTokens,
): EndpointCandidate[] {
  return clusterRequests(requests, origin, new Set(), tokens).map((candidate) => {
    const form = forms.find((f) =>
      candidate.samples.some((r) => {
        const action = new URL(f.action);
        const url = new URL(r.url);
        return (
          f.method === r.method && action.origin === url.origin && action.pathname === url.pathname
        );
      }),
    );
    if (!form) return candidate;
    const names = new Set(candidate.params.map((p) => decodeURIComponent(p.name)));
    candidate.form = { ...form, fields: form.fields.filter((f) => names.has(f.name)) };
    candidate.sources.push("form");
    candidate.params = candidate.params.map((p) => {
      const field = form.fields.find((f) => f.name === decodeURIComponent(p.name));
      return field ? { ...p, formType: field.type } : p;
    });
    for (const rule of formCsrfRules(form, form.pageUrl))
      if (
        names.has(rule.target.name) &&
        !candidate.csrf.some(
          (r) => r.target.kind === rule.target.kind && r.target.name === rule.target.name,
        )
      )
        candidate.csrf.push(rule);
    return candidate;
  });
}
