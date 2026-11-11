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
import { createSheetStorage, type Snapshot, type WorkbookMetadata, workbookLayout } from "../model";
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
    derived: Record<string, string>,
    written?: Map<string, string | undefined>,
  ): Promise<Record<string, string>> {
    for (const sheet of sheets) {
      const urls = workbookLayout(container).sheet(sheet.number);
      const writes: [string, () => Promise<string | null>][] = [
        [urls.csv, () => storage.saveCsv(container, sheet.number, sheet.csv)],
        [urls.descriptor, () => storage.saveDescriptor(container, sheet.number, sheet.descriptor)],
      ];
      for (const [url, write] of writes) {
        const etag = await io.derived(url, async () => {
          const result = await write();
          written?.set(url, undefined);
          return result;
        });
        if (etag !== undefined) derived[url] = etag;
        written?.set(url, etag);
      }
    }
    return derived;
  }

  async function create(input: CreateWorkbookInput): Promise<OpenedWorkbook> {
    const { freshSnapshot, project } = await import("./projection");
    let snapshot = freshSnapshot(input.title, input.snapshot);
    if (snapshot.charts !== undefined)
      snapshot = (await import("../charts/spec")).validateChartSnapshot(snapshot);
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
      const written = new Map<string, string | undefined>();
      let indexPublished = false;
      let reservation: string;
      try {
        const etag = await storage.saveIndex(container, initial, { ifNoneMatch: "*" });
        written.set(layout.index, undefined);
        reservation = await io.indexEtag(container, initial, etag);
        written.set(layout.index, reservation);
      } catch (error) {
        if (hasStatus(error, 412)) continue;
        await rollback();
        throw error;
      }
      try {
        const etag = await storage.saveSnapshot(container, snapshot, { ifNoneMatch: "*" });
        written.set(layout.snapshot, undefined);
        const snapshotEtag = await io.snapshotEtag(container, snapshot, etag);
        written.set(layout.snapshot, snapshotEtag);
        const derived = await writeSheets(container, sheets, {}, written);
        const metadata = {
          ...initial,
          sheets: sheets.map(({ number, name }) => ({ number, name })),
        };
        const published = await io.authoritative(container, () =>
          storage.saveIndex(container, metadata, { ifMatch: reservation }),
        );
        // Once published, failed validator discovery must preserve the complete workbook.
        indexPublished = true;
        const indexEtag = await io.indexEtag(container, metadata, published);
        written.set(layout.index, indexEtag);
        await register();
        return { container, metadata, snapshot, version: { snapshotEtag, indexEtag, derived } };
      } catch (error) {
        if (!written.has(layout.snapshot) && hasStatus(error, 412)) {
          await storage.deleteResource(layout.index, { ifMatch: reservation }).catch(() => {});
          continue;
        }
        await rollback();
        throw error;
      }

      async function rollback() {
        if (indexPublished) return;
        // Reserving an index does not establish ownership of its container.
        // Check snapshot ownership before removing projections or the reservation.
        const derived = [...written.keys()].filter(
          (url) => url !== layout.snapshot && url !== layout.index,
        );
        for (const url of [layout.snapshot, ...derived, layout.index]) {
          const etag = written.get(url);
          if (etag === undefined) {
            // Written but its validator is unknown: ownership of the authoritative
            // snapshot or index cannot be established, so leave everything.
            if (written.has(url) && (url === layout.snapshot || url === layout.index)) return;
            continue;
          }
          try {
            await storage.deleteResource(url, { ifMatch: etag });
          } catch (error) {
            if (hasStatus(error, 412)) return;
          }
        }
        await io.remove(container).catch(() => {});
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
      if (hasStatus(error, 404) || hasStatus(error, 410))
        throw new WorkbookNotFoundError(container, "missing");
      if (hasStatus(error, 401) || hasStatus(error, 403))
        throw new WorkbookNotFoundError(container, "forbidden");
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
    if (snapshot.charts !== undefined)
      snapshot = (await import("../charts/spec")).validateChartSnapshot(snapshot);
    const layout = workbookLayout(container);
    if (!saveOptions.force) base = await io.verify(container, base);
    const previous = await storage.loadIndex(container);
    const previousIndexEtag = strongEtag(previous.etag, layout.index);
    if (!saveOptions.force && previousIndexEtag !== base.indexEtag)
      throw new WorkbookConflictError(container);
    const { project } = await import("./projection");
    const sheets = project(snapshot);
    const snapshotMatch = saveOptions.force
      ? await io.etag(layout.snapshot, null)
      : base.snapshotEtag;
    const publishedSnapshot = await io.authoritative(container, () =>
      storage.saveSnapshot(container, snapshot, { ifMatch: snapshotMatch }),
    );
    let snapshotEtag = base.snapshotEtag;
    let pendingVerification: WorkbookVersion["pendingVerification"] = { snapshot };
    const derived: Record<string, string> = {};
    let metadata: WorkbookMetadata = {
      ...previous.value,
      // index.ttl owns the title once created (rename writes it there); the engine
      // snapshot's own name is not kept in sync, so it never overrides a rename.
      title: saveOptions.title ?? previous.value.title,
      modified: now(),
      sheets: sheets.map(({ number, name }) => ({ number, name })),
    };
    let indexEtag = previousIndexEtag;
    try {
      snapshotEtag = await io.snapshotEtag(container, snapshot, publishedSnapshot);
      pendingVerification = undefined;
      await writeSheets(container, sheets, derived);
      for (let attempt = 0; ; attempt++) {
        let published: string | null;
        try {
          published = await storage.saveIndex(container, metadata, { ifMatch: indexEtag });
        } catch (error) {
          if (!hasStatus(error, 412)) throw error;
          const fresh = await storage.loadIndex(container);
          indexEtag = strongEtag(fresh.etag, layout.index);
          // Read the index BEFORE checking snapshot ownership. A newer save that
          // publishes its index before our PUT makes our If-Match fail. If it
          // publishes afterward, its If-Match fails and it reconciles its newer list.
          if ((await io.etag(layout.snapshot, null)) !== snapshotEtag)
            throw new WorkbookConflictError(container);
          if (attempt === 3) throw error;
          metadata = {
            ...fresh.value,
            title: saveOptions.title ?? fresh.value.title,
            sheets: metadata.sheets,
            modified: now(),
          };
          continue;
        }
        pendingVerification = { index: metadata };
        indexEtag = await io.indexEtag(container, metadata, published);
        pendingVerification = undefined;
        break;
      }
    } catch (error) {
      if (error instanceof WorkbookConflictError) throw error;
      throw new WorkbookPartialSaveError(
        {
          snapshotEtag,
          indexEtag,
          derived,
          ...(pendingVerification ? { pendingVerification } : {}),
        },
        error,
      );
    }
    // Listing also finds leftovers from a previous save whose cleanup failed.
    // Cleanup is best effort and must never turn a published save into a failure.
    const sheetRoot = new URL("sheets/", container).href;
    await storage.listContainer(sheetRoot).then(
      async (children) => {
        for (const child of children) {
          if (child.isContainer || !directChild(sheetRoot, child.id)) continue;
          const match = /^(\d+)\.(csv|jsonld)$/.exec(child.id.slice(sheetRoot.length));
          if (!match || Number(match[1]) <= sheets.length) continue;
          try {
            const etag = strongEtag(await storage.headEtag(child.id), child.id);
            const current = await storage.loadIndex(container);
            if (current.etag !== indexEtag) return;
            // A newer save can write a projection before HEAD and publish after
            // this index read. That projection may be briefly missing; the next
            // save restores it. If-Match protects writes made after HEAD.
            await io.remove(child.id, { ifMatch: etag });
          } catch {
            // Includes vanished resources and 412s from a newer projection.
          }
        }
      },
      () => {},
    );
    return { metadata, version: { snapshotEtag, indexEtag, derived } };
  }

  async function rename(
    container: string,
    title: string,
    base: WorkbookVersion,
  ): Promise<SaveResult> {
    container = checked(container);
    base = await io.verify(container, base);
    const index = await storage.loadIndex(container);
    const metadata = { ...index.value, title, modified: now() };
    const published = await io.authoritative(container, () =>
      storage.saveIndex(container, metadata, { ifMatch: base.indexEtag }),
    );
    try {
      const indexEtag = await io.indexEtag(container, metadata, published);
      return { metadata, version: { ...base, indexEtag } };
    } catch (error) {
      if (error instanceof WorkbookConflictError) throw error;
      throw new WorkbookPartialSaveError(
        { ...base, pendingVerification: { index: metadata } },
        error,
      );
    }
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
    async createFromXlsx({ title, data }) {
      const { readXlsx } = await import("../xlsx");
      return create({ title, snapshot: readXlsx(data, { title }) });
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
