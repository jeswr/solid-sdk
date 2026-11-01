// AUTHORED-BY GPT-6.1-Sol (Codex)
/** Reconcile persisted MAIN registrations with the explicit origin grants on every wake/change. */
interface ScriptingApi {
  getRegisteredContentScripts(): Promise<Array<{ id: string; matches?: string[] }>>;
  registerContentScripts(scripts: chrome.scripting.RegisteredContentScript[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

export async function syncOriginFetchInjection(
  origins: readonly string[],
  scripting: ScriptingApi | undefined = globalThis.chrome?.scripting,
): Promise<boolean> {
  if (!scripting) return false;
  try {
    const wanted = new Map(
      origins.map((origin) => {
        const url = new URL(origin);
        // Chrome treats an omitted port as '*', including on canonical default-port origins.
        // Explicit :443/:80 also match port-less URLs (Chromium URLPattern Match17).
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        return [
          `solid-origin-${encodeURIComponent(origin)}`,
          `${url.protocol}//${url.hostname}:${port}/*`,
        ];
      }),
    );
    const existing = await scripting.getRegisteredContentScripts();
    const stale = existing.filter(
      (s) =>
        s.id === 'solid-main-world-inject' ||
        (s.id.startsWith('solid-origin-') &&
          (s.matches?.length !== 1 || s.matches[0] !== wanted.get(s.id))),
    );
    if (stale.length) await scripting.unregisterContentScripts({ ids: stale.map((s) => s.id) });
    const kept = new Set(existing.filter((s) => !stale.includes(s)).map((s) => s.id));
    const scripts = [...wanted]
      .filter(([id]) => !kept.has(id))
      .map(([id, match]) => ({
        id,
        matches: [match],
        js: ['inject/fetch-patch.js'],
        world: 'MAIN' as const,
        runAt: 'document_start' as const,
        persistAcrossSessions: true,
        allFrames: false,
      }));
    if (scripts.length) await scripting.registerContentScripts(scripts);
    return true;
  } catch {
    // A registration never grants authority; requests remain independently gated in the SW.
    return false;
  }
}
