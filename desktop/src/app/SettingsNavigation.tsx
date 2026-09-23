import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settingsRouting.js";
export { SETTINGS_SECTIONS, settingsTab, type SettingsSectionId } from "./settingsRouting.js";
export function SettingsNavigation({ section, onSection }: {
  section: SettingsSectionId; onSection: (section: SettingsSectionId) => void;
}) {
  return <nav className="st-tabs" aria-label="Settings sections">
    {SETTINGS_SECTIONS.map(item => <button key={item.id} type="button"
      aria-current={section === item.id ? "page" : undefined}
      onClick={() => onSection(item.id)}>{item.label}</button>)}
  </nav>;
}
