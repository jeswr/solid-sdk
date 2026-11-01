// AUTHORED-BY Codex GPT-6.1-Sol
import { AppIcon, Button } from "@jeswr/suite-ui";
export default function NotFound() {
  return (
    <main id="main-content" className="shell-error-page">
      <AppIcon app="home" size={48} decorative />
      <h1>We couldn't find that page</h1>
      <div className="shell-error-actions">
        <Button asChild>
          <a href="/home">Go to Home</a>
        </Button>
        <Button asChild variant="outline">
          <a href="/search">Search</a>
        </Button>
      </div>
    </main>
  );
}
