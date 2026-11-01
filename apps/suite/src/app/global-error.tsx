// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <main>
          <h1>Something went wrong</h1>
          <button
            type="button"
            style={{ padding: "12px 24px", font: "inherit", cursor: "pointer" }}
            onClick={reset}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
