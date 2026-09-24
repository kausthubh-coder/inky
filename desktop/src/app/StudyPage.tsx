import { useEffect, useMemo, useRef, useState } from "react";
import { STUDY_PAGE_MESSAGE, studyPageDocument } from "../../shared/study-page.js";

/**
 * A page Inky wrote for this question. It runs in an opaque-origin sandbox with scripts only:
 * no same-origin access, no forms, no popups, no navigation, and a policy that blocks every network request.
 * The only way out is studi.explore(label), which reports what the student tried.
 */
export function StudyPage({ title, html, onExplore }: { title: string; html: string; onExplore: (label: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const document = useMemo(() => studyPageDocument(html), [html]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: unknown; label?: unknown; height?: unknown } | null;
      if (data?.type !== STUDY_PAGE_MESSAGE) return;
      if (typeof data.label === "string" && data.label.trim()) onExplore(data.label.trim().slice(0, 200));
      if (typeof data.height === "number" && Number.isFinite(data.height)) setHeight(Math.min(640, Math.max(120, Math.ceil(data.height) + 4)));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onExplore]);
  return (
    <figure className="tu-page">
      <figcaption>{title}</figcaption>
      <iframe ref={frame} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} style={{ height }} />
    </figure>
  );
}
