import type { Metadata } from "next";
import { SiteNav } from "../../components/site-nav";
import { changelog } from "../../lib/changelog";
import styles from "./changelog.module.css";

export const metadata: Metadata = {
  title: "Changelog · Studi",
  description: "Every Studi release, from the first hello to the latest improvements. See what’s new with Inky.",
};

const releaseUrl = (version: string) => `https://github.com/kausthubh-coder/inky/releases/tag/v${version}`;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function ChangelogPage() {
  return (
    <>
      <SiteNav flat current="/changelog" />
      <main className={styles.page} id="main">
        <header className={styles.intro}>
          <p className="kicker">Changelog</p>
          <h1>Inky’s getting<br />better at this.</h1>
          <p className={styles.lead}>New things, small fixes, and everything we’ve shipped along the way.</p>
          <a className="btn primary" href={releaseUrl(changelog[0].version)}>Get the latest version <span aria-hidden="true">↗</span></a>
          <span className={styles.beta}>Studi is in private beta.</span>
        </header>

        <div className={styles.layout}>
          <nav className={styles.versions} aria-label="Release versions">
            <p>On this page</p>
            <ol>{changelog.map(release => <li key={release.version}><a href={`#v${release.version}`}>v{release.version}</a></li>)}</ol>
          </nav>
          <div className={styles.releases}>
            {changelog.map((release, index) => (
              <article className={styles.release} id={`v${release.version}`} key={release.version} aria-labelledby={`title-${release.version}`}>
                <div className={styles.meta}>
                  <a className={styles.version} href={`#v${release.version}`} aria-label={`Link to version ${release.version}`}>v{release.version}</a>
                  {index === 0 && <span className={styles.latest}>Latest</span>}
                  <time dateTime={release.date}>{dateFormat.format(new Date(`${release.date}T12:00:00Z`))}</time>
                </div>
                <h2 id={`title-${release.version}`}>{release.title}</h2>
                <p className={styles.summary}>{release.summary}</p>
                <ul>{release.changes.map(change => <li key={change}>{change}</li>)}</ul>
                {"note" in release && <p className={styles.note}>{release.note}</p>}
                <a className={styles.releaseLink} href={releaseUrl(release.version)}>Release notes & downloads <span aria-hidden="true">↗</span><span className="visually-hidden"> for v{release.version}</span></a>
              </article>
            ))}
          </div>
        </div>
      </main>
      <footer className="foot">© 2026 Studi <span>·</span> Private beta <span>·</span> <a href="/">Home</a> <span>·</span> <a href="/mission">Our mission</a></footer>
    </>
  );
}
