export interface ConnectedAppCatalogEntry {
  readonly label: string;
  readonly description: string;
  readonly logoUrl: string;
  readonly group: "school" | "files" | "communication" | "planning";
  readonly onboarding: boolean;
}

const logo = (toolkit: string) => `https://logos.composio.dev/api/${toolkit}`;

export const CONNECTED_APP_CATALOG: Readonly<Record<string, ConnectedAppCatalogEntry>> = Object.freeze({
  gmail: { label: "Gmail", description: "Find class email, attachments, and deadline changes.", logoUrl: logo("gmail"), group: "communication", onboarding: true },
  googledrive: { label: "Google Drive", description: "Find and read class files stored in Drive.", logoUrl: logo("googledrive"), group: "files", onboarding: true },
  googledocs: { label: "Google Docs", description: "Read assignment briefs, notes, and shared documents.", logoUrl: logo("googledocs"), group: "files", onboarding: true },
  notion: { label: "Notion", description: "Search class notes, pages, and databases.", logoUrl: logo("notion"), group: "school", onboarding: true },
  github: { label: "GitHub", description: "Read repositories, issues, pull requests, and classroom work.", logoUrl: logo("github"), group: "school", onboarding: true },
  canvas: { label: "Canvas", description: "Read courses, assignments, announcements, modules, and grades.", logoUrl: logo("canvas"), group: "school", onboarding: false },
  googlecalendar: { label: "Google Calendar", description: "Check class events, due dates, and free time.", logoUrl: logo("googlecalendar"), group: "planning", onboarding: false },
  googlesheets: { label: "Google Sheets", description: "Read lab data, trackers, and shared spreadsheets.", logoUrl: logo("googlesheets"), group: "files", onboarding: false },
  outlook: { label: "Outlook", description: "Find school email, calendar events, and tasks.", logoUrl: logo("outlook"), group: "communication", onboarding: false },
  dropbox: { label: "Dropbox", description: "Find and read files shared through Dropbox.", logoUrl: logo("dropbox"), group: "files", onboarding: false },
  slack: { label: "Slack", description: "Search class channels, threads, and shared files.", logoUrl: logo("slack"), group: "communication", onboarding: false },
  discord: { label: "Discord", description: "Read the school servers and class spaces you connect.", logoUrl: logo("discord"), group: "communication", onboarding: false },
  todoist: { label: "Todoist", description: "Read projects, tasks, sections, and completed work.", logoUrl: logo("todoist"), group: "planning", onboarding: false },
});

export function connectedAppCatalogEntry(toolkit: string): ConnectedAppCatalogEntry {
  return CONNECTED_APP_CATALOG[toolkit] ?? {
    label: toolkit.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: "Use this connected app with Inky.",
    logoUrl: logo(toolkit),
    group: "school",
    onboarding: false,
  };
}
