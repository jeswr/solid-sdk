// AUTHORED-BY Codex GPT-6.1-Sol
import { I18nProvider } from "@jeswr/suite-i18n/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { HomeHeader } from "../src/apps/home/components/home-header";

it.each([
  ["09", "Alice Wilder", "Buenos días, Alice"],
  ["13", "Alice Wilder", "Buenas tardes, Alice"],
  ["20", "Alice Wilder", "Buenas noches, Alice"],
  ["02", "", "Buenas noches"],
  ["09", "", "Buenos días"],
  ["13", "", "Buenas tardes"],
])("translates the Home headings at %s for %s", (hour, displayName, expected) => {
  const html = renderToStaticMarkup(
    <I18nProvider locale="es">
      <HomeHeader
        displayName={displayName}
        now={Date.parse(`2026-11-01T${hour}:00:00Z`)}
        items={[]}
        used={1024}
        status="ready"
        onRetry={() => {}}
      />
    </I18nProvider>,
  );
  expect(html).toContain(expected);
  expect(html).toContain("Tu pod");
});
