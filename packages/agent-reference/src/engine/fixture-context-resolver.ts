// AUTHORED-BY Codex GPT-6.2 Sol

interface ActiveContext {
  clone(): ActiveContext;
  mappings: ReadonlyMap<string, unknown>;
  previousContext?: ActiveContext | undefined;
}

interface ResolveOptions {
  activeCtx: ActiveContext;
}

type ContextResolverConstructor = new (options: {
  sharedCache: Map<string, unknown>;
}) => {
  resolve(options: ResolveOptions): Promise<unknown>;
};

const emptyMappings = new Map<string, unknown>();
// Only the pinned loader's contexts and their finite set of scopes enter this cache.
const sharedCache = new Map<string, unknown>();
let cloneForFixture: ActiveContext["clone"] | undefined;
let resolverConstructor: Promise<ContextResolverConstructor | undefined> | undefined;

function loadResolver() {
  // @ts-expect-error The internal resolver is outside the @types/jsonld API.
  resolverConstructor ??= import("jsonld/lib/ContextResolver.js").then(
    ({ default: Resolver }: { default?: ContextResolverConstructor }) =>
      typeof Resolver === "function" && typeof Resolver.prototype?.resolve === "function"
        ? Resolver
        : undefined,
    () => undefined,
  );
  return resolverConstructor;
}

function hasNonStringContext(document: unknown): boolean {
  const pending = [document];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if ("@context" in node && typeof node["@context"] !== "string") return true;
    for (const child of Object.values(node)) {
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return false;
}

function shallowClone(original: ActiveContext["clone"]): ActiveContext["clone"] {
  return function (this: ActiveContext) {
    // Let jsonld copy its metadata and preserve its previous-context semantics.
    // Setting a term affects only the new map's entry.
    const child = original.call({
      ...this,
      mappings: emptyMappings,
      previousContext: undefined,
    });
    child.mappings = new Map(this.mappings);
    if (this.previousContext) child.previousContext = this.previousContext.clone();
    return child;
  };
}

/** Keep jsonld's per-read resolver and share immutable term definitions when cloning. */
export async function fixtureContextResolver(document: unknown) {
  // Opaque JSON can contain arbitrary inline contexts. Use jsonld's default
  // resolver for those documents as well as authoring files with context arrays.
  if (hasNonStringContext(document)) return undefined;
  const ContextResolver = await loadResolver();
  if (!ContextResolver) return undefined;
  const resolver = new ContextResolver({ sharedCache });

  return {
    resolve(options: ResolveOptions) {
      const { activeCtx } = options;
      cloneForFixture ??= shallowClone(activeCtx.clone);
      // The empty initial context belongs to jsonld and is shared with the wire reader.
      if (activeCtx.mappings.size > 0) activeCtx.clone = cloneForFixture;
      return resolver.resolve(options);
    },
  };
}
