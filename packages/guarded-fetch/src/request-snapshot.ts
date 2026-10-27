// AUTHORED-BY Codex GPT-6.1-Sol

/** Snapshot native internal slots before reading any caller-shadowable Request properties. */
export function snapshotRequest(input: Request, init?: RequestInit): Request {
  // A nonempty init resets these two fields unless explicitly carried forward.
  return new Request(input, {
    referrer: Reflect.get(Request.prototype, "referrer", input),
    referrerPolicy: Reflect.get(Request.prototype, "referrerPolicy", input),
    ...init,
  });
}

/**
 * Capture the target and effective request once, before validation or asynchronous work.
 * For Request inputs with `metadataOnly`, init is not applied: a non-null init.body selects an empty
 * placeholder so capturing metadata never transfers or checks the body being replaced.
 * That snapshot's body must not be forwarded; overlay the caller's init after capture.
 * `discardBody` (with `metadataOnly`) always uses the placeholder, for callers that forward only the
 * URL and the caller's init, so the input body is never transferred or checked.
 * `forward` is for callers that pass the Request on with the caller's init, main's call shape
 * `fetch(request, init)`: the snapshot is taken without init (placeholder only when init.body is
 * non-null, Fetch's own replacement rule, so a nullish override still inherits the body) and the
 * caller's init is returned as an own-enumerable copy (what a spread forwards) for the caller to
 * forward alongside it.
 */
export function snapshotFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { metadataOnly?: boolean; discardBody?: boolean; forward?: boolean },
): { input: string | Request; url: string; init: RequestInit | undefined; hadBody?: boolean } {
  if (typeof input === "string") return { input, url: input, init };
  const metadataOnly = options?.metadataOnly === true || options?.forward === true;
  const mode = options?.discardBody ? "discard" : options?.forward ? "constructor" : "spread";
  // Forward mode hands back an own-enumerable copy of init, and decides body replacement from
  // that same copy, so the placeholder decision always matches what is actually forwarded.
  const forwardedInit = options?.forward && init ? { ...init } : undefined;
  const captureInit = options?.forward ? forwardedInit : init;

  // Brand checks invoke native getters; instanceof and own properties are not trusted.
  try {
    const url: string = Reflect.get(URL.prototype, "href", input);
    return { input: url, url, init };
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
      metadataOnly ? metadataInit(input, Request.prototype, captureInit, mode) : init,
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
            metadataOnly ? metadataInit(input, owner, captureInit, mode) : init,
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
  return { input: url, url, init };
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
