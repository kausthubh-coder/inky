import type { SettingsLanding } from "./Ui.js";
export const SETTINGS_SECTIONS = [
  { id: "inky", label: "Dot", hint: "Your AI and what Dot remembers." },
  { id: "homework", label: "Homework", hint: "Rules, timing and files." },
  { id: "school", label: "School", hint: "School checks and connected apps." },
  { id: "notifications", label: "Notifications", hint: "Sounds, banners and quiet hours." },
  { id: "you", label: "You", hint: "Account, usage, privacy and help." },
] as const;
export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]["id"];
export function settingsTab(landing: SettingsLanding, preview?: SettingsSectionId): SettingsSectionId {
  if (landing === "usage" || landing === "feedback") return "you";
  if (landing === "rules") return "homework";
  return preview ?? "inky";
}
