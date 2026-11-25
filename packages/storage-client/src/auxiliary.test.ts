// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { isAuxiliaryResource } from "./index.js";

const parent = "https://pod.example/alice/";
const candidate = `${parent}policy`;
const other = `${parent}file`;
const link = (relation: string, target: string) => new Map([[relation, [{ target, params: {} }]]]);

it.each([
  ".acl",
  "file.%61cl",
  "file.ACR",
  "file.meta/child",
])("recognizes auxiliary path %s", (name) => {
  expect(isAuxiliaryResource(parent + name)).toBe(true);
});

it.each([
  "acl",
  "acr",
  "describedby",
  "linkset",
  "metadata",
  "https://www.iana.org/assignments/relation/describedby",
  "http://www.w3.org/ns/solid/acp#accessControl",
  "http://www.w3.org/ns/solid/terms#storageDescription",
])("recognizes an advertised auxiliary resource (%s)", (relation) => {
  const observation = {
    url: other,
    links: link(relation, `${parent}%70olicy#part`),
    metadataUrl: null,
    contentType: null,
  };
  expect(isAuxiliaryResource(candidate, observation)).toBe(true);
  expect(isAuxiliaryResource(other, observation)).toBe(false);
});

it("recognizes inverse links, auxiliary types and representations on the resource itself", () => {
  const observation = { url: candidate, links: new Map(), metadataUrl: null, contentType: null };
  expect(
    isAuxiliaryResource(candidate, {
      ...observation,
      contentType: "application/linkset+json; charset=utf-8",
    }),
  ).toBe(true);
  expect(isAuxiliaryResource(candidate, { ...observation, links: link("describes", other) })).toBe(
    true,
  );
  expect(
    isAuxiliaryResource(candidate, {
      ...observation,
      links: link("type", "http://www.w3.org/ns/solid/acp#AccessControlResource"),
    }),
  ).toBe(true);
  expect(
    isAuxiliaryResource(candidate, { ...observation, url: other, metadataUrl: candidate }),
  ).toBe(true);
  expect(
    isAuxiliaryResource(candidate, {
      ...observation,
      url: other,
      links: link("acl", "unparseable"),
    }),
  ).toBe(false);
  expect(
    isAuxiliaryResource(candidate, { ...observation, links: link("related", candidate) }),
  ).toBe(false);
  expect(
    isAuxiliaryResource(`${parent}caf%C3%A9`, {
      ...observation,
      links: link("acl", `${parent}caf%c3%a9`),
    }),
  ).toBe(true);
  expect(
    isAuxiliaryResource(candidate, { ...observation, links: link("type", "urn:Custom") }),
  ).toBe(false);
});
