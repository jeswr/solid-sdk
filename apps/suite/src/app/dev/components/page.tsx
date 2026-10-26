// AUTHORED-BY Codex GPT-6.1-Sol
export default function ComponentsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Component fixtures</h1>
      <p>Tokens and foundations for the suite.</p>
      <nav aria-label="Component fixtures">
        <ul>
          <li>
            <a href="/dev/components/tokens">Tokens, typography and density</a>
          </li>
          <li>
            <a href="/dev/components/shell">Responsive shell layout</a>
          </li>
          <li>
            <a href="/dev/components/top-bar">TopBar slots</a>
          </li>
          <li>
            <a href="/dev/components/sidebar-nav">Sidebar navigation</a>
          </li>
          <li>
            <a href="/dev/components/details-pane">Details pane and states</a>
          </li>
        </ul>
      </nav>
    </main>
  );
}
