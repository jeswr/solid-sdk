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

/** Capture the target and effective request once, before validation or asynchronous work. */
export function snapshotFetchInput(
  input: RequestInfo | URL,
  init?: RequestInit,
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
    const request = snapshotRequest(input as Request, init);
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
          const request = new Ctor(input, init);
          const url = descriptor.get.call(request);
          if (typeof url === "string") {
            // Foreign Request brands are not portable between fetch implementations.
            // Read only prototype getters from the merged snapshot, then send the
            // checked string and a plain init that any transport can construct.
            const captured: Record<string, unknown> = {};
            for (const field of [
              "method",
              "headers",
              "body",
              "signal",
              "credentials",
              "mode",
              "cache",
              "redirect",
              "referrer",
              "referrerPolicy",
              "integrity",
              "keepalive",
            ]) {
              let fieldOwner = prototype;
              while (fieldOwner) {
                const fieldDescriptor = Object.getOwnPropertyDescriptor(fieldOwner, field);
                if (fieldDescriptor) {
                  const value = fieldDescriptor.get?.call(request);
                  if (value !== undefined) {
                    captured[field] = field === "headers" ? new Headers(value) : value;
                  }
                  break;
                }
                fieldOwner = Object.getPrototypeOf(fieldOwner);
              }
            }
            if (captured.body != null) captured.duplex = "half";
            return { input: url, url, init: captured as RequestInit };
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
