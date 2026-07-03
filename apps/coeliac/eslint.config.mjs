// eslint-config-next 16 ships native flat configs (arrays) — imported directly;
// the old FlatCompat/eslintrc bridge no longer applies (and `next lint` is gone,
// so `eslint .` runs the CLI directly).
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // `eslint .` (unlike the removed `next lint` wrapper) walks the whole tree,
  // so ignore build output + reports explicitly.
  {
    ignores: [
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default eslintConfig;
