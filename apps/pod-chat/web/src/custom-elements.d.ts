// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// JSX typing for @solid/reactive-authentication's <authorization-code-flow>
// custom element, so React's JSX accepts it. The element instance type comes
// from the package; we expose its `ref` + the minimal HTML attributes used here.
import type { AuthorizationCodeFlow } from "@solid/reactive-authentication";
import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "authorization-code-flow": DetailedHTMLProps<
        HTMLAttributes<AuthorizationCodeFlow> & { ref?: Ref<AuthorizationCodeFlow> },
        AuthorizationCodeFlow
      >;
      // @jeswr/solid-elements <jeswr-loading> as a RAW custom element, so the host
      // can pass `label` as a real DOM ATTRIBUTE (the Lit reactive property
      // auto-observes the lowercased `label` attr). We render it directly rather than
      // through the @lit/react `Loading` wrapper because that wrapper's PROPERTY
      // forwarding is unreliable under React 19 (it classifies props at
      // createComponent-time, before Lit finalises the element class — so `label`
      // can silently fall through and the visible + announced copy is lost). The
      // attribute path is environment-independent and verified. (See App.tsx.)
      "jeswr-loading": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { label?: string },
        HTMLElement
      >;
    }
  }
}
