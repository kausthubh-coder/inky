import { DEV_PREVIEW_SCENARIOS } from "./devPreview.js";

export function PreviewGallery() {
  const groups = [...new Set(DEV_PREVIEW_SCENARIOS.map((scenario) => scenario.group))];
  return (
    <main className="preview-gallery" data-studi-preview-gallery="true">
      <header className="preview-gallery__hero">
        <div>
          <p className="eyebrow">Browser-only test harness</p>
          <h1>Every Studi screen, in one place.</h1>
          <p>These are the real components with controlled local data. Open one to inspect it at full size; no Electron, Clerk, Convex, or school login is required.</p>
        </div>
        <a className="button button--yellow" href="/?preview=week">Open the week</a>
      </header>
      {groups.map((group) => (
        <section className="preview-gallery__group" key={group}>
          <div className="preview-gallery__heading"><h2>{group}</h2><span>{DEV_PREVIEW_SCENARIOS.filter((scenario) => scenario.group === group).length} views</span></div>
          <div className="preview-gallery__grid">
            {DEV_PREVIEW_SCENARIOS.filter((scenario) => scenario.group === group).map((scenario) => (
              <article className="preview-card" key={scenario.id}>
                <a className="preview-card__frame" href={`/?preview=${scenario.id}`} aria-label={`Open ${scenario.title}`}>
                  <iframe src={`/?preview=${scenario.id}&frame=1`} title={scenario.title} loading="lazy" tabIndex={-1} />
                </a>
                <div className="preview-card__copy">
                  <div><strong>{scenario.title}</strong><small>{scenario.note}</small></div>
                  <a href={`/?preview=${scenario.id}`}>Open</a>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
