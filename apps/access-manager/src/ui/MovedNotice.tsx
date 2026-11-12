// AUTHORED-BY Claude Opus 5.5
// Shown while the browser follows the redirect, and as a fallback link if it doesn't.

export function MovedNotice({ href }: { href: string }) {
  return (
    <main className="moved-notice">
      <h1>Access Manager is now part of Solid Suite</h1>
      <p>Access requests, their history and everything you share now live in Permissions.</p>
      <p>
        <a href={href}>Open Permissions in Solid Suite</a>
      </p>
    </main>
  );
}
