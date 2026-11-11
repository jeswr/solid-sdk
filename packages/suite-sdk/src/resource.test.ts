// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { describe, expect, it } from "vitest";
import { isDirectChild, resolveSuiteResource, sharedApps } from "./resource.js";

const base = "https://pod.example/";
const url = `${base}item.ttl#it`;
const encodeRef = (value: string) => encodeURIComponent(value);
const resolve = (
  fields: Partial<Parameters<typeof resolveSuiteResource>[0]> = {},
  options: Partial<Parameters<typeof resolveSuiteResource>[1]> = {},
) => resolveSuiteResource({ url, ...fields }, { encodeRef, ...options });
const preview = (value = url) => `/drive/p/${encodeRef(value.split("#")[0] as string)}`;

describe("canonical suite resource resolver", () => {
  it.each([
    [NS.WF, "Task", "tasks", "task"],
    [NS.WF, "Tracker", "tasks", "task-list"],
    [NS.SCHEMA, "SpreadsheetDigitalDocument", "sheets", "spreadsheet"],
    [NS.SCHEMA, "TextDigitalDocument", "notes", "note"],
    [NS.POD_DOCS, "Document", "docs", "document"],
    [NS.SCHEMA, "DigitalDocument", "docs", "document"],
    [NS.VCARD, "Individual", "contacts", "person"],
    [NS.FOAF, "Person", "contacts", "person"],
    [NS.SCHEMA, "Person", "contacts", "person"],
    [NS.CAL, "Vevent", "calendar", "event"],
    [NS.SCHEMA, "Event", "calendar", "event"],
    [NS.CAL, "Vcalendar", "calendar", "calendar"],
    [NS.SCHEMA, "ImageObject", "photos", "photo"],
    [NS.SCHEMA, "Photograph", "photos", "photo"],
    [NS.SCHEMA, "PhotoAlbum", "photos", "album"],
    [NS.SCHEMA, "MusicRecording", "music", "audio"],
    [NS.SCHEMA, "AudioObject", "music", "audio"],
    [NS.SCHEMA, "MusicAlbum", "music", "album"],
    [NS.SCHEMA, "MusicPlaylist", "music", "playlist"],
    [NS.LDP, "Container", "drive", "folder"],
    [NS.LDP, "BasicContainer", "drive", "folder"],
  ])("maps canonical %s%s", (ns, local, app, kind) => {
    expect(resolve({ rdfTypes: [`${ns}${local}`] })).toMatchObject({ app, kind });
    expect(resolve({ rdfTypes: [`https://evil.example/${local}`] }).app).toBe("drive");
  });
  it("canonicalizes legacy vocabularies and uses Notes' native path", () => {
    expect(resolve({ rdfTypes: ["https://w3id.org/jeswr/pod-docs#Document"] }).app).toBe("docs");
    expect(resolve({ rdfTypes: ["http://schema.org/TextDigitalDocument"] }).app).toBe("notes");
    expect(resolve({ url: `${base}notes/n.ttl`, rdfTypes: [`${NS.POD_DOCS}Document`] }).app).toBe(
      "notes",
    );
  });
  it.each([
    ["sheets", "text/csv", "xlsx", "sheets"],
    ["notes", "application/vnd.jeswr.note", "note", "notes"],
    ["tasks", "application/vnd.jeswr.tasks", "todo", "tasks"],
    ["calendar", "text/calendar", "ics", "calendar"],
    ["photos", "image/png", "png", "photos"],
    ["music", "audio/mpeg", "mp3", "music"],
    ["docs", "text/markdown", "docx", "docs"],
  ])("uses %s MIME, filename and path hints for display", (app, mime, ext, path) => {
    expect(resolve({ contentType: ` ${mime.toUpperCase()}; charset=utf-8` }).app).toBe(app);
    expect(resolve({ name: `x.${ext}` }).app).toBe(app);
    expect(resolve({ url: `${base}x.${ext}`, name: "Friendly title" }).app).toBe(app);
    expect(resolve({ url: `${base}${path}/x` }).app).toBe(app);
  });
  it("keeps unknown types as data and classifies generic RDF and files", () => {
    expect(resolve({ rdfTypes: ["https://unknown/Type"] }).group).toBe("data");
    for (const rdfTypes of [
      [],
      [`${NS.LDP}Resource`],
      [`${NS.LDP}NonRDFSource`],
      ["http://www.w3.org/ns/iana/media-types/image/jpeg#Resource"],
    ]) {
      expect(resolve({ rdfTypes }).group).toBe("file");
      expect(resolve({ rdfTypes, contentType: "text/turtle" }).group).toBe("data");
    }
    expect(resolve({ url: `${base}folder/` })).toMatchObject({
      kind: "folder",
      group: "file",
      href: `/drive/f/${encodeRef(`${base}folder/`)}`,
    });
    expect(resolve({ url: `${base}%FF` }).app).toBe("drive");
    expect(resolve().href).toBe(preview());
    for (const url of [
      "javascript:alert(1)",
      "https://u:p@pod.example/x",
      "https://u@pod.example/x",
    ])
      expect(() => resolve({ url })).toThrow("Expected an HTTP resource");
  });
  it("retains search's native routes and subject identity for Tasks", () => {
    for (const [type, route] of [
      [`${NS.WF}Task`, `/tasks/inbox?task=${encodeRef(url)}`],
      [`${NS.WF}Tracker`, `/tasks/p/${encodeRef(url.split("#")[0] as string)}`],
      [`${NS.POD_DOCS}Document`, `/docs/d/${encodeRef(url.split("#")[0] as string)}`],
      [`${NS.SCHEMA}TextDigitalDocument`, `/notes/n/${encodeRef(url.split("#")[0] as string)}`],
      [`${NS.CAL}Vevent`, `/calendar/e/${encodeRef(url.split("#")[0] as string)}`],
    ] as const)
      expect(resolve({ rdfTypes: [type] }).href).toBe(route);
    expect(resolve({ rdfTypes: [`${NS.CAL}Vcalendar`] }).href).toBe(preview());
  });
  it("requires native formats and shared-capable destinations", () => {
    const options = { shared: true, storageUrl: base };
    for (const path of [
      "file.csv",
      "file.xlsx",
      "docs/file.md",
      "docs/file.docx",
      "docs/file.txt",
      "docs/file.html",
      "notes/file.ttl",
      "photos/a.jpg",
      "photos/albums/a.ttl",
      "music/a.mp3",
      "music/albums/a.ttl",
      "music/playlists/a.ttl",
      "calendar/a.ics",
      "tasks/a.todo",
    ])
      expect(resolve({ url: `${base}${path}` }, options).href).toBe(preview(`${base}${path}`));
    for (const [type, app] of [
      [`${NS.SCHEMA}TextDigitalDocument`, "notes"],
      [`${NS.CAL}Vevent`, "calendar"],
      [`${NS.CAL}Vcalendar`, "calendar"],
      [`${NS.SCHEMA}PhotoAlbum`, "photos"],
      [`${NS.SCHEMA}MusicPlaylist`, "music"],
      [`${NS.SCHEMA}Person`, "contacts"],
      [`${NS.WF}Task`, "tasks"],
    ])
      expect(resolve({ rdfTypes: [type as string] }, options)).toMatchObject({
        app,
        href: preview(),
      });
    for (const [path, route] of [
      ["docs/a.ttl", "docs/d"],
      ["pod-docs/a.ttl", "docs/d"],
      ["sheets/a/", "sheets/s"],
      ["pod-sheets/a/", "sheets/s"],
      ["tasks/a.ttl", "tasks/p"],
    ]) {
      const target = `${base}${path}#it`;
      expect(resolve({ url: target }, options).href).toBe(
        `/${route}/${encodeRef(target.split("#")[0] as string)}`,
      );
      expect(resolve({ url: target }, { ...options, previewOnly: true }).href).toBe(
        preview(target),
      );
    }
    expect(
      resolve({ url: `${base}other/a.ttl`, rdfTypes: [`${NS.POD_DOCS}Document`] }, options).href,
    ).toContain("/docs/d/");
    expect(
      resolve(
        { url: `${base}other/a/`, rdfTypes: [`${NS.SCHEMA}SpreadsheetDigitalDocument`] },
        options,
      ).href,
    ).toContain("/sheets/s/");
    for (const fields of [
      { url: `${base}other/a.ttl`, rdfTypes: [`${NS.SCHEMA}DigitalDocument`] },
      { url: `${base}other/a.ttl`, contentType: "text/plain" },
      { url: `${base}sheets/a.csv` },
      { url: `${base}other/a/`, contentType: "text/csv" },
      { url: `${base}tasks/a.ttl?bad=1` },
    ])
      expect(resolve(fields, options).href).toBe(preview(fields.url));
    for (const path of ["docs/a.ttl", "sheets/a/"]) {
      const fields = { url: `${base}${path}` };
      expect(resolve(fields, { shared: true }).href).toBe(preview(fields.url));
      expect(resolve(fields, { shared: true, storageUrl: "https://other.example/" }).href).toBe(
        preview(fields.url),
      );
    }
    expect(sharedApps).toEqual([
      "docs",
      "sheets",
      "notes",
      "tasks",
      "calendar",
      "photos",
      "music",
      "drive",
    ]);
  });
  it("delegates Contacts reference encoding and handles unavailable references", () => {
    const rdfTypes = [`${NS.VCARD}Individual`];
    const fields = {
      url: `${base}contacts/people/a.ttl`,
      parent: `${base}contacts/people/`,
      rdfTypes,
    };
    expect(resolve(fields).href).toBe("/contacts");
    expect(
      resolve(fields, { encodeContactRef: (book, document) => `${book}|${document}` }).href,
    ).toBe(`/contacts/c/${base}contacts/|${fields.url}`);
    expect(
      resolve(
        { ...fields, url: `${base}contacts/a.ttl`, parent: `${base}contacts/` },
        { encodeContactRef: () => "relative" },
      ).href,
    ).toBe("/contacts/c/relative");
    expect(
      resolve(fields, {
        encodeContactRef: () => {
          throw new Error("bad");
        },
      }).href,
    ).toBe("/contacts");
    expect(resolve({ ...fields, parent: "bad" }, { encodeContactRef: () => "unused" }).href).toBe(
      "/contacts",
    );
    expect(resolve({ rdfTypes }, { encodeContactRef: () => "unused" }).href).toBe("/contacts");
  });
});

it("checks direct children including credentials, nesting and encoded separators", () => {
  expect(isDirectChild(`${base}docs/a.ttl`, `${base}docs/`)).toBe(true);
  for (const target of [
    "bad",
    "file:///docs/a.ttl",
    `${base}docs/`,
    `${base}docs/sub/a.ttl`,
    `${base}docs/a%2fb.ttl`,
    `${base}docs/a%5Cb.ttl`,
    `${base}docs/a.ttl?q=1`,
    `${base}docs/a.ttl#it`,
    "https://other.example/docs/a.ttl",
    "https://u:p@pod.example/docs/a.ttl",
    "https://u@pod.example/docs/a.ttl",
  ])
    expect(isDirectChild(target, `${base}docs/`)).toBe(false);
});

it("previews native-looking URLs that their routers reject or whose MIME contradicts RDF", () => {
  const options = { encodeRef, shared: true, storageUrl: base };
  for (const path of [
    "tasks/a.ttl?q=1",
    "tasks/a%2fb.ttl",
    "docs/a.ttl?q=1",
    "docs/a%5cb.ttl",
    "sheets/a/?q=1",
    "sheets/a%2fb/",
  ])
    expect(resolveSuiteResource({ url: `${base}${path}` }, options).href).toBe(
      preview(`${base}${path}`),
    );
  expect(resolveSuiteResource({ url: "http://pod.example/tasks/a.ttl" }, options).href).toBe(
    preview("http://pod.example/tasks/a.ttl"),
  );
  for (const path of ["docs/a.ttl", "tasks/a.ttl"])
    expect(
      resolveSuiteResource({ url: `${base}${path}`, contentType: "text/plain" }, options).href,
    ).toBe(preview(`${base}${path}`));
  expect(
    resolveSuiteResource({ url: `${base}tasks/a.ttl`, contentType: "text/turtle" }, options).href,
  ).toContain("/tasks/p/");
});

it("applies native-format checks to search routes as well as shared routes", () => {
  for (const shared of [false, true]) {
    for (const path of [
      "sheets/a.csv",
      "sheets/a.xlsx",
      "docs/a.md",
      "docs/a.docx",
      "docs/a.txt",
      "docs/a.html",
      "tasks/a.todo",
      "tasks/projects/p/tasks/t.ttl",
    ])
      expect(resolve({ url: `${base}${path}` }, { shared, storageUrl: base }).href).toBe(
        preview(`${base}${path}`),
      );
  }
  expect(
    resolve({ url: `${base}arbitrary.ttl`, rdfTypes: [`${NS.WF}Tracker`] }, { shared: true }).href,
  ).toContain("/tasks/p/");
  expect(resolve({ url: `${base}sheets/a/` }).href).toContain("/sheets/s/");
  expect(
    resolve({ url: `${base}other/a/`, rdfTypes: [`${NS.SCHEMA}SpreadsheetDigitalDocument`] }).href,
  ).toContain("/sheets/s/");
  for (const [path, type] of [
    ["notes/a.note", `${NS.SCHEMA}TextDigitalDocument`],
    ["calendar/a.ics", `${NS.CAL}Vevent`],
    ["docs/a.docx", `${NS.POD_DOCS}Document`],
  ])
    expect(resolve({ url: `${base}${path}`, rdfTypes: [type as string] }).href).toBe(
      preview(`${base}${path}`),
    );
  for (const [path, type] of [
    ["notes/a.ttl", `${NS.SCHEMA}TextDigitalDocument`],
    ["calendar/a.ttl", `${NS.CAL}Vevent`],
  ]) {
    expect(resolve({ url: `${base}${path}?q=1`, rdfTypes: [type as string] }).href).toBe(
      preview(`${base}${path}?q=1`),
    );
    expect(
      resolve({ url: `${base}${path}`, rdfTypes: [type as string], contentType: "text/plain" })
        .href,
    ).toBe(preview(`${base}${path}`));
  }
});
