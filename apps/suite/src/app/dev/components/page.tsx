// AUTHORED-BY Codex GPT-6.1-Sol
export default function ComponentsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Component fixtures</h1>
      <p>Tokens and foundations for the suite.</p>
      <nav aria-label="Component fixtures" className="grid gap-3">
        <a href="/dev/components/tokens">Tokens, typography and density</a>
        <a href="/dev/components/upload-dock">UploadDock</a>
        <a href="/dev/components/drop-zone-overlay">DropZoneOverlay</a>
        <a href="/dev/components/preview-pane">PreviewPane</a>
      </nav>
    </main>
  );
}
