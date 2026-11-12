// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createI18nReact, I18nProvider, useFormatters, useLocale, useT } from "../src/react.js";

afterEach(cleanup);
function Content() {
  const t = useT();
  const locale = useLocale();
  const f = useFormatters();
  return (
    <p>
      {locale}: {t("apps.home")} / {f.number(1234)}
    </p>
  );
}
it("defaults to English, updates on locale changes and scopes nested providers", () => {
  const view = render(<Content />);
  expect(screen.getByText(/^en: Home/)).toBeTruthy();
  view.rerender(
    <I18nProvider locale="es">
      <Content />
      <I18nProvider locale="ar">
        <Content />
      </I18nProvider>
    </I18nProvider>,
  );
  expect(screen.getByText(/^es: Inicio/)).toBeTruthy();
  expect(screen.getByText(/^ar: الرئيسية/)).toBeTruthy();
  view.rerender(
    <I18nProvider locale="de">
      <Content />
    </I18nProvider>,
  );
  expect(screen.getByText(/^de: Startseite/)).toBeTruthy();
});
it("provides typed bindings for an app's own catalog", () => {
  const bindings = createI18nReact({
    english: { welcome: "Hello {name}" },
    catalogs: { fr: { welcome: "Bonjour {name}" } },
  });
  function Custom() {
    const t = bindings.useT();
    return <p>{t("welcome", { name: "Ada" })}</p>;
  }
  render(
    <bindings.I18nProvider locale="fr">
      <Custom />
    </bindings.I18nProvider>,
  );
  expect(screen.getByText("Bonjour Ada")).toBeTruthy();
});
