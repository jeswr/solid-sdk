// AUTHORED-BY Claude Opus 5.5
/** readSiteModel: RDF -> the typed SiteModel projection, through the generated model. */
import { createParseScope, type ParseScope } from "@jeswr/model-runtime";
import type { Quad } from "@rdfjs/types";
import { DataFactory, type Store } from "n3";
import { SiteModelError } from "./errors.js";
import { entities } from "./generated/model.js";
import { ParameterLists } from "./lists.js";
import { normaliseSchemaTerms, type ParseOptions, parseText, skolemise } from "./rdf.js";
import type {
  CsrfRule,
  CsrfSource,
  CsrfTarget,
  EffectClass,
  Extraction,
  FieldRule,
  Flow,
  FlowStep,
  LoginRoute,
  Operation,
  Parameter,
  Provenance,
  RequestTemplate,
  SiteModel,
} from "./types.js";
import {
  EFFECT_IRI,
  RDF_TYPE,
  SAB_FLOW,
  SAB_IRI_VALUE,
  SAB_OPERATION,
  SAB_SIGNED_IN,
  SAB_SITE_MODEL,
} from "./vocab.js";

type Entities = typeof entities;
type EntityName = keyof Entities;
type DataOf<N extends EntityName> = NonNullable<ReturnType<Entities[N]["parse"]>>;

const EFFECT_BY_IRI = new Map<string, EffectClass>(
  Object.entries(EFFECT_IRI).map(([effect, iri]) => [iri, effect as EffectClass]),
);

class Reader {
  private readonly scope: ParseScope;

  constructor(private readonly dataset: Store) {
    this.scope = createParseScope(dataset);
  }

  node<N extends EntityName>(name: N, iri: string): DataOf<N> {
    const entity = entities[name] as { parse: Entities[N]["parse"] };
    const data = entity.parse(iri, this.dataset, { scope: this.scope });
    if (data === undefined) {
      throw new SiteModelError(
        `<${iri}> is not a valid ${name}: it is untyped, or a required field is missing or malformed`,
      );
    }
    return data as DataOf<N>;
  }

  /** Read linked nodes in schema:position order (unpositioned last, then by IRI). */
  ordered<N extends EntityName>(
    name: N,
    iris: readonly string[] | undefined,
  ): (DataOf<N> & { iri: string })[] {
    const nodes = (iris ?? []).map((iri) => ({ iri, data: this.node(name, iri) }));
    const position = (data: unknown) =>
      (data as { position?: number }).position ?? Number.POSITIVE_INFINITY;
    nodes.sort((a, b) => position(a.data) - position(b.data) || compare(a.iri, b.iri));
    return nodes.map((n) => Object.assign(n.data, { iri: n.iri }));
  }

  hasType(iri: string, type: string): boolean {
    return this.dataset.has(
      DataFactory.quad(
        DataFactory.namedNode(iri),
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(type),
      ),
    );
  }

  parameter(data: DataOf<"Parameter"> & { iri: string }): Parameter {
    const lists = new ParameterLists(data.iri, this.dataset, DataFactory);
    const options = lists.options;
    return {
      name: data.name,
      path: lists.valuePath,
      range: data.range,
      required: data.required,
      location: data.location,
      ...(data.description === undefined ? {} : { description: data.description }),
      ...(options === undefined ? {} : { options }),
      ...(data.example === undefined ? {} : { example: data.example }),
      ...(data.default === undefined ? {} : { default: data.default }),
    };
  }

  pairs(iris: readonly string[] | undefined): Record<string, string> {
    const record: Record<string, string> = {};
    for (const pair of this.ordered("PropertyValue", iris)) {
      if (Object.hasOwn(record, pair.name)) {
        throw new SiteModelError(`<${pair.iri}> repeats the name "${pair.name}"`);
      }
      record[pair.name] = pair.propertyValue;
    }
    return record;
  }

  request(iri: string): RequestTemplate {
    const data = this.node("EntryPoint", iri);
    const headers = data.headers?.length ? this.pairs(data.headers) : undefined;
    return {
      method: data.method,
      urlTemplate: data.urlTemplate,
      ...(data.contentType === undefined ? {} : { contentType: data.contentType }),
      ...(data.bodyTemplate === undefined ? {} : { bodyTemplate: data.bodyTemplate }),
      ...(headers === undefined ? {} : { headers }),
    };
  }

  csrfSource(iri: string): CsrfSource {
    const s = this.node("CsrfSource", iri);
    const need = (value: string | undefined, field: string): string => {
      if (value === undefined) {
        throw new SiteModelError(`CSRF source <${iri}> of kind ${s.kind} needs ${field}`);
      }
      return value;
    };
    switch (s.kind) {
      case "cookie":
        return { kind: "cookie", name: need(s.name, "schema:name") };
      case "html":
        return {
          kind: "html",
          urlTemplate: need(s.urlTemplate, "schema:urlTemplate"),
          selector: need(s.selector, "sab:selector"),
          attribute: need(s.attribute, "sab:attribute"),
        };
      case "json":
        return {
          kind: "json",
          urlTemplate: need(s.urlTemplate, "schema:urlTemplate"),
          pointer: need(s.pointer, "sab:pointer"),
        };
      default:
        return {
          kind: "meta",
          urlTemplate: need(s.urlTemplate, "schema:urlTemplate"),
          name: need(s.name, "schema:name"),
        };
    }
  }

  csrf(iris: readonly string[] | undefined): CsrfRule[] | undefined {
    if (!iris?.length) return undefined;
    return this.ordered("CsrfRule", iris).map((rule) => {
      const target = this.node("CsrfTarget", rule.target);
      return {
        source: this.csrfSource(rule.source),
        target: { kind: target.kind, name: target.name } as CsrfTarget,
      };
    });
  }

  extraction(iri: string): Extraction {
    const data = this.node("Extraction", iri);
    const fields = this.ordered("FieldRule", data.fields).map(
      (f): FieldRule => ({
        property: f.property,
        path: f.path,
        ...(f.attribute === undefined ? {} : { attribute: f.attribute }),
        ...(f.valueDatatype === undefined
          ? {}
          : { datatype: f.valueDatatype === SAB_IRI_VALUE ? "iri" : f.valueDatatype }),
        ...(f.untrusted === undefined ? {} : { untrusted: f.untrusted }),
      }),
    );
    return {
      format: data.format,
      ...(data.itemPath === undefined ? {} : { itemPath: data.itemPath }),
      itemType: data.itemType,
      ...(data.idField === undefined ? {} : { idField: data.idField }),
      fields,
    };
  }

  operation(iri: string): Operation {
    const data = this.node("Operation", iri);
    const csrf = this.csrf(data.csrf);
    return {
      id: iri,
      actionType: data.actionType,
      label: data.label,
      ...(data.description === undefined ? {} : { description: data.description }),
      inputs: this.ordered("Parameter", data.inputs).map((p) => this.parameter(p)),
      request: this.request(data.request),
      session: data.session === SAB_SIGNED_IN ? "signed-in" : "none",
      ...(csrf === undefined ? {} : { csrf }),
      effect: effect(data.effect),
      ...(data.extraction === undefined ? {} : { extraction: this.extraction(data.extraction) }),
      ...(data.returnsShape === undefined ? {} : { returnsShape: data.returnsShape }),
      provenance: provenance(data),
    };
  }

  flow(iri: string): Flow {
    const data = this.node("Flow", iri);
    return {
      id: iri,
      actionType: data.actionType,
      label: data.label,
      ...(data.description === undefined ? {} : { description: data.description }),
      inputs: this.ordered("Parameter", data.inputs).map((p) => this.parameter(p)),
      steps: this.ordered("FlowStep", data.steps).map(
        (step): FlowStep => ({ operation: step.operation, bind: this.pairs(step.bindings) }),
      ),
      effect: effect(data.effect),
      provenance: provenance(data),
    };
  }

  login(iris: readonly string[] | undefined): LoginRoute[] | undefined {
    if (!iris?.length) return undefined;
    return this.ordered("LoginRoute", iris).map((route): LoginRoute => {
      const refresh =
        route.refresh === undefined ? undefined : this.node("RefreshRule", route.refresh);
      const cookies = route.sessionCookies?.length
        ? [...route.sessionCookies].sort(compare)
        : undefined;
      return {
        method: route.method,
        ...(route.operation === undefined ? {} : { operation: route.operation }),
        ...(cookies === undefined ? {} : { sessionCookies: cookies }),
        ...(route.probeUrl === undefined ? {} : { probeUrl: route.probeUrl }),
        ...(refresh === undefined
          ? {}
          : {
              refresh: {
                urlTemplate: refresh.urlTemplate,
                tokenPointer: refresh.tokenPointer,
                ...(refresh.expiresInPointer === undefined
                  ? {}
                  : { expiresInPointer: refresh.expiresInPointer }),
              },
            }),
      };
    });
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function effect(iri: string): EffectClass {
  return EFFECT_BY_IRI.get(iri) as EffectClass;
}

function provenance(data: DataOf<"Operation"> | DataOf<"Flow">): Provenance {
  return {
    derivedFrom: [...(data.derivedFrom ?? [])].sort(compare),
    learnedAt: data.learnedAt.toISOString(),
    method: data.method,
    confidence: data.confidence,
    ...(data.lastVerified === undefined ? {} : { lastVerified: data.lastVerified.toISOString() }),
    ...(data.successes === undefined ? {} : { successes: data.successes }),
    ...(data.attempts === undefined ? {} : { attempts: data.attempts }),
  };
}

/** The position of an action among the model's actions (unpositioned last, then by IRI). */
function sortActions(
  reader: Reader,
  iris: readonly string[],
  type: "Operation" | "Flow",
): string[] {
  const position = (iri: string) => reader.node(type, iri).position ?? Number.POSITIVE_INFINITY;
  return [...iris].sort((a, b) => position(a) - position(b) || compare(a, b));
}

/**
 * Read a site model from Turtle-family text (default `text/turtle`; `application/ld+json`
 * accepts the JSON-LD subset of parseActionRequest) or from quads. The document must hold
 * exactly one sab:SiteModel. Blank nodes are replaced by `urn:x-site-model:genid:` IRIs
 * and `http://schema.org/` IRIs are normalised to https.
 */
export function readSiteModel(input: string | Quad[], options: ParseOptions = {}): SiteModel {
  const quads = typeof input === "string" ? parseText(input, options, "site model") : input;
  const dataset = skolemise(normaliseSchemaTerms(quads));
  const models = dataset
    .getSubjects(DataFactory.namedNode(RDF_TYPE), DataFactory.namedNode(SAB_SITE_MODEL), null)
    .map((term) => term.value);
  if (models.length !== 1) {
    throw new SiteModelError(`expected exactly one sab:SiteModel, found ${models.length}`);
  }
  const id = models[0] as string;
  const reader = new Reader(dataset);
  const model = reader.node("SiteModel", id);
  const actions = model.actions ?? [];
  const operations = actions.filter((iri) => reader.hasType(iri, SAB_OPERATION));
  const flows = actions.filter((iri) => reader.hasType(iri, SAB_FLOW));
  const untyped = actions.find((iri) => !operations.includes(iri) && !flows.includes(iri));
  if (untyped !== undefined) {
    throw new SiteModelError(`action <${untyped}> is neither a sab:Operation nor a sab:Flow`);
  }
  const login = reader.login(model.loginRoutes);
  return {
    id,
    site: model.site,
    version: model.version,
    generatedAt: model.generatedAt.toISOString(),
    operations: sortActions(reader, operations, "Operation").map((iri) => reader.operation(iri)),
    flows: sortActions(reader, flows, "Flow").map((iri) => reader.flow(iri)),
    ...(login === undefined ? {} : { login }),
  };
}
