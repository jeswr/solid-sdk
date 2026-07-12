// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// CatalogView — the human (text/html) rendering of the SAME catalog data that the
// generated catalog.ttl / catalog.jsonld serialise. Reached via the `#/catalog`
// deep-link, so the text/html representation of the catalog IRI is meaningful: a
// styled table of every listing with its category, status, deploy URL, repo, and a
// link to the machine representations. (On the static box, Caddy Accept-routes the
// `/catalog` IRI to catalog.ttl / catalog.jsonld for RDF clients, and to this view's
// index.html for text/html — see the README deploy notes.)
import { type AppEntry, CATEGORY_ORDER } from "../lib/catalog";

export function CatalogView({ apps }: { apps: AppEntry[] }) {
  return (
    <main className="catalog-view">
      <h1>Solid App Store — catalog</h1>
      <p className="catalog-intro">
        This page is a human rendering of the store catalog, which is published as Linked Data: a{" "}
        <code>dcat:Catalog</code> of <code>dcat:CatalogRecord</code>s, each pointing at a{" "}
        <code>schema:SoftwareApplication</code>. The same graph is available as{" "}
        <a href="/catalog.ttl">Turtle</a> and <a href="/catalog.jsonld">JSON-LD</a>.
      </p>

      {CATEGORY_ORDER.map((category) => {
        const list = apps.filter((a) => a.category === category);
        if (list.length === 0) return null;
        return (
          <section className="catalog-category" key={category}>
            <h2>{category}</h2>
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {list.map((app) => (
                  <tr key={app.id}>
                    <th scope="row">{app.name}</th>
                    <td>{app.description}</td>
                    <td>
                      <span className={`catalog-status catalog-status-${app.status}`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="catalog-links">
                      {app.deployedUrl ? (
                        <a href={app.deployedUrl} target="_blank" rel="noopener noreferrer">
                          App
                        </a>
                      ) : null}
                      {app.repo ? (
                        <a href={app.repo} target="_blank" rel="noopener noreferrer">
                          Source
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      <p className="catalog-back">
        <a href="#/">← Back to the store</a>
      </p>
    </main>
  );
}
