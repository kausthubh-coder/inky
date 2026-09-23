import { useEffect, useState, type ReactNode } from "react";
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="st-group"><h2>{title}</h2>{children}</section>;
}
export function SettingsRow({ title, description, children, highlight = false }: {
  title: ReactNode; description?: ReactNode; children?: ReactNode; highlight?: boolean;
}) {
  return <div className={`st-row${highlight ? " st-highlight" : ""}`}>
    <div className="st-copy"><strong>{title}</strong>{description && <small>{description}</small>}</div>
    <div className="st-control">{children}</div>
  </div>;
}
export function SettingsToggle({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  return <input className="st-toggle" type="checkbox" role="switch" aria-label={label}
    checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}
export function SavedNotice({ revision }: { revision: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!revision) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1500);
    return () => clearTimeout(timer);
  }, [revision]);
  return <span className="st-saved" role="status">{visible ? "Saved" : ""}</span>;
}

