// JSX typing for the <authorization-code-flow> custom element shipped by
// @solid/reactive-authentication, so it can be used in TSX WITHOUT an
// `@ts-expect-error` (house rule: never silence type errors).
//
// React 19 reads intrinsic-element types from `React.JSX.IntrinsicElements`.
import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";
import type { AuthorizationCodeFlow } from "@solid/reactive-authentication";

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
