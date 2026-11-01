// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  absentOr,
  ensureDeleted,
  ensurePerson,
  membership,
  personLink,
  saveDocument,
} from "../src/apps/contacts/lib/model/intent";
import { ALICE, BOOK, FRIENDS, PEOPLE, ROOT, setup, VCARD_PREFIX } from "./contacts-support";

describe("Contacts idempotent journal effects", () => {
  it("adopts only an existing expected UID and protects occupied destinations", async () => {
    const { model, pod } = await setup();
    const person = await model.loadContact(ALICE);
    const saved = await saveDocument(person);
    expect((await ensurePerson(model, saved)).data).toEqual(person.data);
    const changed = saved.turtle.replace("urn:uuid:alice", "urn:uuid:other");
    await expect(ensurePerson(model, { ...saved, turtle: changed })).rejects.toMatchObject({
      status: 412,
    });
    const noUid = `${VCARD_PREFIX} <#this> a vcard:Individual; vcard:fn "Alice".`;
    await expect(ensurePerson(model, { ...saved, turtle: noUid })).rejects.toMatchObject({
      status: 412,
    });
    pod.seed(ALICE, noUid);
    expect((await ensurePerson(model, { ...saved, turtle: noUid })).data.name).toBe("Alice");
    expect(pod.writes).toEqual([]);
  });
  it("confirms a missing DELETE target, including a 404 between GET and DELETE, and retains other failures", async () => {
    const { model, pod } = await setup();
    const saved = await saveDocument(await model.loadContact(ALICE));
    pod.fail = (url, method) =>
      url === ALICE && method === "DELETE" ? new Response(null, { status: 404 }) : undefined;
    await ensureDeleted(model, saved);
    pod.fail = (url, method) =>
      url === ALICE && method === "DELETE" ? new Response(null, { status: 412 }) : undefined;
    await expect(ensureDeleted(model, saved)).rejects.toMatchObject({ status: 412 });
    pod.fail = undefined;
    pod.files.delete(ALICE);
    await ensureDeleted(model, saved);
    await expect(
      absentOr(async () => {
        throw "not an RDF 404";
      }),
    ).rejects.toBe("not an RDF 404");
  });
  it("merges fresh index and membership RDF, skips existing effects and ignores removed labels", async () => {
    const { model, pod } = await setup();
    const person = await model.loadContact(ALICE);
    pod.seed(
      PEOPLE,
      `${VCARD_PREFIX} <${ALICE}#this> vcard:fn "Alice"; vcard:inAddressBook <${BOOK}#this>. <> <https://example.org/extra> "keep".`,
    );
    await personLink(model, BOOK, person, true);
    expect(pod.writes).toHaveLength(0);
    await personLink(model, BOOK, person, false);
    await personLink(model, BOOK, person, false);
    expect(pod.writes).toHaveLength(1);
    await personLink(model, BOOK, person, true);
    expect(pod.files.get(PEOPLE)?.body).toContain('"keep"');
    await membership(model, BOOK, `${ROOT}groups/removed.ttl`, `${ALICE}#this`, true);
    await membership(model, BOOK, FRIENDS, `${ALICE}#this`, true);
    await membership(model, BOOK, FRIENDS, `${ROOT}someone#this`, false);
    expect(pod.writes).toHaveLength(2);
    await membership(model, BOOK, FRIENDS, `${ROOT}someone#this`, true);
    await membership(model, BOOK, FRIENDS, `${ALICE}#this`, false);
    expect((await model.loadGroup(FRIENDS)).data.members).toEqual([`${ROOT}someone#this`]);
  });
});
