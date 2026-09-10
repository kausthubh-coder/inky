import type { ComponentType } from "react";
import type { DeskPanel } from "./DeskScreen.js";
import type { AppScreen } from "./Ui.js";
import type { SettingsSectionId } from "./SettingsNavigation.js";

export type DevPreviewScenarioId =
  | "auth"
  | "onboarding-welcome" | "onboarding-chatgpt" | "onboarding-connections" | "onboarding-folder"
  | "onboarding-school" | "onboarding-permission" | "onboarding-schedule" | "onboarding-signin"
  | "onboarding-scan" | "onboarding-handoff" | "onboarding-ready"
  | "chat-expanded" | "chat-thinking" | "chat-error" | "chat-handoff" | "week-error" | "week-updating" | "updates-ready" | "updates-mac" | "updates-error"
  | "week" | "week-conflicts" | "week-needs-user" | "week-complete" | "week-idle" | "week-browser-busy" | "week-undated" | "assignment" | "desk-working" | "desk-needs-user" | "desk-review" | "desk-submitted"
  | `settings-${SettingsSectionId}`;

export interface DevPreviewConfig {
  readonly id: DevPreviewScenarioId;
  readonly screen: AppScreen;
  readonly panel: DeskPanel;
  readonly onboardingStep?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  readonly settingsSection?: SettingsSectionId;
}


// Passive startup configuration. Production never installs a preview environment.
interface PreviewEnvironment { config: DevPreviewConfig; SchoolPage: ComponentType<{ mode: "classes" | "assignment" }> }
let environment: PreviewEnvironment | null = null;
export function installPreviewEnvironment(value: PreviewEnvironment): void { environment = value; }
export function readDevPreviewConfig(): DevPreviewConfig | null { return environment?.config ?? null; }
export function readPreviewSchoolPage() { return environment?.SchoolPage ?? null; }
