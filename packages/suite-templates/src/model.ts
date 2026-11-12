// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { entities, type TemplateData } from "./generated/model.js";

export type { TemplateData };
export const TEMPLATE_CLASS = "https://jeswr.org/ns/templates#Template";
export const templateModel = entities.Template;
export function buildTemplate(resource: string, data: TemplateData) {
  const dataset = templateModel.build(resource, data);
  new templateModel.Wrapper(templateModel.subject(resource), dataset, DataFactory).types.add(
    "http://schema.org/CreativeWork",
  );
  return dataset;
}
export const parseTemplate = templateModel.parse;
export const serializeTemplate = (resource: string, data: TemplateData) =>
  templateModel.storeToTurtle(buildTemplate(resource, data));
export const parseTemplateDocument = templateModel.parseDocument;
