// AUTHORED-BY Claude Opus 5.5
/** writeSiteModel: the typed SiteModel -> Turtle, through the generated model and n3.Writer. */
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import type { Quad, Quad_Object, Term } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import { SiteModelError } from "./errors.js";
import { entities } from "./generated/model.js";
import { ParameterLists } from "./lists.js";
import { readSiteModel } from "./read.js";
import type {
  CsrfRule,
  Extraction,
  Flow,
  LoginRoute,
  Operation,
  Parameter,
  Provenance,
  RequestTemplate,
  SiteModel,
} from "./types.js";
import {
  EFFECT_IRI,
  PREFIXES,
  RDF_FIRST,
  RDF_NIL,
  RDF_REST,
  RDF_TYPE,
  SAB_IRI_VALUE,
  SAB_NO_SESSION,
  SAB_SIGNED_IN,
} from "./vocab.js";

type Entities = typeof entities;
type EntityName = keyof Entities;
type BuildData<N extends EntityName> = Parameters<Entities[N]["build"]>[1];

/** The IRI of a node minted under `parent`: a fragment, or a dotted extension of one. */
export function childIri(parent: string, suffix: string): string {
  return parent.includes("#") ? `${parent}.${suffix}` : `${parent}#${suffix}`;
}

function date(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new SiteModelError(`${field} is not an ISO 8601 date-time: "${value}"`);
  }
  return parsed;
}

function sortedEntries(record: Record<string, string>): [string, string][] {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

class Builder {
  readonly store = new Store();
  /** Subjects in the order they were written: the Turtle subject order. */
  readonly subjects: string[] = [];

  node<N extends EntityName>(name: N, iri: string, data: BuildData<N>): string {
    if (this.subjects.includes(iri)) {
      throw new SiteModelError(`two nodes of the site model share the IRI <${iri}>`);
    }
    const entity = entities[name] as unknown as {
      build(resourceUrl: string, data: BuildData<N>): Store;
    };
    let built: Store;
    try {
      built = entity.build(iri, data);
    } catch (cause) {
      throw new SiteModelError(`cannot write ${name} <${iri}>: ${(cause as Error).message}`, {
        cause,
      });
    }
    this.subjects.push(iri);
    this.store.addQuads([...built]);
    return iri;
  }

  pairs(parent: string, record: Record<string, string>): string[] {
    return sortedEntries(record).map(([name, value], index) =>
      this.node("PropertyValue", childIri(parent, String(index)), {
        name,
        propertyValue: value,
      }),
    );
  }

  parameter(iri: string, p: Parameter, position: number): string {
    this.node("Parameter", iri, {
      name: p.name,
      position,
      range: p.range,
      required: p.required,
      location: p.location,
      ...(p.description === undefined ? {} : { description: p.description }),
      ...(p.example === undefined ? {} : { example: p.example }),
      ...(p.default === undefined ? {} : { default: p.default }),
    });
    const bad = p.path.find((step) => !isSafeAbsoluteIri(step));
    if (bad !== undefined) {
      throw new SiteModelError(
        `cannot write Parameter <${iri}>: path step "${bad}" is not an absolute IRI`,
      );
    }
    const lists = new ParameterLists(iri, this.store, DataFactory);
    lists.valuePath = p.path;
    lists.options = p.options;
    return iri;
  }

  inputs(parent: string, inputs: Parameter[]): string[] {
    return inputs.map((p, i) => this.parameter(childIri(parent, `input.${i}`), p, i));
  }

  request(iri: string, r: RequestTemplate): string {
    // Write the entry point before its headers so the Turtle reads top-down.
    const headers = r.headers && Object.keys(r.headers).length > 0 ? r.headers : undefined;
    const headerIris = headers
      ? sortedEntries(headers).map((_, i) => childIri(iri, `header.${i}`))
      : [];
    this.node("EntryPoint", iri, {
      method: r.method,
      urlTemplate: r.urlTemplate,
      ...(r.contentType === undefined ? {} : { contentType: r.contentType }),
      ...(r.bodyTemplate === undefined ? {} : { bodyTemplate: r.bodyTemplate }),
      ...(headerIris.length ? { headers: headerIris } : {}),
    });
    if (headers) this.pairs(childIri(iri, "header"), headers);
    return iri;
  }

  csrf(parent: string, rules: CsrfRule[]): string[] {
    return rules.map((rule, i) => {
      const iri = childIri(parent, `csrf.${i}`);
      const source = childIri(iri, "source");
      const target = childIri(iri, "target");
      this.node("CsrfRule", iri, { source, target, position: i });
      const s = rule.source;
      this.node("CsrfSource", source, {
        kind: s.kind,
        ...(s.kind === "cookie" || s.kind === "meta" ? { name: s.name } : {}),
        ...(s.kind === "cookie" ? {} : { urlTemplate: s.urlTemplate }),
        ...(s.kind === "html" ? { selector: s.selector, attribute: s.attribute } : {}),
        ...(s.kind === "json" ? { pointer: s.pointer } : {}),
      });
      this.node("CsrfTarget", target, { kind: rule.target.kind, name: rule.target.name });
      return iri;
    });
  }

  extraction(iri: string, e: Extraction): string {
    const fieldIris = e.fields.map((_, i) => childIri(iri, `field.${i}`));
    this.node("Extraction", iri, {
      format: e.format,
      ...(e.itemPath === undefined ? {} : { itemPath: e.itemPath }),
      itemType: e.itemType,
      ...(e.idField === undefined ? {} : { idField: e.idField }),
      fields: fieldIris,
    });
    e.fields.forEach((f, i) => {
      this.node("FieldRule", fieldIris[i] as string, {
        property: f.property,
        path: f.path,
        position: i,
        ...(f.attribute === undefined ? {} : { attribute: f.attribute }),
        ...(f.datatype === undefined
          ? {}
          : { valueDatatype: f.datatype === "iri" ? SAB_IRI_VALUE : f.datatype }),
        ...(f.untrusted === undefined ? {} : { untrusted: f.untrusted }),
      });
    });
    return iri;
  }

  operation(op: Operation, position: number): void {
    const request = childIri(op.id, "request");
    const inputIris = op.inputs.map((_, i) => childIri(op.id, `input.${i}`));
    const csrfIris = (op.csrf ?? []).map((_, i) => childIri(op.id, `csrf.${i}`));
    const extraction = op.extraction ? childIri(op.id, "extraction") : undefined;
    this.node("Operation", op.id, {
      actionType: op.actionType,
      label: op.label,
      position,
      ...(op.description === undefined ? {} : { description: op.description }),
      ...(inputIris.length ? { inputs: inputIris } : {}),
      request,
      session: op.session === "signed-in" ? SAB_SIGNED_IN : SAB_NO_SESSION,
      ...(csrfIris.length ? { csrf: csrfIris } : {}),
      effect: EFFECT_IRI[op.effect],
      ...(extraction === undefined ? {} : { extraction }),
      ...(op.returnsShape === undefined ? {} : { returnsShape: op.returnsShape }),
      ...provenance(op.provenance, op.id),
    });
    this.inputs(op.id, op.inputs);
    this.request(request, op.request);
    this.csrf(op.id, op.csrf ?? []);
    if (op.extraction && extraction) this.extraction(extraction, op.extraction);
  }

  flow(flow: Flow, position: number): void {
    const inputIris = flow.inputs.map((_, i) => childIri(flow.id, `input.${i}`));
    const stepIris = flow.steps.map((_, i) => childIri(flow.id, `step.${i}`));
    this.node("Flow", flow.id, {
      actionType: flow.actionType,
      label: flow.label,
      position,
      ...(flow.description === undefined ? {} : { description: flow.description }),
      ...(inputIris.length ? { inputs: inputIris } : {}),
      ...(stepIris.length ? { steps: stepIris } : {}),
      effect: EFFECT_IRI[flow.effect],
      ...provenance(flow.provenance, flow.id),
    });
    this.inputs(flow.id, flow.inputs);
    flow.steps.forEach((step, i) => {
      const iri = stepIris[i] as string;
      const bindings = sortedEntries(step.bind).map((_, j) => childIri(iri, `bind.${j}`));
      this.node("FlowStep", iri, {
        operation: step.operation,
        position: i,
        ...(bindings.length ? { bindings } : {}),
      });
      this.pairs(childIri(iri, "bind"), step.bind);
    });
  }

  login(iri: string, route: LoginRoute, position: number): string {
    const refresh = route.refresh ? childIri(iri, "refresh") : undefined;
    this.node("LoginRoute", iri, {
      method: route.method,
      position,
      ...(route.operation === undefined ? {} : { operation: route.operation }),
      ...(route.sessionCookies?.length ? { sessionCookies: route.sessionCookies } : {}),
      ...(route.probeUrl === undefined ? {} : { probeUrl: route.probeUrl }),
      ...(refresh === undefined ? {} : { refresh }),
    });
    if (route.refresh && refresh) {
      this.node("RefreshRule", refresh, {
        urlTemplate: route.refresh.urlTemplate,
        tokenPointer: route.refresh.tokenPointer,
        ...(route.refresh.expiresInPointer === undefined
          ? {}
          : { expiresInPointer: route.refresh.expiresInPointer }),
      });
    }
    return iri;
  }
}

function provenance(p: Provenance, owner: string) {
  return {
    ...(p.derivedFrom.length ? { derivedFrom: p.derivedFrom } : {}),
    learnedAt: date(p.learnedAt, `provenance.learnedAt of <${owner}>`),
    method: p.method,
    confidence: p.confidence,
    ...(p.lastVerified === undefined
      ? {}
      : { lastVerified: date(p.lastVerified, `provenance.lastVerified of <${owner}>`) }),
    ...(p.successes === undefined ? {} : { successes: p.successes }),
    ...(p.attempts === undefined ? {} : { attempts: p.attempts }),
  };
}

/** Build the RDF dataset of a model; `subjects` lists node IRIs in writing order. */
export function buildSiteModel(model: SiteModel): { store: Store; subjects: string[] } {
  const b = new Builder();
  const loginIris = (model.login ?? []).map((_, i) => childIri(model.id, `login.${i}`));
  b.node("SiteModel", model.id, {
    site: model.site,
    version: model.version,
    generatedAt: date(model.generatedAt, "generatedAt"),
    actions: [...model.operations.map((o) => o.id), ...model.flows.map((f) => f.id)],
    ...(loginIris.length ? { loginRoutes: loginIris } : {}),
  });
  model.operations.forEach((op, i) => {
    b.operation(op, i);
  });
  model.flows.forEach((flow, i) => {
    b.flow(flow, i);
  });
  (model.login ?? []).forEach((route, i) => {
    b.login(loginIris[i] as string, route, i);
  });
  return { store: b.store, subjects: b.subjects };
}

// ---------------------------------------------------------------------------
// Canonical form and the lossless check
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The form readSiteModel returns for a model: timestamps as Date#toISOString, set-valued
 * fields (derivedFrom, sessionCookies) sorted, and empty optional collections (headers,
 * csrf, login, sessionCookies) dropped. writeSiteModel accepts any input whose canonical
 * form survives the round trip unchanged.
 */
export function canonicalSiteModel(model: SiteModel): SiteModel {
  const iso = (value: string, field: string) => date(value, field).toISOString();
  const sorted = (values: string[]) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const prov = (p: Provenance, owner: string): Provenance => ({
    ...p,
    derivedFrom: sorted(p.derivedFrom),
    learnedAt: iso(p.learnedAt, `provenance.learnedAt of <${owner}>`),
    ...(p.lastVerified === undefined
      ? {}
      : { lastVerified: iso(p.lastVerified, `provenance.lastVerified of <${owner}>`) }),
  });
  const operations = model.operations.map((op): Operation => {
    const { headers, ...request } = op.request;
    const { csrf, ...rest } = op;
    return {
      ...rest,
      request: headers && Object.keys(headers).length ? { ...request, headers } : request,
      ...(csrf?.length ? { csrf } : {}),
      provenance: prov(op.provenance, op.id),
    };
  });
  const { login, ...rest } = model;
  return {
    ...rest,
    generatedAt: iso(model.generatedAt, "generatedAt"),
    operations,
    flows: model.flows.map((f) => ({ ...f, provenance: prov(f.provenance, f.id) })),
    ...(login?.length
      ? {
          login: login.map((route) => {
            const { sessionCookies, ...r } = route;
            return sessionCookies?.length ? { ...r, sessionCookies: sorted(sessionCookies) } : r;
          }),
        }
      : {}),
  };
}

/** The path of the first difference between two JSON values (undefined keys ignored). */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | undefined {
  if (Object.is(a, b)) return undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
    for (const key of keys) {
      if (ao[key] === undefined && bo[key] === undefined) continue;
      const d = firstDifference(ao[key], bo[key], `${path}.${key}`);
      if (d) return d;
    }
    return undefined;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Turtle
// ---------------------------------------------------------------------------

function termKey(term: Term): string {
  return `${term.termType}:${term.value}:${term.termType === "Literal" ? term.datatype.value : ""}`;
}

function listItems(store: Store, head: Term): Quad_Object[] | undefined {
  const items: Quad_Object[] = [];
  let node: Term = head;
  const seen = new Set<string>();
  while (!(node.termType === "NamedNode" && node.value === RDF_NIL)) {
    if (node.termType !== "BlankNode" || seen.has(node.value)) return undefined;
    seen.add(node.value);
    const first = store.getObjects(node, DataFactory.namedNode(RDF_FIRST), null);
    const rest = store.getObjects(node, DataFactory.namedNode(RDF_REST), null);
    if (first.length !== 1 || rest.length !== 1) return undefined;
    items.push(first[0] as Quad_Object);
    node = rest[0] as Term;
  }
  return items;
}

function serialise(store: Store, subjects: string[]): Promise<string> {
  const writer = new Writer({ prefixes: { ...PREFIXES } });
  for (const iri of subjects) {
    const subject = DataFactory.namedNode(iri);
    const quads: Quad[] = store.getQuads(subject, null, null, null);
    quads.sort((x, y) => {
      const px = x.predicate.value === RDF_TYPE ? "" : x.predicate.value;
      const py = y.predicate.value === RDF_TYPE ? "" : y.predicate.value;
      if (px !== py) return px < py ? -1 : 1;
      const ox = termKey(x.object);
      const oy = termKey(y.object);
      return ox < oy ? -1 : ox > oy ? 1 : 0;
    });
    for (const q of quads) {
      const items = q.object.termType === "BlankNode" ? listItems(store, q.object) : undefined;
      writer.addQuad(subject, q.predicate, items ? writer.list(items) : q.object);
    }
  }
  return new Promise((resolve, reject) => {
    writer.end((error, result: string) => (error ? reject(error) : resolve(result)));
  });
}

/**
 * Serialise a site model as Turtle with n3.Writer: stable subject order (the model, then each
 * operation, flow and login route followed by its own nodes), rdf:type first, then
 * predicates and objects sorted, RDF lists inline. Throws SiteModelError when a value cannot
 * be written or would not read back identically (compare canonicalSiteModel).
 */
export async function writeSiteModel(model: SiteModel): Promise<string> {
  const expected = canonicalSiteModel(model);
  const { store, subjects } = buildSiteModel(model);
  let actual: SiteModel;
  try {
    actual = readSiteModel([...store]);
  } catch (cause) {
    throw new SiteModelError(`cannot write the site model: ${(cause as Error).message}`, { cause });
  }
  const difference = firstDifference(expected as unknown as Json, actual as unknown as Json);
  if (difference !== undefined) {
    throw new SiteModelError(
      `cannot write the site model losslessly: ${difference} is missing, invalid or not representable`,
    );
  }
  return serialise(store, subjects);
}
