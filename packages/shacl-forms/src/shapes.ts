// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import { literalMapper, XSD } from "@jeswr/model-runtime";
import { DataFactory, Store } from "n3";
import { compiledForms, compileForm, localName } from "./compile.js";
import { checkedPrefixes, DASH, LIMIT, put, RDF, RDFS, SH, withPrefixes } from "./rdf.js";
import { type FieldDescriptor, FormAdmissionError, type FormModel } from "./types.js";

const FORM_KEYS = new Set([
  "shape",
  "targetClass",
  "label",
  "description",
  "fields",
  "groups",
  "prefixes",
]);
const FIELD_KEYS = new Set([
  "path",
  "key",
  "name",
  "label",
  "description",
  "order",
  "group",
  "kind",
  "datatype",
  "options",
  "minCount",
  "maxCount",
  "minLength",
  "minInclusive",
  "maxInclusive",
  "severity",
  "form",
  "pattern",
  "message",
  "hasClass",
  "singleLine",
]);
/** Validate designer descriptors by admitting their emitted graph through the same compiler. */
export function formToShapes(form: FormModel): Store {
  const store = withPrefixes(new Store(), checkedPrefixes(form.prefixes));
  const visited = new Map<string, FormModel>();
  let fields = 0;
  const emit = (model: FormModel, ancestors: Set<FormModel>): void => {
    const fail = (construct: string): never => {
      throw new FormAdmissionError(construct, model.shape, "invalid designer descriptor");
    };
    if (ancestors.has(model) || ancestors.size >= LIMIT.depth) fail(`${SH}node`);
    for (const key of Object.keys(model)) if (!FORM_KEYS.has(key)) fail(key);
    if (!Array.isArray(model.fields) || !Array.isArray(model.groups)) fail("fields/groups");
    const prior = visited.get(model.shape);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(model)) fail("conflicting shape identity");
      return;
    }
    visited.set(model.shape, model);
    const next = new Set(ancestors).add(model);
    const subject = DataFactory.namedNode(model.shape);
    const iri = (predicate: string, value?: string) => {
      if (value !== undefined) {
        if (typeof value !== "string") fail(predicate);
        put(store, subject, predicate, DataFactory.namedNode(value));
      }
    };
    const text = (predicate: string, value?: string) => {
      if (value !== undefined) {
        if (typeof value !== "string") fail(predicate);
        put(store, subject, predicate, DataFactory.literal(value));
      }
    };
    iri(`${RDF}type`, `${SH}NodeShape`);
    iri(`${SH}targetClass`, model.targetClass);
    text(`${RDFS}label`, model.label);
    text(`${SH}description`, model.description);
    for (const [prefix, namespace] of Object.entries(checkedPrefixes(model.prefixes))) {
      const declaration = DataFactory.blankNode();
      put(store, subject, `${SH}declare`, declaration);
      put(store, declaration, `${SH}prefix`, DataFactory.literal(prefix));
      put(
        store,
        declaration,
        `${SH}namespace`,
        DataFactory.literal(namespace, DataFactory.namedNode(`${XSD}anyURI`)),
      );
    }
    for (const group of model.groups) {
      for (const key of Object.keys(group)) if (!["iri", "label", "order"].includes(key)) fail(key);
      const node = DataFactory.namedNode(group.iri);
      put(store, node, `${RDF}type`, DataFactory.namedNode(`${SH}PropertyGroup`));
      if (group.label !== undefined)
        put(store, node, `${RDFS}label`, DataFactory.literal(group.label));
      if (group.order !== undefined)
        put(
          store,
          node,
          `${SH}order`,
          literalMapper(`${XSD}decimal`).from(group.order as never, DataFactory),
        );
    }
    const displayFields = [...model.fields].sort(
      (a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY),
    );
    const usedKeys = new Set<string>();
    for (const field of displayFields) {
      const base = field.name ?? localName(field.path);
      let expectedKey = base;
      for (let suffix = 2; usedKeys.has(expectedKey); suffix++) expectedKey = `${base}_${suffix}`;
      const sourceName = field.name ?? (field.key !== expectedKey ? field.key : undefined);
      usedKeys.add(field.key);
      if (++fields > LIMIT.fields) fail("field limit");
      for (const key of Object.keys(field)) if (!FIELD_KEYS.has(key)) fail(key);
      const prop = DataFactory.blankNode();
      const addIri = (component: string, value?: string) => {
        if (value !== undefined) put(store, prop, SH + component, DataFactory.namedNode(value));
      };
      const addText = (predicate: string, value?: string) => {
        if (value !== undefined) put(store, prop, predicate, DataFactory.literal(value));
      };
      put(store, subject, `${SH}property`, prop);
      addIri("path", field.path);
      addIri("datatype", field.datatype);
      if (!field.datatype) addIri("nodeKind", `${SH}IRI`);
      addIri("class", field.hasClass);
      addIri("group", field.group);
      addText(`${SH}name`, sourceName);
      addText(`${RDFS}label`, field.label);
      addText(`${SH}description`, field.description);
      addText(`${SH}message`, field.message);
      addText(`${SH}pattern`, field.pattern);
      const severity = { violation: "Violation", warning: "Warning", info: "Info" }[field.severity];
      if (!severity) fail(`${SH}severity`);
      addIri("severity", SH + severity);
      for (const component of [
        "minCount",
        "maxCount",
        "minLength",
        "minInclusive",
        "maxInclusive",
        "order",
      ] as const) {
        const value = field[component];
        if (value !== undefined) {
          if (typeof value !== "number" || !Number.isFinite(value)) fail(SH + component);
          const datatype = ["minCount", "maxCount", "minLength"].includes(component)
            ? `${XSD}integer`
            : `${XSD}decimal`;
          put(
            store,
            prop,
            SH + component,
            literalMapper(datatype).from(value as never, DataFactory),
          );
        }
      }
      if (field.singleLine !== undefined) {
        if (field.singleLine !== true) fail(`${DASH}singleLine`);
        put(
          store,
          prop,
          `${DASH}singleLine`,
          DataFactory.literal("true", DataFactory.namedNode(`${XSD}boolean`)),
        );
      }
      if (field.kind === "multiline")
        put(
          store,
          prop,
          `${DASH}singleLine`,
          DataFactory.literal("false", DataFactory.namedNode(`${XSD}boolean`)),
        );
      if (field.options) {
        if (!field.options.length || field.options.length > LIMIT.options) fail(`${SH}in`);
        const cells = field.options.map(() => DataFactory.blankNode());
        put(store, prop, `${SH}in`, cells[0] as ReturnType<typeof DataFactory.blankNode>);
        field.options.forEach((option, i) => {
          for (const key of Object.keys(option))
            if (!["value", "label", "termType"].includes(key)) fail(key);
          if (
            typeof option.value !== "string" ||
            !["Literal", "NamedNode"].includes(option.termType)
          )
            fail(`${SH}in`);
          const member =
            option.termType === "NamedNode"
              ? DataFactory.namedNode(option.value)
              : DataFactory.literal(
                  option.value,
                  DataFactory.namedNode(field.datatype ?? `${XSD}string`),
                );
          put(store, cells[i] as ReturnType<typeof DataFactory.blankNode>, `${RDF}first`, member);
          put(
            store,
            cells[i] as ReturnType<typeof DataFactory.blankNode>,
            `${RDF}rest`,
            cells[i + 1] ?? DataFactory.namedNode(`${RDF}nil`),
          );
          if (option.label !== undefined && member.termType === "NamedNode")
            put(store, member, `${RDFS}label`, DataFactory.literal(option.label));
        });
      }
      if (field.form) {
        addIri("node", field.form.shape);
        emit(field.form, next);
      }
    }
  };
  emit(form, new Set());
  const admitted = compileForm(store, form.shape);
  const checkProjection = (input: FormModel, result: FormModel): void => {
    if (input.fields.length !== result.fields.length)
      throw new FormAdmissionError("fields", input.shape);
    for (const field of input.fields) {
      const checked = result.fields.find((candidate) => candidate.path === field.path);
      if (
        !checked ||
        field.key !== checked.key ||
        field.kind !== checked.kind ||
        field.singleLine !== checked.singleLine ||
        (field.kind === "node") !== !!field.form
      )
        throw new FormAdmissionError(
          "field key/kind",
          input.shape,
          "descriptor disagrees with its SHACL projection; use name to set a key",
        );
      if (field.form && checked.form) checkProjection(field.form, checked.form);
    }
  };
  checkProjection(form, admitted);
  return store;
}
export function checkedForm(form: FormModel): FormModel {
  return compiledForms.has(form) ? form : compileForm(formToShapes(form), form.shape);
}
/** Resolve the expected RDF term kind independently of UI kind (choice can be either). */
export const isIriField = (field: FieldDescriptor): boolean => field.datatype === undefined;
