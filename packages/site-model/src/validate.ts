// AUTHORED-BY Claude Opus 5.5
/** validateSiteModel: structural checks SHACL cannot express over the whole model. */
import type { Flow, Operation, Parameter, SiteModel } from "./types.js";
import { EFFECT_ORDER, effectRank } from "./vocab.js";

export interface SiteModelProblem {
  /** Where the problem is, e.g. `flows[0].steps[1].bind.sku`. */
  path: string;
  message: string;
}

const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/;
const VARIABLE = /^[A-Za-z0-9_]([A-Za-z0-9_.]|%[0-9A-Fa-f]{2})*$/;
const BODY_PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;
const STEP_REF = /^\$step(\d+)\.(.+)$/;

/**
 * The variable names an RFC 6570 template uses, or an error message when an expression is
 * malformed. Supports every level 4 operator and modifier (`{+x}`, `{?a,b*}`, `{x:3}`).
 */
export function templateVariables(template: string): { variables: string[]; error?: string } {
  const variables: string[] = [];
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf("{", index);
    const close = template.indexOf("}", index);
    if (open === -1) {
      if (close !== -1) return { variables, error: "unmatched '}'" };
      break;
    }
    if (close !== -1 && close < open) return { variables, error: "unmatched '}'" };
    const end = template.indexOf("}", open);
    if (end === -1) return { variables, error: "unclosed '{'" };
    let body = template.slice(open + 1, end);
    if (/^[+#./;?&]/.test(body)) body = body.slice(1);
    for (const spec of body.split(",")) {
      const name = spec.replace(/(\*|:[1-9][0-9]{0,3})$/, "");
      if (!VARIABLE.test(name))
        return { variables, error: `invalid expression "{${template.slice(open + 1, end)}}"` };
      variables.push(name);
    }
    index = end + 1;
  }
  return { variables };
}

function checkParameters(
  inputs: Parameter[],
  path: string,
  problem: (path: string, message: string) => void,
): Set<string> {
  const names = new Set<string>();
  inputs.forEach((p, i) => {
    if (names.has(p.name)) problem(`${path}.inputs[${i}]`, `duplicate parameter name "${p.name}"`);
    names.add(p.name);
    if (!ABSOLUTE_IRI.test(p.range))
      problem(`${path}.inputs[${i}].range`, "range must be an absolute IRI");
    p.path.forEach((step, j) => {
      if (!ABSOLUTE_IRI.test(step))
        problem(`${path}.inputs[${i}].path[${j}]`, "path steps must be absolute IRIs");
    });
    if (p.options !== undefined && p.default !== undefined && !p.options.includes(p.default)) {
      problem(`${path}.inputs[${i}].default`, `default "${p.default}" is not one of the options`);
    }
  });
  return names;
}

function checkTemplate(
  template: string,
  declared: Set<string>,
  path: string,
  problem: (path: string, message: string) => void,
): string[] {
  const { variables, error } = templateVariables(template);
  if (error) problem(path, `malformed URL template: ${error}`);
  for (const name of variables) {
    if (!declared.has(name))
      problem(path, `template variable "${name}" is not a declared parameter`);
  }
  return variables;
}

function checkOperation(
  op: Operation,
  path: string,
  problem: (path: string, message: string) => void,
): void {
  const declared = checkParameters(op.inputs, path, problem);
  const used = checkTemplate(
    op.request.urlTemplate,
    declared,
    `${path}.request.urlTemplate`,
    problem,
  );
  if (op.request.bodyTemplate !== undefined) {
    for (const match of op.request.bodyTemplate.matchAll(BODY_PLACEHOLDER)) {
      const name = match[1] as string;
      if (!declared.has(name))
        problem(
          `${path}.request.bodyTemplate`,
          `placeholder "{${name}}" is not a declared parameter`,
        );
    }
  }
  op.inputs.forEach((p, i) => {
    if (p.location === "path" && !used.includes(p.name)) {
      problem(
        `${path}.inputs[${i}]`,
        `path parameter "${p.name}" does not appear in the URL template`,
      );
    }
  });
  op.csrf?.forEach((rule, i) => {
    if (rule.source.kind !== "cookie") {
      checkTemplate(
        rule.source.urlTemplate,
        declared,
        `${path}.csrf[${i}].source.urlTemplate`,
        problem,
      );
    }
  });
  if (op.extraction?.idField !== undefined) {
    const id = op.extraction.idField;
    if (!op.extraction.fields.some((f) => f.property === id)) {
      problem(`${path}.extraction.idField`, `idField <${id}> is not the property of a field rule`);
    }
  }
  const p = op.provenance;
  if (!(p.confidence >= 0 && p.confidence <= 1))
    problem(`${path}.provenance.confidence`, "confidence must be within 0..1");
}

function checkFlow(
  flow: Flow,
  path: string,
  operations: Map<string, Operation>,
  problem: (path: string, message: string) => void,
): void {
  const declared = checkParameters(flow.inputs, path, problem);
  if (flow.steps.length === 0) problem(`${path}.steps`, "a flow needs at least one step");
  let strongest = -1;
  flow.steps.forEach((step, i) => {
    const at = `${path}.steps[${i}]`;
    const op = operations.get(step.operation);
    if (op === undefined) {
      problem(`${at}.operation`, `<${step.operation}> is not an operation of this model`);
    } else {
      strongest = Math.max(strongest, effectRank(op.effect));
      const params = new Set(op.inputs.map((p) => p.name));
      for (const name of Object.keys(step.bind)) {
        if (!params.has(name))
          problem(`${at}.bind.${name}`, `"${name}" is not a parameter of <${op.id}>`);
      }
    }
    for (const [name, value] of Object.entries(step.bind)) {
      if (value.startsWith("$input.")) {
        const input = value.slice("$input.".length);
        if (!declared.has(input))
          problem(`${at}.bind.${name}`, `"${input}" is not an input of the flow`);
      } else {
        const ref = STEP_REF.exec(value);
        if (ref) {
          if (Number(ref[1]) >= i)
            problem(`${at}.bind.${name}`, `${value} does not refer to an earlier step`);
          if (!ABSOLUTE_IRI.test(ref[2] as string))
            problem(`${at}.bind.${name}`, `${value} must end in a property IRI`);
        }
      }
    }
  });
  if (strongest > effectRank(flow.effect)) {
    problem(
      `${path}.effect`,
      `effect ${flow.effect} is weaker than its strongest step (${EFFECT_ORDER[strongest]})`,
    );
  }
}

/**
 * Structural problems of a site model: unique ids, flow steps naming real operations, binds
 * naming real parameters and earlier steps, templates using only declared variables, flow
 * effects at least their strongest step, login routes naming real operations. An empty list
 * means the model is structurally sound.
 */
export function validateSiteModel(model: SiteModel): SiteModelProblem[] {
  const problems: SiteModelProblem[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });
  const ids = new Set<string>();
  const checkId = (id: string, path: string) => {
    if (!ABSOLUTE_IRI.test(id)) problem(`${path}.id`, "id must be an absolute IRI");
    if (ids.has(id)) problem(`${path}.id`, `duplicate id <${id}>`);
    ids.add(id);
  };
  checkId(model.id, "$");
  const operations = new Map<string, Operation>();
  model.operations.forEach((op, i) => {
    checkId(op.id, `operations[${i}]`);
    operations.set(op.id, op);
  });
  for (const [i, flow] of model.flows.entries()) checkId(flow.id, `flows[${i}]`);
  for (const [i, op] of model.operations.entries()) {
    checkOperation(op, `operations[${i}]`, problem);
  }
  for (const [i, flow] of model.flows.entries()) {
    checkFlow(flow, `flows[${i}]`, operations, problem);
  }
  model.login?.forEach((route, i) => {
    if (route.operation !== undefined && !operations.has(route.operation)) {
      problem(`login[${i}].operation`, `<${route.operation}> is not an operation of this model`);
    }
    if (route.method === "password" && route.operation === undefined) {
      problem(`login[${i}].operation`, "a password login route needs its form operation");
    }
  });
  return problems;
}
