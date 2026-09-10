import { SETTINGS_SECTIONS } from "../app/SettingsNavigation.js";
import type { DeskPanel } from "../app/DeskScreen.js";
import type { DevPreviewConfig, DevPreviewScenarioId } from "../app/devPreview.js";

export const DEV_PREVIEW_SCENARIOS: readonly { readonly id: DevPreviewScenarioId; readonly group: string; readonly title: string; readonly note: string }[] = [
  { id: "auth", group: "Entry", title: "Private beta gate", note: "Signed-out entry and feedback" },
  { id: "onboarding-welcome", group: "Onboarding", title: "Meet Inky", note: "Welcome" },
  { id: "onboarding-chatgpt", group: "Onboarding", title: "Connect ChatGPT", note: "Agent runtime" },
  { id: "onboarding-connections", group: "Onboarding", title: "Connected apps", note: "Gmail, Drive, Docs, Notion, GitHub" },
  { id: "onboarding-folder", group: "Onboarding", title: "Homework folder", note: "Bounded file access" },
  { id: "onboarding-school", group: "Onboarding", title: "School link", note: "Class site" },
  { id: "onboarding-permission", group: "Onboarding", title: "Work permission", note: "Attempt and submission default" },
  { id: "onboarding-schedule", group: "Onboarding", title: "Scan schedule", note: "Automatic checks" },
  { id: "onboarding-signin", group: "Onboarding", title: "School sign-in", note: "Browser handoff" },
  { id: "onboarding-scan", group: "Onboarding", title: "Scanning school", note: "Live progress" },
  { id: "onboarding-handoff", group: "Onboarding", title: "Needs student", note: "Linked-site sign-in" },
  { id: "onboarding-ready", group: "Onboarding", title: "Week ready", note: "Partial but truthful completion" },
  {id:'chat-expanded',group:'Chat & updates',title:'chat expanded',note:'Interactive real component fixture'},
  {id:'chat-thinking',group:'Chat & updates',title:'chat thinking',note:'Interactive real component fixture'},
  {id:'chat-error',group:'Chat & updates',title:'chat error',note:'Interactive real component fixture'},
  {id:'chat-handoff',group:'Chat & updates',title:'School sign-in handoff',note:'Resume a scan from the conversation'},
  {id:'week-error',group:'Chat & updates',title:'week error',note:'Interactive real component fixture'},
  {id:'week-updating',group:'Chat & updates',title:'week updating',note:'Interactive real component fixture'},
  {id:'updates-ready',group:'Chat & updates',title:'updates ready',note:'Interactive real component fixture'},
  {id:'updates-mac',group:'Chat & updates',title:'updates mac',note:'Interactive real component fixture'},
  {id:'updates-error',group:'Chat & updates',title:'updates error',note:'Interactive real component fixture'},
  { id: "week", group: "Workspace", title: "This week", note: "Dashboard and assignments" },
  { id: "week-undated", group: "Workspace", title: "Without dates", note: "Undated work, grouped by class" },
  { id: "assignment", group: "Workspace", title: "Assignment details", note: "Peek drawer" },
  { id: "desk-working", group: "Workspace", title: "Inky working", note: "Visible school work" },
  { id: "desk-needs-user", group: "Workspace", title: "Inky needs you", note: "Resume handoff" },
  { id: "desk-review", group: "Workspace", title: "Ready for review", note: "Completion checklist" },
  { id: "desk-submitted", group: "Workspace", title: "Submitted", note: "Verified receipt" },
  ...SETTINGS_SECTIONS.map(section => ({ id: `settings-${section.id}` as const, group: "Settings", title: section.label, note: section.hint })),
];

export function parsePreviewConfig(search: string): DevPreviewConfig | null {
  const id = new URLSearchParams(search).get("preview") as DevPreviewScenarioId | null;
  if (!id || !DEV_PREVIEW_SCENARIOS.some((scenario) => scenario.id === id)) return null;
  const settingsSection = id.startsWith("settings-") ? id.slice("settings-".length) as DevPreviewConfig["settingsSection"] : undefined;
  const onboardingStep = ({
    "onboarding-welcome": 0,
    "onboarding-chatgpt": 1,
    "onboarding-connections": 2,
    "onboarding-folder": 3,
    "onboarding-school": 4,
    "onboarding-permission": 5,
    "onboarding-schedule": 6,
  } as Partial<Record<DevPreviewScenarioId, DevPreviewConfig["onboardingStep"]>>)[id];
  const panel: DeskPanel = id === "assignment"
    ? { kind: "assignment", assignmentId: "assignment-sort" }
    : id.startsWith("desk-") ? { kind: "desk" } : { kind: "closed" };
  return { id, screen: settingsSection ? "settings" : "week", panel, ...(onboardingStep === undefined ? {} : { onboardingStep }), ...(settingsSection ? { settingsSection } : {}) };
}
