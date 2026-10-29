// AUTHORED-BY Codex GPT-6.1-Sol

/** Snapshot native internal slots before reading any caller-shadowable Request properties. */
export function snapshotRequest(input: Request, init?: RequestInit): Request {
  const capturedInit = captureInit(init, "direct");
  // A nonempty init resets these two fields unless explicitly carried forward.
  return new Request(input, {
    referrer: Reflect.get(Request.prototype, "referrer", input),
    referrerPolicy: Reflect.get(Request.prototype, "referrerPolicy", input),
    ...capturedInit,
  });
}

/**
 * Capture the target and effective request once, before validation or asynchronous work.
 * For Request inputs with `metadataOnly`, init is captured with spread semantics but not
 * applied: an own enumerable body key selects an empty placeholder so capturing metadata
 * never transfers or checks the body being replaced (even for null/undefined overrides).
 * That snapshot's body must not be forwarded; overlay snapshot.init after capture.
 * `discardBody` (with `metadataOnly`) always uses the placeholder, for callers that forward only the
 * URL and the caller's init, so the input body is never transferred or checked.
 * `forward` is for callers that pass the Request on with the caller's init, main's call shape
 * `fetch(request, init)`: the snapshot is taken without init (placeholder only when init.body is
 * non-null, Fetch's own replacement rule, so a nullish override still inherits the body) and the
 * caller's init is captured once with the boundary's required initSemantics. "spread" copies
 * own enumerable properties; "direct" reads known RequestInit members through ordinary Get,
 * including inherited/non-enumerable members. Forward snapshot.init, never the original init.
 */
export function snapshotFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { metadataOnly?: boolean; discardBody?: boolean } & (
    | { forward: true; initSemantics: "spread" | "direct" }
    | { forward?: false; initSemantics?: never }
  ),
): { input: string | Request; url: string; init: RequestInit | undefined; hadBody?: boolean } {
  const metadataOnly = options?.metadataOnly === true || options?.forward === true;
  const mode = options?.discardBody ? "discard" : options?.forward ? "constructor" : "spread";
  // Capture on every input path, before deciding whether the Request body is replaced.
  // Metadata-only URL+init boundaries historically spread options; effective Request
  // construction and direct forward boundaries use RequestInit's ordinary member lookup.
  const capturedInit = captureInit(
    init,
    options?.forward ? options.initSemantics : metadataOnly ? "spread" : "direct",
  );
  const forwardedInit = metadataOnly ? capturedInit : undefined;
  if (typeof input === "string") return { input, url: input, init: capturedInit };

  // Brand checks invoke native getters; instanceof and own properties are not trusted.
  try {
    const url: string = Reflect.get(URL.prototype, "href", input);
    return { input: url, url, init: capturedInit };
  } catch {
    // Another realm's URL may not share this implementation's internal slots.
  }
  let nativeRequest = false;
  try {
    Reflect.get(Request.prototype, "url", input);
    nativeRequest = true;
  } catch {
    // Other Request implementations must snapshot through their own constructor.
  }
  if (nativeRequest) {
    const request = snapshotRequest(
      input as Request,
      metadataOnly ? metadataInit(input, Request.prototype, capturedInit, mode) : capturedInit,
    );
    // The native getter reads the input's body slot without consuming it.
    const hadBody = Reflect.get(Request.prototype, "body", input) != null;
    return { input: request, url: request.url, init: forwardedInit, hadBody };
  }

  try {
    const prototype = Object.getPrototypeOf(input);
    const Ctor = prototype?.constructor;
    // Locate the prototype getter without ever inspecting input.url or input.constructor.
    let owner = prototype;
    while (owner) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, "url");
      if (descriptor) {
        if (descriptor.get && typeof Ctor === "function") {
          const request = new Ctor(
            input,
            metadataOnly ? metadataInit(input, owner, capturedInit, mode) : capturedInit,
          );
          const url = descriptor.get.call(request);
          if (typeof url === "string") {
            return {
              input: request,
              url,
              init: forwardedInit,
              hadBody: protoGet(owner, "body", input) != null,
            };
          }
        }
        break;
      }
      owner = Object.getPrototypeOf(owner);
    }
  } catch {
    // Failed construction/getters fall back to Fetch's string-input semantics.
  }

  const url = String(input);
  return { input: url, url, init: capturedInit };
}

/** Materialise the lookup semantics of the transport boundary, without converting bodies. */
function captureInit(
  init: RequestInit | undefined,
  semantics: "spread" | "direct",
): RequestInit | undefined {
  if (init == null) return undefined;
  if (semantics === "spread") return { ...init };
  const captured: Record<string, unknown> = {};
  // Fetch RequestInit members, plus the duplex/priority and undici dispatcher extensions.
  // Read each exactly once; undefined members are absent, as in dictionary conversion.
  for (const member of [
    "method",
    "headers",
    "body",
    "referrer",
    "referrerPolicy",
    "mode",
    "credentials",
    "cache",
    "redirect",
    "integrity",
    "keepalive",
    "signal",
    "duplex",
    "priority",
    "window",
    "dispatcher",
  ]) {
    const value = (init as Record<string, unknown>)[member];
    if (value !== undefined) captured[member] = value;
  }
  return captured as RequestInit;
}

/** Only the snapshot constructor's method matters; caller-shadowable fields are ignored. */
function metadataInit(
  input: RequestInfo | URL,
  prototype: object,
  init: RequestInit | undefined,
  mode: "spread" | "constructor" | "discard",
): RequestInit | undefined {
  // "spread": main spread the caller's init over the Request's fields, so any own body key
  // (even null/undefined) replaced the input body. "constructor": Fetch's Request constructor
  // replaces the body only for a non-null init.body. Capture metadata without touching a body
  // that is being replaced.
  if (mode === "spread" && !hasBodyOverride(init)) return undefined;
  if (mode === "constructor" && init?.body == null) return undefined;
  const method = Reflect.get(prototype, "method", input);
  // GET/HEAD inputs cannot carry a body. Leave init validation to the transport, as on main.
  if (method === "GET" || method === "HEAD") return undefined;
  // Fetch skips both transfer and the unusable-body check when a replacement is supplied.
  // Bytes avoid generating a Content-Type that could corrupt a later FormData boundary.
  // Never serialize or consume the caller's replacement body here.
  return { body: new ArrayBuffer(0) };
}

/** True when spreading `init` would replace the Request body (an own enumerable `body`). */
export function hasBodyOverride(init: RequestInit | undefined): boolean {
  return init != null && Object.prototype.propertyIsEnumerable.call(init, "body");
}

/** Invoke a prototype-chain getter on `target`, never an own property. */
function protoGet(start: object | null, name: string, target: unknown): unknown {
  for (let owner = start; owner; owner = Object.getPrototypeOf(owner)) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    if (descriptor) return descriptor.get?.call(target);
  }
  return undefined;
}
