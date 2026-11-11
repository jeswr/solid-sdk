// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import {
  type PageData,
  PublicationError,
  type PublishRepository,
  type SiteData,
  type StoredPage,
  type StoredSite,
} from "@jeswr/solid-publish";

export interface PublishData {
  sites: StoredSite[];
  pages: Record<string, StoredPage[]>;
  invalid: { url: string }[];
}
export interface PublishSnapshot extends PublishData {
  status: "loading" | "ready" | "error";
  pending: number;
  error: string | null;
}
type Change = (data: PublishData) => PublishData;
export function createPublishWorkspace(
  repository: PublishRepository,
  root: string,
  failure: (message: string) => void,
) {
  let baseline: PublishData = { sites: [], pages: {}, invalid: [] };
  let pending: { id: number; preview: Change }[] = [];
  let snapshot: PublishSnapshot = { ...baseline, status: "loading", pending: 0, error: null };
  let generation = 0;
  let nextId = 0;
  let active = true;
  let queue = Promise.resolve();
  const listeners = new Set<() => void>();
  function emit(status = snapshot.status, error = snapshot.error) {
    if (!active) return;
    const visible = pending.reduce((value, change) => change.preview(value), baseline);
    snapshot = { ...visible, status, pending: pending.length, error };
    for (const listener of listeners) listener();
  }
  const site = (url: string) => {
    const found = baseline.sites.find((entry) => entry.url === url);
    if (!found) throw new PublicationError("This site has not been saved. Reload and try again.");
    return found;
  };
  const page = (siteUrl: string, url: string) => {
    const found = baseline.pages[siteUrl]?.find((entry) => entry.url === url);
    if (!found) throw new PublicationError("This page has not been saved. Reload and try again.");
    return found;
  };
  const replaceSite = (data: PublishData, value: StoredSite): PublishData => ({
    ...data,
    sites: [...data.sites.filter((s) => s.url !== value.url), value],
  });
  const replacePage = (data: PublishData, siteUrl: string, value: StoredPage): PublishData => ({
    ...data,
    pages: {
      ...data.pages,
      [siteUrl]: [...(data.pages[siteUrl] ?? []).filter((p) => p.url !== value.url), value].sort(
        (a, b) => a.data.position - b.data.position,
      ),
    },
  });
  async function load() {
    active = true;
    if (pending.length) return;
    const version = ++generation;
    try {
      const { items: sites, invalid: siteInvalid } = await repository.listSites();
      const invalid = [...siteInvalid];
      const pages: PublishData["pages"] = {};
      for (const value of sites) {
        const listing = await repository.listPages(value);
        pages[value.url] = listing.items;
        invalid.push(...listing.invalid);
      }
      if (!active || version !== generation || pending.length) return;
      baseline = { sites, pages, invalid };
      emit("ready", null);
    } catch (error) {
      if (active && version === generation)
        emit(
          baseline.sites.length ? "ready" : "error",
          error instanceof PublicationError
            ? error.message
            : "Couldn't open Publish. Reconnect or check your pod permissions, then retry.",
        );
    }
  }
  const navigation = typeof window === "undefined" ? undefined : window;
  function beforeUnload(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = "";
  }
  function beforeNavigate(event: MouseEvent) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor =
      event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target.toLowerCase() !== "_self")
    )
      return;
    const target = new URL(anchor.href);
    const current = new URL(navigation?.location.href ?? anchor.href);
    if (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search
    )
      return;
    if (!navigation?.confirm("Changes are still saving to your pod. Leave this page?")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function guardNavigation(on: boolean) {
    if (on) {
      navigation?.addEventListener("beforeunload", beforeUnload);
      navigation?.document.addEventListener("click", beforeNavigate, true);
    } else {
      navigation?.removeEventListener("beforeunload", beforeUnload);
      navigation?.document.removeEventListener("click", beforeNavigate, true);
    }
  }
  function mutate(preview: Change, persist: () => Promise<void>): Promise<boolean> {
    const id = ++nextId;
    ++generation;
    pending = [...pending, { id, preview }];
    guardNavigation(true);
    emit("ready", null);
    const task = queue.then(async () => {
      try {
        await persist();
        return true;
      } catch (error) {
        const message =
          error instanceof PublicationError || error instanceof TypeError
            ? error.message
            : "Couldn't save this change. Your editor draft is still on this device. Reload before trying again.";
        // The provider supplies the shell's global toast, which survives route unmount.
        failure(message);
        if (active) snapshot = { ...snapshot, error: message };
        return false;
      } finally {
        pending = pending.filter((item) => item.id !== id);
        if (!pending.length) guardNavigation(false);
        emit();
      }
    });
    queue = task.then(() => {});
    return task;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    dispose() {
      active = false;
      ++generation;
      listeners.clear();
    },
    createSite(key: string, data: SiteData) {
      const url = new URL(`publish/${key}/site.ttl`, root).href;
      const optimistic: StoredSite = { url, etag: "", data };
      return {
        url,
        saved: mutate(
          (value) => replaceSite(value, optimistic),
          async () => {
            baseline = replaceSite(baseline, await repository.createSite(key, data));
          },
        ),
      };
    },
    createPage(siteUrl: string, id: string, data: PageData) {
      const url = new URL(`pages/${id}.ttl`, siteUrl).href;
      const optimistic: StoredPage = { url, etag: "", data };
      return {
        url,
        saved: mutate(
          (value) => replacePage(value, siteUrl, optimistic),
          async () => {
            baseline = replacePage(
              baseline,
              siteUrl,
              await repository.createPage(site(siteUrl), id, data),
            );
          },
        ),
      };
    },
    savePage(
      siteUrl: string,
      url: string,
      data: PageData,
      mode: "draft" | "publish" | "unpublish",
      confirmed = false,
    ) {
      const patch = {
        ...data,
        status:
          mode === "publish"
            ? ("published" as const)
            : mode === "unpublish"
              ? ("draft" as const)
              : data.status,
      };
      return mutate(
        (value) => {
          const original = value.pages[siteUrl]?.find((p) => p.url === url);
          return original ? replacePage(value, siteUrl, { ...original, data: patch }) : value;
        },
        async () => {
          const currentSite = site(siteUrl);
          const currentPage = page(siteUrl, url);
          if (mode === "draft")
            baseline = replacePage(
              baseline,
              siteUrl,
              await repository.savePage(currentSite, currentPage, data),
            );
          else {
            const result =
              mode === "publish"
                ? await repository.publish(currentSite, currentPage, data, confirmed)
                : await repository.unpublish(currentSite, currentPage);
            baseline = replacePage(replaceSite(baseline, result.site), siteUrl, result.page);
          }
        },
      );
    },
    settings(url: string, data: SiteData) {
      return mutate(
        (value) => {
          const current = value.sites.find((s) => s.url === url);
          if (!current) return value;
          const settings = { ...data };
          // Publication belongs to the confirmed site, even when this form predates it.
          if (current.data.publicUrl) settings.publicUrl = current.data.publicUrl;
          else delete settings.publicUrl;
          return replaceSite(value, { ...current, data: settings });
        },
        async () => {
          let saved = await repository.saveSite(site(url), data);
          if (saved.data.publicUrl) saved = await repository.refreshPublic(saved);
          baseline = replaceSite(baseline, saved);
        },
      );
    },
    reorder(siteUrl: string, ordered: readonly string[]) {
      const pageUrls = new Set(
        (snapshot.pages[siteUrl] ?? []).filter((p) => p.data.kind === "page").map((p) => p.url),
      );
      const pageOrder = ordered.filter((url) => pageUrls.has(url));
      const positions = new Map(pageOrder.map((url, position) => [url, position]));
      const apply: Change = (value) => ({
        ...value,
        pages: {
          ...value.pages,
          [siteUrl]: (value.pages[siteUrl] ?? [])
            .map((entry) => ({
              ...entry,
              data: { ...entry.data, position: positions.get(entry.url) ?? entry.data.position },
            }))
            .sort((a, b) => a.data.position - b.data.position),
        },
      });
      return mutate(apply, async () => {
        for (const url of pageOrder) {
          const current = page(siteUrl, url);
          const position = positions.get(url) as number;
          if (position !== current.data.position)
            baseline = replacePage(
              baseline,
              siteUrl,
              await repository.savePage(site(siteUrl), current, { ...current.data, position }),
            );
        }
        const currentSite = site(siteUrl);
        if (currentSite.data.publicUrl)
          baseline = replaceSite(baseline, await repository.refreshPublic(currentSite));
      });
    },
  };
}
export type PublishWorkspace = ReturnType<typeof createPublishWorkspace>;
