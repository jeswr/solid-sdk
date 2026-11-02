// AUTHORED-BY Claude Opus 5.5
/** The plain-language page the signup consent checkbox links to (02-suite-shell §8.2). */
import type { Metadata } from "next";

export const metadata: Metadata = { title: "How your data is stored · Solid Suite" };
export default function Page() {
  return (
    <article>
      <h1>How your data is stored</h1>
      <p>Solid Suite keeps your things in a pod: your own space with the provider you choose.</p>
      <h2>Where your data lives</h2>
      <p>
        Your documents, files, tasks and settings are saved in your pod, with your provider. Solid
        Suite doesn't keep its own copy on a server.
      </p>
      <h2>Who can see it</h2>
      <p>
        Only you, until you share something. Apps and people ask before they read your data, and you
        can take access away at any time.
      </p>
      <h2>On this device</h2>
      <p>
        To work offline and open quickly, Solid Suite keeps copies of recent items in this browser.
        You can clear them in Settings, under Offline.
      </p>
      <h2>Your provider's terms</h2>
      <p>
        Your provider runs the computers your pod is stored on. Their terms and privacy notice say
        how they look after it and how to move or delete your account.
      </p>
      <p>
        <a href="/signup">Back to creating your account</a>
      </p>
    </article>
  );
}
