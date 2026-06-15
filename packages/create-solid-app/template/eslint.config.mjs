import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // SOLID HOUSE RULES — enforced as lint errors so an AI builder cannot drift:
  //  - Never @inrupt/* (use @solid/reactive-authentication + @solid/object).
  //  - Never inline rdf-parse / rdf-serialize — fetch+parse via @jeswr/fetch-rdf,
  //    read/write via @solid/object + @rdfjs/wrapper. The n3 parser is allowed
  //    only inside lib/solid/ (the data layer), via the override below.
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@inrupt/*"],
              message:
                "House rule: never use @inrupt packages. Auth = @solid/reactive-authentication; data = @solid/object + @rdfjs/wrapper.",
            },
            {
              group: ["rdf-parse", "rdf-serialize"],
              message:
                "House rule: do not inline rdf-parse/rdf-serialize. Fetch+parse via @jeswr/fetch-rdf; model data via @solid/object + @rdfjs/wrapper.",
            },
          ],
          paths: [
            {
              name: "n3",
              importNames: ["Parser", "Writer"],
              message:
                "House rule: don't hand-parse/serialise RDF. Use @jeswr/fetch-rdf + @solid/object. (DataFactory from n3 is fine.)",
            },
          ],
        },
      ],
    },
  },
  // The data layer may import the n3 Parser/Writer if it ever needs to; nothing
  // in this template does, but keep the boundary explicit.
  {
    files: ["lib/solid/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);

export default eslintConfig;
