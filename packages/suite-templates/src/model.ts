// AUTHORED-BY Codex GPT-6.1-Sol
import { entities, type TemplateData } from "./generated/model.js";

export type { TemplateData };
export const TEMPLATE_CLASS = "http://schema.org/CreativeWork";
export const templateModel = entities.Template;
export const buildTemplate = templateModel.build;
export const parseTemplate = templateModel.parse;
export const serializeTemplate = templateModel.serialize;
export const parseTemplateDocument = templateModel.parseDocument;
