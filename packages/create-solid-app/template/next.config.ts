import { createRequire } from "node:module";
import { dirname, sep } from "node:path";
import type { NextConfig } from "next";

// Resolve the SINGLE hoisted copy of Lit + the @lit/react adapter from this app's
// own node_modules, so every consumer (the @jeswr/solid-elements Web Components and
// their @lit/react wrappers) shares ONE Lit runtime + ONE @lit/react wrapper
// factory. This mirrors the vite pod-apps' `resolve.dedupe: ["lit","@lit/react"]`:
//   • two `lit` instances = two reactive-update schedulers + two attempts at the
//     same customElements registry (the components self-guard with
//     `customElements.get`, but two Lit runtimes are still a foot-gun), and
//   • a second `@lit/react` would mint a distinct wrapper runtime.
// `lit` + `@lit/react` are declared as DIRECT deps in package.json so npm hoists a
// single copy already; these aliases pin that copy for both the Turbopack (Next 16
// default) and webpack build paths as defense-in-depth, so a future transitive dep
// that also brings Lit can't introduce a second instance.
//
// We alias the package ROOT, NOT the entry file, and map BOTH the bare specifier
// AND its subpaths — Lit components commonly import subpaths (`lit/decorators.js`,
// `lit/directives/*`), so aliasing only the entry file would leave those subpaths
// free to resolve to a second nested copy.
//
// Finding the root is two-step because a package's `exports` map may NOT expose its
// own `package.json` (Lit's does not — `require.resolve("lit/package.json")` throws
// ERR_PACKAGE_PATH_NOT_EXPORTED). So: (1) try `<pkg>/package.json` (works when
// exported), else (2) resolve the entry and slice back to the installed
// `node_modules/<pkg>` directory. Both are wrapped so a layout where a name isn't
// present (or an unrecognised path shape) never breaks config eval — the alias is
// simply skipped, leaving npm's single hoisted copy to do the deduping on its own.
const req = createRequire(import.meta.url);
function packageRoot(name: string): string | undefined {
  try {
    return dirname(req.resolve(`${name}/package.json`));
  } catch {
    // `package.json` not exported — derive the root from the resolved entry by
    // slicing to the `node_modules/<name>` boundary (handles scoped names too).
    try {
      const entry = req.resolve(name);
      const boundary = `${sep}node_modules${sep}${name.split("/").join(sep)}`;
      const idx = entry.lastIndexOf(boundary);
      return idx >= 0 ? entry.slice(0, idx + boundary.length) : undefined;
    } catch {
      return undefined;
    }
  }
}
const litRoot = packageRoot("lit");
const litReactRoot = packageRoot("@lit/react");

// Turbopack (Next 16 default) resolveAlias: map the bare specifier to the package
// root, and the `<pkg>/*` glob to `<root>/*` so subpath imports dedupe too.
const turbopackAlias: Record<string, string> = {};
if (litRoot) {
  turbopackAlias["lit"] = litRoot;
  turbopackAlias["lit/*"] = `${litRoot}/*`;
}
if (litReactRoot) {
  turbopackAlias["@lit/react"] = litReactRoot;
  turbopackAlias["@lit/react/*"] = `${litReactRoot}/*`;
}

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: turbopackAlias,
  },
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = config.resolve.alias ?? {};
    const alias = config.resolve.alias as Record<string, string>;
    // Non-`$` (prefix) aliases: webpack matches the bare specifier AND every
    // subpath under it to the single package root, so `lit`, `lit/decorators.js`,
    // `@lit/react`, … all resolve to the one hoisted copy.
    if (litRoot) alias["lit"] = litRoot;
    if (litReactRoot) alias["@lit/react"] = litReactRoot;
    return config;
  },
};

export default nextConfig;
