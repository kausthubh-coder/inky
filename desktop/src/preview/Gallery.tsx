import { useEffect, useRef, useState } from "react";
import { DEV_PREVIEW_SCENARIOS } from "./scenarios.js";

interface SourceInfo {
  root: string;
  branch: string;
  revision: string;
  version: string;
  modified: boolean;
}
const sizes = [
  { label: "Desktop · 1120 × 760", width: 1120, height: 760 },
  { label: "Wide · 1440 × 950", width: 1440, height: 950 },
  { label: "Small window · 800 × 650", width: 800, height: 650 },
  { label: "Narrow · 390 × 844", width: 390, height: 844 },
];

export function PreviewGallery() {
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [selected, setSelected] = useState("today");
  const [sizeIndex, setSizeIndex] = useState(0);
  const [desktop, setDesktop] = useState("win32");
  const [revision, setRevision] = useState(0);
  const [available, setAvailable] = useState(1120);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = stage.current!;
    const observer = new ResizeObserver(() =>
      setAvailable(element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/__studi_preview/source", { signal: controller.signal })
      .then((response) => response.json())
      .then(setSource)
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const groups = [
    ...new Set(DEV_PREVIEW_SCENARIOS.map((scenario) => scenario.group)),
  ];
  const size = sizes[sizeIndex]!;
  const scale = Math.min(1, available / size.width);
  const href = `/?preview=${selected}${desktop ? `&desktop=${desktop}` : ""}`;
  return (
    <main className="preview-workbench" data-studi-preview-gallery="true">
      <header>
        <div>
          <h1>Studi UI previews</h1>
          <p>
            Real app components · simulated data and school pages · no live
            account actions
          </p>
          <p className="preview-source">
            <strong>
              {source
                ? `${source.branch} · ${source.revision}${source.modified ? " + local edits" : ""}`
                : "Source: this development server"}
            </strong>
            <br />
            <small>
              {source?.root ?? "Run bun run preview:ui for checkout details."}
            </small>
          </p>
        </div>
      </header>
      <div className="preview-workbench-body">
        <nav aria-label="Preview scenarios">
          {groups.map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              {DEV_PREVIEW_SCENARIOS.filter((s) => s.group === group).map(
                (s) => (
                  <a
                    key={s.id}
                    href={`/?preview=${s.id}`}
                    data-preview-route={s.id}
                    aria-current={selected === s.id ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      setSelected(s.id);
                    }}
                  >
                    {s.title}
                  </a>
                ),
              )}
            </section>
          ))}
        </nav>
        <section className="preview-workbench-main">
          <div className="preview-toolbar">
            <label>
              Window size
              <select
                value={sizeIndex}
                onChange={(e) => setSizeIndex(Number(e.target.value))}
              >
                {sizes.map((size, index) => (
                  <option value={index} key={size.label}>
                    {size.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Window controls
              <select
                value={desktop}
                onChange={(e) => setDesktop(e.target.value)}
              >
                <option value="win32">Windows (simulated)</option>
                <option value="darwin">macOS (simulated)</option>
                <option value="">Browser</option>
              </select>
            </label>
            <button onClick={() => setRevision((n) => n + 1)}>
              Reset state
            </button>
            <a href={href} target="_blank" rel="noreferrer">
              Open full size ↗
            </a>
          </div>
          <p className="preview-current">
            <strong>
              {DEV_PREVIEW_SCENARIOS.find((s) => s.id === selected)?.title}
            </strong>
            <span>
              {size.width} × {size.height} · {Math.round(scale * 100)}% display
              scale
            </span>
          </p>
          <div className="preview-stage" ref={stage}>
            <div
              style={{ width: size.width * scale, height: size.height * scale }}
            >
              <iframe
                key={`${href}:${revision}`}
                title="Current Studi preview"
                src={href}
                style={{
                  width: size.width,
                  height: size.height,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
