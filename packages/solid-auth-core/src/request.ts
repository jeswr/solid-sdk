// AUTHORED-BY Codex GPT-6

const REQUEST_PROTOTYPE = Request.prototype;
const URL_GETTER = Object.getOwnPropertyDescriptor(REQUEST_PROTOTYPE, "url")?.get as () => string;

/** Preserve caller settings when deriving a request, including when changing URL. */
export function deriveRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
  destination?: URL,
): Request {
  if (!(input instanceof Request)) return new Request(input, init);
  // Request reconstruction can reset referrer/referrerPolicy even without init.
  // Keep all caller-controlled settings together; only explicit overrides change them.
  // The constructor transfers the source body unless init replaces it. Retargeted
  // hops supply their replay buffer (or null on GET rewrites) through init.body.
  return new Request(destination ?? input, {
    ...init,
    method: init?.method ?? input.method,
    headers: init?.headers ?? input.headers,
    redirect: init?.redirect ?? input.redirect,
    referrer: init?.referrer ?? input.referrer,
    referrerPolicy: init?.referrerPolicy ?? input.referrerPolicy,
    mode: init?.mode ?? input.mode,
    credentials: init?.credentials ?? input.credentials,
    cache: init?.cache ?? input.cache,
    integrity: init?.integrity ?? input.integrity,
    keepalive: init?.keepalive ?? input.keepalive,
    signal: init?.signal === undefined ? input.signal : init.signal,
    priority: init?.priority ?? (input as Request & Pick<RequestInit, "priority">).priority,
  });
}

/** Read the platform destination, bypassing own properties and subclass getters. */
export function requestHref(input: Request): string | undefined {
  try {
    return Reflect.apply(URL_GETTER, input, []) as string;
  } catch {
    // Request-like objects and Requests with an incompatible realm's brand are public.
    return undefined;
  }
}

// Same-realm hostile code mutating Undici's private state through internal symbols is
// out of scope: such code can already read the token from memory.
