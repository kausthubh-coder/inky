import { readPreviewSchoolPage } from "./devPreview.js";

// Electron owns this surface in the app; only a preview supplies its contents.
export function PreviewSchoolPage({ mode }: { mode: "classes" | "assignment" }) {
  const SchoolPage = readPreviewSchoolPage();
  return SchoolPage ? <SchoolPage mode={mode} /> : null;
}
