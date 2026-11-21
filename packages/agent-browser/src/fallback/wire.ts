// AUTHORED-BY Codex GPT-6.1-Sol

import type { Operation } from "@jeswr/site-model";
import {
  buildOperation,
  clusterRequests,
  type EndpointCandidate,
  type FormInfo,
  formCsrfRules,
  type Label,
  type OperationContext,
  type RecordedRequest,
  requestValues,
  type SessionTokens,
} from "@jeswr/site-profiler";

/** Each candidate describes one wire request. Forms may locate CSRF, never type inputs. */
export function wireCandidates(
  requests: RecordedRequest[],
  origin: string,
  forms: FormInfo[],
  tokens: SessionTokens,
): EndpointCandidate[] {
  return requests
    .filter((request) => {
      const inventory = requestValues(request);
      const names = [
        ...inventory.query.map(([name]) => name),
        ...inventory.body.map(([name]) => name),
      ];
      // The scalar-input contract cannot represent repeated wire fields without losing values.
      return new Set(names).size === names.length;
    })
    .flatMap((request) => clusterRequests([request], origin, new Set(), tokens))
    .map((candidate) => {
      const form = forms.find((f) =>
        candidate.samples.some((r) => {
          const action = new URL(f.action);
          const url = new URL(r.url);
          return (
            f.method === r.method &&
            action.origin === url.origin &&
            action.pathname === url.pathname
          );
        }),
      );
      if (!form) return candidate;
      const names = new Set(candidate.params.map((p) => decodeURIComponent(p.name)));
      candidate.form = { ...form, fields: form.fields.filter((f) => names.has(f.name)) };
      candidate.sources.push("form");
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

/** Shared by pre-dispatch fingerprinting and learning, over the same wire candidate. */
export function buildWireOperation(
  candidate: EndpointCandidate,
  label: Label,
  context: OperationContext,
): Operation {
  const operation = buildOperation(candidate, label, context);
  for (const input of operation.inputs) {
    const parameter = candidate.params.find((p) => p.name === input.name);
    // Empty/non-numeric strings must survive even when the semantic name suggests a number.
    if (
      parameter?.jsonType === "string" &&
      parameter.examples.some((v) => !/^-?\d+(?:\.\d+)?$/.test(v)) &&
      /#(?:integer|decimal)$/.test(input.range)
    )
      input.range = "http://www.w3.org/2001/XMLSchema#string";
    if (label.effect !== "read") {
      delete input.example;
      delete input.default;
      input.required = true;
    }
  }
  return operation;
}
