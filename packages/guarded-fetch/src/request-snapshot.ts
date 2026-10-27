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
 */
export function snapshotFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { metadataOnly?: boolean },
): { input: string | Request; url: string; init: RequestInit | undefined } {
  if (typeof input === "string") return { input, url: input, init };

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
      options?.metadataOnly ? metadataInit(input, Request.prototype, init) : init,
    );
    return { input: request, url: request.url, init: undefined };
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
            options?.metadataOnly ? metadataInit(input, owner, init) : init,
          );
          const url = descriptor.get.call(request);
          if (typeof url === "string") return { input: request, url, init: undefined };
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
): RequestInit | undefined {
  if (init?.body == null) return undefined;
  const method = Reflect.get(prototype, "method", input);
  // GET/HEAD inputs cannot carry a body. Leave init validation to the transport, as on main.
  if (method === "GET" || method === "HEAD") return undefined;
  // Fetch skips both transfer and the unusable-body check when a replacement is supplied.
  // Bytes avoid generating a Content-Type that could corrupt a later FormData boundary.
  // Never serialize or consume the caller's replacement body here.
  return { body: new ArrayBuffer(0) };
}
