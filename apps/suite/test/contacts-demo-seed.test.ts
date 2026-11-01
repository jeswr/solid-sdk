// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contactAvatar, searchContacts, sectionContacts } from "../src/apps/contacts/lib/list";
import { Contact } from "../src/apps/contacts/lib/model";
import { ContactsController } from "../src/apps/contacts/state/controller";
import { projectContact } from "../src/apps/contacts/state/data";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { seedContacts } from "../src/lib/demo-pod/seed-contacts";
import { MemoryIntentStorage } from "./contacts-support";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Contacts demo seed", () => {
  it("loads 40 deterministic contacts, three labels and two losslessly migratable PM contacts", async () => {
    const files = await buildDemoSeed(1000);
    const pod = createDemoPod({ root: DEMO_ROOT, seed: files });
    const errors: string[] = [];
    const storage = new MemoryIntentStorage();
    const controller = new ContactsController(
      pod.fetch,
      DEMO_ROOT,
      DEMO_WEBID,
      (error) => errors.push(error),
      () => storage,
    );
    await controller.refresh();
    expect(controller.getSnapshot().status, String(controller.getSnapshot().error)).toBe("ready");
    const data = controller.getSnapshot().data;
    expect(data.people).toHaveLength(40);
    expect(data.groups.map((g) => g.data.name)).toEqual(["Family", "Work", "Book club"]);
    expect(data.flat).toHaveLength(2);
    for (const candidate of data.flat) {
      const snapshot = await controller.model.loadFlatContacts(candidate.id);
      expect(
        [...snapshot.dataset].every(
          (quad) => quad.subject.value === candidate.id && quad.object.termType !== "BlankNode",
        ),
      ).toBe(true);
      expect(snapshot.data[0]?.data).toMatchObject({
        organization: "Fictional Bookshop",
        emails: [expect.stringMatching(/^mailto:legacy[01]@example.org$/)],
        phones: ["tel:+442079460123"],
      });
    }
    const contacts = data.people.map(projectContact);
    expect(sectionContacts(contacts).at(-1)?.label).toBe("Z");
    expect(searchContacts(contacts, "Mira")[0]?.contact.displayName).toBe("Mira Quill");
    for (const contact of contacts) expect(contactAvatar(contact).initials).not.toBe("?");
    expect(await controller.migrate()).toEqual({ moved: 2, failed: 0 });
    expect(controller.getSnapshot().data.people).toHaveLength(42);
    expect(controller.getSnapshot().data.flat).toEqual([]);
    expect(errors).toEqual([]);
    expect(
      controller.getSnapshot().data.people.find((p) => p.data.name === "Pax Orchard")?.data,
    ).toMatchObject({
      organization: "Fictional Bookshop",
      note: "A friend from Pod Manager.",
      phones: ["tel:+442079460123"],
    });
    const repeated = await buildDemoSeed(1000);
    const repeatPod = createDemoPod({ root: DEMO_ROOT, seed: repeated });
    const first = data.people[0];
    if (!first) throw new Error("Missing deterministic seed contact");
    const fresh = await new ContactsController(
      repeatPod.fetch,
      DEMO_ROOT,
      DEMO_WEBID,
      () => {},
    ).model.loadContact(first.url);
    expect(fresh.data).toEqual(first.data);
    expect(new Contact(`${first.url}#this`, fresh.dataset, DataFactory).uid).toBe(
      new Contact(`${first.url}#this`, first.dataset, DataFactory).uid,
    );
    expect(repeated.map((file) => file.path)).toEqual(files.map((file) => file.path));
  });
  it("gates URL fixtures to development and keeps the default small", async () => {
    vi.stubGlobal("window", { location: { search: "?seed=contacts-200" } });
    vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "0");
    expect(
      (await seedContacts([], 1)).filter((file) => file.path.startsWith("contacts/people/")),
    ).toHaveLength(40);
    vi.stubEnv("NEXT_PUBLIC_DEV_FIXTURES", "1");
    const large = await seedContacts([], 1);
    expect(large.filter((file) => file.path.startsWith("contacts/people/"))).toHaveLength(200);
    const pod = createDemoPod({ root: DEMO_ROOT, seed: large });
    const model = new ContactsController(pod.fetch, DEMO_ROOT, DEMO_WEBID, () => {}).model;
    const book = await model.loadAddressBook();
    expect((await model.loadPeople(book)).data).toHaveLength(200);
    vi.stubGlobal("window", { location: { search: "?seed=contacts-empty" } });
    expect(
      (await seedContacts([], 1)).some((file) => file.path.startsWith("contacts/people/")),
    ).toBe(false);
    vi.stubGlobal("window", { location: { search: "?seed=contacts-no-book" } });
    expect(await seedContacts([], 1)).toEqual([]);
  });
});
