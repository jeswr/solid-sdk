// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { isExecutorOwnedHeader, type Operation } from "@jeswr/site-model";
import { type CompiledRequest, compileOperation } from "./compile.js";
import { sentInputValue } from "./response-evidence.js";
import { pagingKind } from "./selection.js";
import { expandTemplate, templateVariables } from "./uri-template.js";
import { csrfFieldName, effectiveWireFields, type WireField } from "./wire.js";

/** Scope names are case insensitive; a leading x- is decoration, never a synonym. */
export function isScopeField(name: string): boolean {
  return /(?:^|[^a-z])(?:namespace|store|website|tenant|org|organization|organisation|account|workspace|scope|project|environment|realm|resource|collection|dataset|merchant|company|business|team|group|subscription|client|department|division)(?:id|name|key|code|slug|uuid|region)?(?:[^a-z]|$)/i.test(
    name,
  );
}

function token(compiled: CompiledRequest, field: WireField): boolean {
  return (
    !!field.sessionToken ||
    compiled.csrf.some(
      (rule) =>
        csrfFieldName(compiled, rule) === field.name &&
        (rule.target.kind === "form"
          ? field.location === "body"
          : rule.target.kind === field.location),
    )
  );
}

export interface WitnessedScopeConstant {
  location: "query" | "header";
  name: string;
  value: string;
}

/** An input with a default is still an input, including embedded template uses. */
function constantScope(operation: Operation, field: WitnessedScopeConstant): boolean {
  if (
    operation.inputs.some(
      (p) =>
        p.location === field.location &&
        decodeURIComponent(p.name).toLowerCase() === field.name.toLowerCase(),
    )
  )
    return false;
  if (field.location === "header")
    return Object.entries(operation.request.headers ?? {}).some(
      ([name, value]) =>
        name.toLowerCase() === field.name.toLowerCase() &&
        value === field.value &&
        !/[{}]/.test(value),
    );
  const template = operation.request.urlTemplate;
  return ["aaaa", "zzzz"].every((marker) => {
    const probe = new URL(
      expandTemplate(
        template,
        Object.fromEntries(templateVariables(template).map((name) => [name, marker])),
      ),
    );
    return (
      probe.searchParams.getAll(field.name).length === 1 &&
      probe.searchParams.get(field.name) === field.value
    );
  });
}

/** JSON pointers retain their path; a root member has the same name as a form field. */
function scopeName(field: WireField, compiled: CompiledRequest): string {
  const name =
    field.location === "body" && compiled.body?.kind === "json"
      ? field.name.replace(/^\/([^/]+)$/, (_all, member: string) =>
          member.replaceAll("~1", "/").replaceAll("~0", "~"),
        )
      : field.name;
  return name.toLowerCase().replace(/^x-/, "");
}

/** A domain member such as product[stock_data][website_id] is not a request scope control. */
function bodyScopeName(name: string): boolean {
  const root = name.replace(/^\//, "").split(/[[./]/)[0] ?? "";
  return isScopeField(root);
}

function scopeField(field: WireField): boolean {
  return field.location === "body" ? bodyScopeName(field.name) : isScopeField(field.name);
}

/** Locate whole input uses without mistaking a default or an equal literal for a binding. */
export function wireInputSources(operation: Operation, origin: string): WireField[] {
  const values = Object.fromEntries(
    operation.inputs.map((p, i) => [p.name, `sab_scope_input_${i}_end`]),
  );
  return effectiveWireFields(
    compileOperation(operation, values, origin, { placeholders: new Set(Object.keys(values)) }),
  );
}

/** Candidates only: the caller must witness post-write equality before accepting these pins. */
export function readOnlyScopeConstants(
  write: CompiledRequest,
  read: CompiledRequest,
  operation: Operation,
): WitnessedScopeConstant[] {
  const left = effectiveWireFields(write).filter((f) => !token(write, f));
  return effectiveWireFields(read).flatMap((field) => {
    if (
      (field.location !== "query" && field.location !== "header") ||
      !isScopeField(field.name) ||
      token(read, field) ||
      left.some(
        (f) =>
          ["query", "header", "body"].includes(f.location) &&
          scopeName(f, write) === scopeName(field, read),
      )
    )
      return [];
    const pin = { location: field.location, name: field.name, value: field.value };
    return constantScope(operation, pin) ? [pin] : [];
  });
}

/** Compare scope across surfaces, retaining each value's constant/input provenance. */
export function verificationScopeMatches(
  write: CompiledRequest,
  writeOperation: Operation,
  read: CompiledRequest,
  readOperation: Operation,
  witnessed: readonly WitnessedScopeConstant[] = [],
  bindings?: Record<string, { input: string } | { value: string }>,
): boolean {
  const selectors = (compiled: CompiledRequest, operation: Operation, right = false) => {
    const result = new Map<string, string[]>();
    const probes = wireInputSources(operation, compiled.url.origin);
    for (const field of effectiveWireFields(compiled)) {
      if (!["query", "header", "body"].includes(field.location) || token(compiled, field)) continue;
      if (field.location === "header" && isExecutorOwnedHeader(field.name)) continue;
      const scope = scopeField(field);
      if (field.location === "body" && !scope) continue;
      if (
        !scope &&
        operation.inputs.some(
          (p) =>
            p.location === field.location &&
            decodeURIComponent(p.name) === field.name &&
            pagingKind(p.name),
        )
      )
        continue;
      const key = scope
        ? `scope:${scopeName(field, compiled)}`
        : `${field.location}:${field.name.toLowerCase()}`;
      let value = field.value;
      if (scope) {
        const probe = probes.filter((p) => p.location === field.location && p.name === field.name);
        const source = probe[0]?.value;
        const inputAt = /^sab_scope_input_(\d+)_end$/.exec(source ?? "")?.[1];
        if (
          probe.length !== 1 ||
          source === undefined ||
          (source.includes("sab_scope_input_") && inputAt === undefined)
        )
          return;
        if (inputAt !== undefined) {
          const name = operation.inputs[Number(inputAt)]?.name;
          if (!name) return;
          const binding = right ? bindings?.[name] : undefined;
          const bound =
            binding && "input" in binding
              ? binding.input
              : right && bindings
                ? `unbound:${name}`
                : name;
          value = JSON.stringify([field.value, "input", bound]);
        } else value = JSON.stringify([field.value, "constant"]);
      }
      result.set(key, [...(result.get(key) ?? []), value]);
    }
    return result;
  };
  try {
    const a = selectors(write, writeOperation),
      b = selectors(read, readOperation, true);
    if (!a || !b) return false;
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const left = a.get(key),
        right = b.get(key);
      if (key.startsWith("scope:")) {
        if ((left && new Set(left).size !== 1) || (right && new Set(right).size !== 1))
          return false;
        if (
          !left &&
          right &&
          witnessed.some(
            (pin) =>
              `scope:${pin.name.toLowerCase().replace(/^x-/, "")}` === key &&
              right[0] === JSON.stringify([pin.value, "constant"]) &&
              constantScope(readOperation, pin),
          )
        )
          continue;
        if (!left || !right || left[0] !== right[0]) return false;
      } else if (left && right && JSON.stringify(left) !== JSON.stringify(right)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Every bound state input needs coverage. Changed literals are inventoried separately by profiling. */
export function submittedStateInputs(
  operation: Operation,
  values: Record<string, string>,
  origin: string,
  identityInput: string,
): string[] {
  const compiled = compileOperation(operation, values, origin);
  return operation.inputs
    .filter((p) => {
      if (
        (p.location === "path" &&
          (isScopeField(p.name) ||
            /(?:identifier|isPartOf)$/.test(p.path.at(-1) ?? "") ||
            p.path.some((part) => /(?:isPartOf|about)$/.test(part)))) ||
        (["query", "header"].includes(p.location) && isScopeField(p.name)) ||
        (["form", "body"].includes(p.location) && bodyScopeName(decodeURIComponent(p.name))) ||
        (["query", "header"].includes(p.location) && pagingKind(p.name)) ||
        p.name === identityInput ||
        values[p.name] === undefined
      )
        return false;
      if (compiled.csrf.some((rule) => rule.target.name === p.name)) return false;
      if (sentInputValue(operation, values, p.name, origin) !== undefined) return true;
      // An embedded/transformed submitted value still needs coverage; it cannot
      // disappear merely because whole-value evidence cannot represent it.
      try {
        const marker = "sab_state_coverage_marker";
        const probe = compileOperation(operation, { ...values, [p.name]: marker }, origin, {
          placeholders: new Set([p.name]),
        });
        return effectiveWireFields(probe).some((field) => field.value.includes(marker));
      } catch {
        return true;
      }
    })
    .map((p) => p.name);
}
