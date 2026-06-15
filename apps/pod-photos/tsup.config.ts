import { defineConfig } from 'tsup';

export default defineConfig({
  // Two entry points → two published surfaces:
  //   `@jeswr/pod-photos`     (the React-free data layer)
  //   `@jeswr/pod-photos/ui`  (the optional React photo-gallery view)
  // tsup preserves the directory layout under dist/ for a multi-entry build, so
  // the `./ui` export resolves to dist/ui/index.js (see package.json `exports`).
  entry: ['src/index.ts', 'src/ui/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // React is an OPTIONAL peer dependency — never bundled into the shipped view,
  // so a data-layer-only consumer pulls in no React.
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});
