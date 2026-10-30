// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { fixtureNames } from "./fixture-names";
export default function ComponentsPage() {
  return (
    <main id="main-content" tabIndex={-1} className="fixture-page">
      <p className="eyebrow">Solid Suite · Design system</p>
      <h1>Component fixtures</h1>
      <p>Tokens, foundations and shared components for the suite.</p>
      <nav aria-label="Component fixtures" className="grid gap-3">
        <a href="/dev/components/tokens">Tokens, typography and density</a>
        <a href="/dev/components/date-time-field">DateTimeField</a>
        <a href="/dev/components/date-picker-popover">DatePickerPopover</a>
        <a href="/dev/components/recurrence-editor">RecurrenceEditor</a>
        {fixtureNames.map((name) => (
          <a key={name} href={`/dev/components/${name}`}>
            {name}
          </a>
        ))}
        <a href="/dev/components/data-table">DataTable</a>
        <a href="/dev/components/file-grid">FileGrid</a>
        <a href="/dev/components/toolbar">Toolbar</a>
        <a href="/dev/components/filter-chips">Filter chips</a>
        <a href="/dev/components/breadcrumbs">Breadcrumbs</a>
        <a href="/dev/components/editable-text">Editable text</a>
        <a href="/dev/components/tag-input">Tag input</a>
        <a href="/dev/components/upload-dock">UploadDock</a>
        <a href="/dev/components/drop-zone-overlay">DropZoneOverlay</a>
        <a href="/dev/components/preview-pane">PreviewPane</a>
        <a href="/dev/components/typed-view">Typed views</a>
        <a href="/dev/components/item-details">Item details</a>
        <a href="/dev/components/pod-meter">Pod meter</a>
        <a href="/dev/components/app-rail">AppRail</a>
        <a href="/dev/components/app-launcher">AppLauncher</a>
        <a href="/dev/components/bottom-tab-bar">BottomTabBar</a>
        <a href="/dev/components/shell">Responsive shell layout</a>
        <a href="/dev/components/top-bar">TopBar slots</a>
        <a href="/dev/components/sidebar-nav">Sidebar navigation</a>
        <a href="/dev/components/details-pane">Details pane and states</a>
      </nav>
    </main>
  );
}
