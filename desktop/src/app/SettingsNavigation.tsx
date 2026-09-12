import { Icon } from "./Icon.js";

export const SETTINGS_SECTIONS = [
  { id: "inky", group: "Inky", label: "Thinking & ChatGPT", hint: "Choose how I think.", keywords: "model reasoning effort connect codex ai account" },
  { id: "preferences", group: "Inky", label: "Review & memory", hint: "Set your review time and show or hide saved memories.", keywords: "minutes timer answers wait handoff remember finish saved memories notes show hide" },
  { id: "apps", group: "Inky", label: "Connected apps", hint: "The tools we use together.", keywords: "tools gmail google drive docs notion github connections" },
  { id: "folder", group: "School", label: "Homework folder", hint: "A home for your work.", keywords: "files coding uploads local path directory" },
  { id: "school", group: "School", label: "School schedule", hint: "I’ll keep an eye on your classes.", keywords: "scan check daily weekly time automatic" },
  { id: "rules", group: "School", label: "Homework rules", hint: "You decide what I may try.", keywords: "permission submit attempt class assignment pattern" },
  { id: "notifications", group: "You", label: "Notifications", hint: "A nudge when you need one.", keywords: "sound alerts quiet handoff review scan" },
  { id: "privacy", group: "You", label: "Privacy", hint: "What stays with us, and what gets shared.", keywords: "telemetry replay events debug sharing data" },
  { id: "usage", group: "You", label: "Usage", hint: "Your time with Inky.", keywords: "tokens limits plan remaining account beta" },
  { id: "support", group: "You", label: "Help & feedback", hint: "Tell us what could be better.", keywords: "diagnostics export version broken bug note support" },
  { id: "account", group: "You", label: "Account", hint: "Your place in Studi.", keywords: "sign out logout profile name" },
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]["id"];

export function matchingSettings(query: string): SettingsSectionId[] {
  const words = query.toLowerCase().trim().split(/\s+/);
  return SETTINGS_SECTIONS.filter(section => words.every(word => `${section.label} ${section.keywords}`.toLowerCase().includes(word))).map(section => section.id);
}

export function SettingsNavigation({ section, query, onQuery, onSection }: {
  section: SettingsSectionId;
  query: string;
  onQuery: (query: string) => void;
  onSection: (section: SettingsSectionId) => void;
}) {
  return <aside className="settings-sidebar">
    <h1>Settings</h1>
    <div className="settings-search"><Icon name="search" size={17} /><input type="search" aria-label="Search settings" placeholder="Find a setting…" value={query} onChange={event => onQuery(event.target.value)} />{query && <button type="button" aria-label="Clear search" onClick={() => onQuery("")}><Icon name="close" size={14} /></button>}</div>
    <nav aria-label="Settings sections">
      {(["Inky", "School", "You"] as const).map(group => <div className="settings-nav-group" key={group}>
        <p>{group}</p>
        {SETTINGS_SECTIONS.filter(item => item.group === group).map(item => <button key={item.id} type="button" aria-current={!query.trim() && section === item.id ? "page" : undefined} onClick={() => { onQuery(""); onSection(item.id); }}>{item.label}</button>)}
      </div>)}
    </nav>
  </aside>;
}
