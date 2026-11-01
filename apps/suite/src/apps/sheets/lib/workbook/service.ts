// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type {
  CreateWorkbookInput,
  OpenedWorkbook,
  SaveResult,
  WorkbookService,
  WorkbookServiceOptions,
  WorkbookSummary,
  WorkbookVersion,
} from "../contract";
import {
  WorkbookConflictError,
  WorkbookNotFoundError,
  WorkbookPartialSaveError,
} from "../contract";
import {
  createSheetStorage,
  type Precondition,
  type Snapshot,
  type WorkbookMetadata,
  workbookLayout,
} from "../model";
import { assertWorkbook, directChild, slug } from "./layout";
import type { ProjectedSheet } from "./projection";
import { registration } from "./registration";
import { hasStatus, resources, strongEtag } from "./resources";

export function createWorkbookService(options: WorkbookServiceOptions): WorkbookService {
  const root = new URL("sheets/", options.podRoot).href;
  const storage = createSheetStorage(options.fetch, options.podRoot);
  const io = resources(storage);
  const now = options.now ?? (() => new Date());
  const register = registration(options, root);
  const checked = (container: string) => assertWorkbook(root, container);

  async function writeSheets(
    container: string,
    sheets: ProjectedSheet[],
    base?: Readonly<Record<string, string>>,
    derived: Record<string, string> = {},
  ): Promise<Record<string, string>> {
    for (const sheet of sheets) {
      const urls = workbookLayout(container).sheet(sheet.number);
      const writes: [string, (condition: Precondition) => Promise<string | null>][] = [
        [urls.csv, (condition) => storage.saveCsv(container, sheet.number, sheet.csv, condition)],
        [
          urls.descriptor,
          (condition) =>
            storage.saveDescriptor(container, sheet.number, sheet.descriptor, condition),
        ],
      ];
      for (const [url, write] of writes) {
        derived[url] =
          base === undefined
            ? await io.etag(url, await write({ ifNoneMatch: "*" }))
            : await io.derived(url, base[url], write);
      }
    }
    return derived;
  }

  async function create(input: CreateWorkbookInput): Promise<OpenedWorkbook> {
    const { freshSnapshot, project } = await import("./projection");
    const snapshot = freshSnapshot(input.title, input.snapshot);
    const sheets = project(snapshot);
    const date = now();
    const initial: WorkbookMetadata = {
      title: input.title,
      created: date,
      modified: date,
      creator: options.webId,
      sheets: [],
    };
    const stem = slug(input.title);
    for (let attempt = 1; attempt <= 50; attempt++) {
      const container = new URL(`${stem}${attempt === 1 ? "" : `-${attempt}`}/`, root).href;
      const layout = workbookLayout(container);
      let reservation: string;
      try {
        reservation = await io.etag(
          layout.index,
          await storage.saveIndex(container, initial, { ifNoneMatch: "*" }),
        );
      } catch (error) {
        if (hasStatus(error, 412)) continue;
        throw error;
      }
      try {
        const snapshotEtag = await io.etag(
          layout.snapshot,
          await storage.saveSnapshot(container, snapshot, { ifNoneMatch: "*" }),
        );
        const derived = await writeSheets(container, sheets);
        const metadata = {
          ...initial,
          sheets: sheets.map(({ number, name }) => ({ number, name })),
        };
        const indexEtag = await io.etag(
          layout.index,
          await io.authoritative(container, () =>
            storage.saveIndex(container, metadata, { ifMatch: reservation }),
          ),
        );
        await register();
        return { container, metadata, snapshot, version: { snapshotEtag, indexEtag, derived } };
      } catch (error) {
        // This slug was reserved by us. Do not leave an unreadable workbook behind.
        await remove(container).catch(() => {});
        throw error;
      }
    }
    throw new Error("Could not allocate a spreadsheet slug after 50 attempts");
  }

  async function open(container: string): Promise<OpenedWorkbook> {
    container = checked(container);
    const layout = workbookLayout(container);
    try {
      const [index, snapshot] = await Promise.all([
        storage.loadIndex(container),
        storage.loadSnapshot(container),
      ]);
      return {
        container,
        metadata: index.value,
        snapshot: snapshot.value,
        version: {
          snapshotEtag: strongEtag(snapshot.etag, layout.snapshot),
          indexEtag: strongEtag(index.etag, layout.index),
          derived: {},
        },
      };
    } catch (error) {
      if (hasStatus(error, 404) || hasStatus(error, 403))
        throw new WorkbookNotFoundError(container);
      throw error;
    }
  }

  async function save(
    container: string,
    snapshot: Snapshot,
    base: WorkbookVersion,
    saveOptions: { force?: boolean; title?: string } = {},
  ): Promise<SaveResult> {
    container = checked(container);
    const layout = workbookLayout(container);
    const previous = await storage.loadIndex(container);
    const previousIndexEtag = strongEtag(previous.etag, layout.index);
    if (!saveOptions.force && previousIndexEtag !== base.indexEtag)
      throw new WorkbookConflictError(container);
    const { project } = await import("./projection");
    const sheets = project(snapshot);
    const snapshotMatch = saveOptions.force
      ? await io.etag(layout.snapshot, null)
      : base.snapshotEtag;
    const snapshotEtag = await io.etag(
      layout.snapshot,
      await io.authoritative(container, () =>
        storage.saveSnapshot(container, snapshot, { ifMatch: snapshotMatch }),
      ),
    );
    const derived = { ...(saveOptions.force ? {} : base.derived) };
    const metadata: WorkbookMetadata = {
      ...previous.value,
      // index.ttl owns the title once created (rename writes it there); the engine
      // snapshot's own name is not kept in sync, so it never overrides a rename.
      title: saveOptions.title ?? previous.value.title,
      modified: now(),
      sheets: sheets.map(({ number, name }) => ({ number, name })),
    };
    let indexEtag = previousIndexEtag;
    try {
      await writeSheets(container, sheets, saveOptions.force ? {} : base.derived, derived);
      const indexMatch = saveOptions.force ? await io.etag(layout.index, null) : base.indexEtag;
      indexEtag = await io.etag(
        layout.index,
        await io.authoritative(container, () =>
          storage.saveIndex(container, metadata, { ifMatch: indexMatch }),
        ),
      );
    } catch (error) {
      if (error instanceof WorkbookConflictError) throw error;
      if (error instanceof Error && hasStatus(error.cause, 412))
        throw new WorkbookConflictError(container);
      throw new WorkbookPartialSaveError({ snapshotEtag, indexEtag, derived }, error);
    }
    // Listing also finds leftovers from a previous save whose cleanup failed.
    // Cleanup is best effort and must never turn a published save into a failure.
    const sheetRoot = new URL("sheets/", container).href;
    await storage.listContainer(sheetRoot).then(
      async (children) => {
        for (const child of children) {
          if (child.isContainer || !directChild(sheetRoot, child.id)) continue;
          const match = /^(\d+)\.(csv|jsonld)$/.exec(child.id.slice(sheetRoot.length));
          if (match && Number(match[1]) > sheets.length) await io.remove(child.id).catch(() => {});
        }
      },
      () => {},
    );
    const active = Object.fromEntries(
      sheets.flatMap(({ number }) => {
        const urls = layout.sheet(number);
        return [urls.csv, urls.descriptor].map((url) => [url, derived[url] as string]);
      }),
    );
    return { metadata, version: { snapshotEtag, indexEtag, derived: active } };
  }

  async function rename(
    container: string,
    title: string,
    base: WorkbookVersion,
  ): Promise<SaveResult> {
    container = checked(container);
    const index = await storage.loadIndex(container);
    const metadata = { ...index.value, title, modified: now() };
    const indexEtag = await io.etag(
      workbookLayout(container).index,
      await io.authoritative(container, () =>
        storage.saveIndex(container, metadata, { ifMatch: base.indexEtag }),
      ),
    );
    return { metadata, version: { ...base, indexEtag } };
  }

  async function remove(container: string): Promise<void> {
    container = checked(container);
    async function descend(url: string): Promise<void> {
      let children: Awaited<ReturnType<typeof storage.listContainer>>;
      try {
        children = await storage.listContainer(url);
      } catch (error) {
        if (hasStatus(error, 404)) return;
        throw error;
      }
      for (const child of children) {
        if (!directChild(url, child.id)) continue;
        if (child.isContainer) await descend(child.id);
        else await io.remove(child.id);
      }
      await io.remove(url);
    }
    await descend(container);
  }

  async function list(): Promise<WorkbookSummary[]> {
    let children: Awaited<ReturnType<typeof storage.listContainer>>;
    try {
      children = await storage.listContainer(root);
    } catch (error) {
      if (hasStatus(error, 404)) return [];
      throw error;
    }
    const containers = children.filter((child) => child.isContainer && directChild(root, child.id));
    const result: WorkbookSummary[] = [];
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, containers.length) }, async () => {
        while (cursor < containers.length) {
          const child = containers[cursor++] as (typeof containers)[number];
          try {
            const { value } = await storage.loadIndex(checked(child.id));
            if (value.sheets.length === 0) continue;
            result.push({
              container: child.id,
              title: value.title,
              created: value.created,
              modified: value.modified,
              creator: value.creator,
              sheetCount: value.sheets.length,
            });
          } catch {
            // A vanished, forbidden, or malformed child cannot hide readable workbooks.
          }
        }
      }),
    );
    return result.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }

  return {
    root,
    list,
    create,
    async createFromCsv({ title, csv, sheetName = "Sheet1" }) {
      const { csvToWorkbook } = await import("../univer-spike");
      return create({
        title,
        snapshot: csvToWorkbook("new", title, [
          { id: "sheet1", name: sheetName, csv },
        ]) as unknown as Snapshot,
      });
    },
    open,
    save,
    rename,
    async copy(container, title) {
      const { snapshot } = await open(container);
      return create({ title, snapshot: { ...snapshot, name: title } });
    },
    remove,
  };
}
