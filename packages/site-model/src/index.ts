// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * `@jeswr/site-model`: the site model of the semantic agent browser. A site model lists the
 * actions a website offers (schema.org action types mapped onto the site's own HTTP calls);
 * this package reads and writes its RDF form through a generated model, parses planner
 * action requests, renders the planner's catalogue and checks a model's structure.
 */
export {
  type ActionRequestOptions,
  actionRequestTerms,
  isSchemaActionType,
  parseActionRequest,
} from "./action-request.js";
export { compactIri, renderCatalogue, shortName } from "./catalogue.js";
export { SiteModelError } from "./errors.js";
export { jsonLdToQuads } from "./jsonld.js";
export type { ParseOptions as ReadSiteModelOptions } from "./rdf.js";
export { SKOLEM_PREFIX } from "./rdf.js";
export { readSiteModel } from "./read.js";
export * from "./types.js";
export {
  isExecutorOwnedHeader,
  modelHeaderNames,
  type SiteModelProblem,
  templateVariables,
  validateSiteModel,
} from "./validate.js";
export {
  EFFECT_IRI,
  EFFECT_ORDER,
  effectRank,
  normaliseSchemaIri,
  PREFIXES,
  SAB_IRI_VALUE,
  SAB_NO_SESSION,
  SAB_SIGNED_IN,
  SAB_UNTRUSTED_TEXT,
} from "./vocab.js";
export { canonicalSiteModel, childIri, writeSiteModel } from "./write.js";
