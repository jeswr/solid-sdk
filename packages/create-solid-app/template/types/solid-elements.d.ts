// JSX typing for the custom elements this app mounts in TSX WITHOUT an
// `@ts-expect-error` (house rule: never silence type errors):
//   • <authorization-code-flow> from @solid/reactive-authentication (login flow), and
//   • <jeswr-loading> from @jeswr/solid-elements (the suite wait-state spinner).
//
// React 19 reads intrinsic-element types from `React.JSX.IntrinsicElements`.
//
// THE RAW-ELEMENT FORM for <jeswr-loading> (over the @lit/react `<Loading label>`
// wrapper): for a CONTEXTUAL label, set the `label` ATTRIBUTE on the raw element
// (`<jeswr-loading label="…">`). The @lit/react wrapper sets `label` as a PROPERTY
// via a useLayoutEffect that @lit/react's `node` export condition (which Vitest's
// Node runtime + some SSR paths resolve) DELIBERATELY skips — so the wrapper drops
// the label in those modes, while the raw-attribute path always reflects it (the WC
// renders + reflects the `label` attribute; df0fbe4 `reflect: true`). So the raw
// form is the reliable way to get a contextual label rendered. Registering the
// element is a side effect of `import "@jeswr/solid-elements/react"` (the component
// modules self-`customElements.define`); no @inrupt / hand-rolled spinner.
import type { JeswrLoading } from "@jeswr/solid-elements";
import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";
import type { AuthorizationCodeFlow } from "@solid/reactive-authentication";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "authorization-code-flow": DetailedHTMLProps<
        HTMLAttributes<AuthorizationCodeFlow> & { ref?: Ref<AuthorizationCodeFlow> },
        AuthorizationCodeFlow
      >;
      "jeswr-loading": DetailedHTMLProps<
        HTMLAttributes<JeswrLoading> & { label?: string; ref?: Ref<JeswrLoading> },
        JeswrLoading
      >;
    }
  }
}
