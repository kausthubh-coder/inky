export interface ConnectedAppCatalogEntry {
  readonly label: string;
  readonly description: string;
  readonly logoUrl: string;
  readonly group: "school" | "files" | "communication" | "planning";
  readonly onboarding: boolean;
}

const logo = (toolkit: string) => `https://logos.composio.dev/api/${toolkit}`;

export const CONNECTED_APP_CATALOG: Readonly<Record<string, ConnectedAppCatalogEntry>> = Object.freeze({
  gmail: { label: "Gmail", description: "Read, draft, send, label, and organize class email.", logoUrl: logo("gmail"), group: "communication", onboarding: true },
  googledrive: { label: "Google Drive", description: "Find, create, update, move, and share class files.", logoUrl: logo("googledrive"), group: "files", onboarding: true },
  googledocs: { label: "Google Docs", description: "Read, create, and edit assignment briefs, notes, and documents.", logoUrl: logo("googledocs"), group: "files", onboarding: true },
  notion: { label: "Notion", description: "Search, create, and update class pages and databases.", logoUrl: logo("notion"), group: "school", onboarding: true },
  github: { label: "GitHub", description: "Work with repositories, issues, pull requests, and classroom projects.", logoUrl: logo("github"), group: "school", onboarding: true },
  canvas: { label: "Canvas", description: "Work with courses, assignments, announcements, modules, and submissions.", logoUrl: logo("canvas"), group: "school", onboarding: false },
  googlecalendar: { label: "Google Calendar", description: "Read and manage class events, due dates, and study time.", logoUrl: logo("googlecalendar"), group: "planning", onboarding: false },
  googlesheets: { label: "Google Sheets", description: "Read, create, and update lab data, trackers, and spreadsheets.", logoUrl: logo("googlesheets"), group: "files", onboarding: false },
  outlook: { label: "Outlook", description: "Read and manage school email, calendars, and tasks.", logoUrl: logo("outlook"), group: "communication", onboarding: false },
  dropbox: { label: "Dropbox", description: "Find, upload, update, organize, and share files.", logoUrl: logo("dropbox"), group: "files", onboarding: false },
  slack: { label: "Slack", description: "Search, send, reply, and manage class communication.", logoUrl: logo("slack"), group: "communication", onboarding: false },
  discord: { label: "Discord", description: "Read and manage messages in the school spaces you connect.", logoUrl: logo("discord"), group: "communication", onboarding: false },
  todoist: { label: "Todoist", description: "Create, update, complete, and organize projects and tasks.", logoUrl: logo("todoist"), group: "planning", onboarding: false },
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
