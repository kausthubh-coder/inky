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
  { id: "week-conflicts", group: "School scan", title: "Class permission conflict", note: "Simulated unresolved class aliases" },
  { id: "week-needs-user", group: "School scan", title: "Scan needs you", note: "Simulated sign-in handoff" },
  { id: "week-complete", group: "School scan", title: "Scan finished", note: "Start another school check" },
  { id: "week-idle", group: "School scan", title: "Start a scan", note: "No previous school check" },
  { id: "week-browser-busy", group: "School scan", title: "Assignment using browser", note: "Simulated stop-and-scan" },
  { id: "week", group: "Workspace", title: "This week", note: "Dashboard and assignments" },
  { id: "week-undated", group: "Workspace", title: "Without dates", note: "Undated work, grouped by class" },
  { id: "assignment", group: "Workspace", title: "Assignment details", note: "Homework conversation and files" },
  { id: "assignment-failed", group: "Workspace", title: "Assignment retry", note: "Simulated failure and retry" },
  { id: "assignment-stopped", group: "Workspace", title: "Stopped assignment", note: "Student cancelled work" },
  { id: "assignment-restricted", group: "Workspace", title: "Assignment permission", note: "Disabled start and homework rules" },
  { id: "assignment-saved", group: "Workspace", title: "Saved assignment", note: "Answers saved, submission unconfirmed" },
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
  const panel: DeskPanel = id === "assignment" || id.startsWith("assignment-")
    ? { kind: "assignment", assignmentId: id === "assignment-saved" ? "assignment-hw1" : "assignment-sort" }
    : id === "chat-handoff" ? {kind:"school"} : id.startsWith("desk-") ? { kind: "desk" } : { kind: "closed" };
  return { id, screen: settingsSection ? "settings" : "week", panel, ...(onboardingStep === undefined ? {} : { onboardingStep }), ...(settingsSection ? { settingsSection } : {}) };
}
