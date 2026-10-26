// AUTHORED-BY Codex GPT-6.1-Sol
import { fixtureNames } from "./fixture-names";
export default function ComponentsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Component fixtures</h1>
      <p>Tokens and foundations for the suite.</p>
      <nav aria-label="Component fixtures">
        <a href="/dev/components/tokens">Tokens, typography and density</a>
        {fixtureNames.map((name) => (
          <a key={name} href={`/dev/components/${name}`}>
            {name}
          </a>
        ))}
        <a href="/dev/components/app-rail">AppRail</a>
        <a href="/dev/components/app-launcher">AppLauncher</a>
        <a href="/dev/components/bottom-tab-bar">BottomTabBar</a>
      </nav>
    </main>
  );
}
