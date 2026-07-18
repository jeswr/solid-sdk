import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import { app } from "../lib/walkthrough";

/**
 * Placeholder surface for this ecosystem seat. Its name, role framing, theme, and
 * honesty content all come from the registry entry in
 * apps/tour/content/walkthrough.json — edit the document, not this file, until you
 * replace this page with the app's real scenes.
 */
export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">{app.appName}</h1>
        <p className="mt-2 text-muted-foreground">
          Placeholder surface for the {app.appName} seat, modelled on {app.modelledOn}. Replace this
          page with the scenes this app plays in the walkthrough.
        </p>
      </header>
      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            {honesty.real.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            {honesty.simulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
      />
    </main>
  );
}
