/**
 * `true` when the @jeswr Solid browser extension is present on this page. Synchronous on the first
 * CLIENT render (no flash for the Vite CSR apps); under SSR + hydration (Next.js) it matches the
 * server snapshot (`false`) on first paint and flips right after hydration. Reactive if the
 * extension announces itself after mount. Built on `useSyncExternalStore` for correctness under
 * concurrent rendering.
 */
export declare function useSolidExtensionPresent(): boolean;
