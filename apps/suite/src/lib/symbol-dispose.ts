// AUTHORED-BY Claude Opus 5.5

/**
 * Explicit resource management (`using`) needs `Symbol.dispose`/`Symbol.asyncDispose`.
 * TypeScript compiles `using` in reactive-authentication to a helper that throws
 * "Symbol.dispose is not defined." when the engine lacks them, as Android System WebView
 * 124 does, so native sign-in failed after the authorization redirect. Define registered
 * symbols when the engine has none; engines with the built-ins are left untouched.
 */
export function ensureDisposeSymbols(target: SymbolConstructor = Symbol): void {
  for (const name of ["dispose", "asyncDispose"] as const) {
    if (typeof target[name] === "symbol") continue;
    Object.defineProperty(target, name, {
      value: Symbol.for(`Symbol.${name}`),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}
