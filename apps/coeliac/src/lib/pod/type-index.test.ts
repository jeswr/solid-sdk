// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { DIET_MEAL, DIET_SYMPTOM, LEGACY_DIET_NS } from "@jeswr/solid-health-diary";
import { recordingStorage } from "../../../test/storage";
import { describe, expect, it } from "vitest";
import { mealsContainer, symptomsContainer } from "./layout";
import { registerDiaryTypes } from "./type-index";

const WEBID = "https://alice.example/profile/card#me";
const ROOT = "https://alice.example/";
const INDEX = "https://alice.example/settings/privateTypeIndex.ttl";

const PROFILE_TTL = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${WEBID}> solid:privateTypeIndex <${INDEX}> .`;

const EMPTY_INDEX_TTL = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${INDEX}> a solid:TypeIndex, solid:UnlistedDocument .`;

describe("registerDiaryTypes", () => {
  it("registers diet:Meal + diet:Symptom into an existing private index", async () => {
    const { storage, calls, puts } = recordingStorage();
    await storage.write(`${ROOT}profile/card`, PROFILE_TTL, { contentType: "text/turtle", ifMatch: "*" });
    await storage.write(INDEX, EMPTY_INDEX_TTL, { contentType: "text/turtle", ifMatch: "*" });

    calls.length = 0;
    const result = await registerDiaryTypes(storage, { webId: WEBID, storageRoot: ROOT });
    expect(result.registered).toBe(true);
    expect(result.indexUrl).toBe(INDEX);
    const indexPut = puts().find((p) => p.url === INDEX);
    expect(indexPut).toBeTruthy();
    expect(indexPut?.body).toContain(DIET_MEAL);
    expect(indexPut?.body).toContain(DIET_SYMPTOM);
    expect(indexPut?.body).toContain(mealsContainer(ROOT));
  });

  it("never throws — a fetch failure resolves { registered: false }", async () => {
    const { storage } = recordingStorage(ROOT, () => { throw new TypeError("Failed to fetch"); });
    await expect(registerDiaryTypes(storage, { webId: WEBID, storageRoot: ROOT })).resolves.toEqual({
      registered: false,
    });
  });
});

// AUTHORED-BY Codex GPT-6
it.each([false, true])("keeps existing diary registrations idempotent (legacy: %s)", async (legacy) => {
  const { storage, calls, puts } = recordingStorage();
  const meal = legacy ? `${LEGACY_DIET_NS}Meal` : DIET_MEAL;
  const symptom = legacy ? `${LEGACY_DIET_NS}Symptom` : DIET_SYMPTOM;
  const index = `${EMPTY_INDEX_TTL}
    <#meal> a <http://www.w3.org/ns/solid/terms#TypeRegistration> ;
      <http://www.w3.org/ns/solid/terms#forClass> <${meal}> ;
      <http://www.w3.org/ns/solid/terms#instanceContainer> <${mealsContainer(ROOT)}> .
    <#symptom> a <http://www.w3.org/ns/solid/terms#TypeRegistration> ;
      <http://www.w3.org/ns/solid/terms#forClass> <${symptom}> ;
      <http://www.w3.org/ns/solid/terms#instanceContainer> <${symptomsContainer(ROOT)}> .`;
  await storage.write(`${ROOT}profile/card`, PROFILE_TTL, { contentType: "text/turtle", ifMatch: "*" });
  await storage.write(INDEX, index, { contentType: "text/turtle", ifMatch: "*" });
  calls.length = 0;
  expect(await registerDiaryTypes(storage, { webId: WEBID, storageRoot: ROOT })).toEqual({ registered: true, indexUrl: INDEX });
  expect(puts()).toEqual([]);
});
