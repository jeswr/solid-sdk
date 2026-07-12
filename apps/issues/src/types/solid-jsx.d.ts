import type React from "react";

// The <authorization-code-flow> custom element is registered as a side effect of
// importing @solid/reactive-authentication. The library does not augment the JSX
// namespace, so declare it once here (React 19 form — the JSX namespace lives in
// the `react` module, not the global). See AGENTS.md §Authentication.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "authorization-code-flow": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}
