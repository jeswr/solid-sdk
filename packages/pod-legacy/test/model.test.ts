// AUTHORED-BY Codex GPT-6.1-Sol
import { Store } from "n3";
import { expect, it } from "vitest";
import { buildPlan, entities, parsePlan, serializePlan } from "../src/model.js";
import { plan, url } from "./fixture.js";

it("round-trips generated safety fields and linked contacts", async () => {
  const p = plan();
  const built = buildPlan(url, p);
  expect(parsePlan(url, built)).toEqual(p);
  expect(await entities.LegacyPlan.parseDocument(url, await serializePlan(url, p))).toMatchObject({
    enabled: true,
    contactUrls: [`${url}#contact-0`],
  });
  expect(await serializePlan(url, p)).toContain("dateTime");
});
it("rejects malformed required fields, broken and remote contact links", () => {
  const p = plan();
  expect(() => buildPlan(url, { ...p, contacts: [] })).toThrow();
  expect(parsePlan(url, new Store())).toBeUndefined();
  const store = buildPlan(url, p);
  const wrapper = new entities.LegacyPlan.Wrapper(url, store, importFactory);
  wrapper.contactUrls.clear();
  wrapper.contactUrls.add("https://foreign.example/contact");
  expect(parsePlan(url, store)).toBeUndefined();
  wrapper.contactUrls.clear();
  wrapper.contactUrls.add(`${url}#contact-missing`);
  expect(parsePlan(url, store)).toBeUndefined();
});

import { DataFactory as importFactory } from "n3";

it("rejects unsupported modes and domain-invalid narrowing in generated data", () => {
  const store = buildPlan(url, plan());
  const contact = new entities.LegacyContact.Wrapper(`${url}#contact-0`, store, importFactory);
  contact.scope = "whole-pod";
  expect(parsePlan(url, store)).toBeUndefined();
  contact.scope = "containers";
  contact.displayName = " ";
  expect(parsePlan(url, store)).toBeUndefined();
  contact.displayName = "Alex";
  contact.mode = undefined;
  expect(parsePlan(url, store)).toBeUndefined();
});
it("preserves exact WebID identity and rejects untrusted noncanonical scopes instead of normalizing them", () => {
  const p = plan();
  p.contacts[0]!.webId = "https://ALEX.example/card#Me";
  p.owner = "https://ALICE.example/profile#Me";
  expect(parsePlan(url, buildPlan(url, p))).toEqual(p);
  const store = buildPlan(url, plan());
  const contact = new entities.LegacyContact.Wrapper(`${url}#contact-0`, store, importFactory);
  contact.targets.clear();
  contact.targets.add("https://alice.example/Photos/../Private/");
  expect(parsePlan(url, store)).toBeUndefined();
  contact.targets.clear();
  contact.targets.add("https://alice.example/Photos/");
  contact.webId = "http://alex.example/#me";
  expect(parsePlan(url, store)).toBeUndefined();
});
