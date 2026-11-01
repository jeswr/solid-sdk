// AUTHORED-BY Codex GPT-6

const REQUEST_PROTOTYPE = Request.prototype;
const URL_GETTER = Object.getOwnPropertyDescriptor(REQUEST_PROTOTYPE, "url")?.get as () => string;

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
