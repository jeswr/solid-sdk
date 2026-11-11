// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// JSX typing for @jeswr/reactive-authentication/elements's <authorization-code-flow>
// custom element, so React's JSX accepts it. The element instance type comes
// from the package; we expose its `ref` + the minimal HTML attributes used here.
import type { AuthorizationCodeFlow } from "@jeswr/reactive-authentication/elements";
import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "authorization-code-flow": DetailedHTMLProps<
        HTMLAttributes<AuthorizationCodeFlow> & { ref?: Ref<AuthorizationCodeFlow> },
        AuthorizationCodeFlow
      >;
    }
  }
}
