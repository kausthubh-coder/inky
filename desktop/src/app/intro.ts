// First visits: each home screen says what it is once, until the student uses it or takes the tour.
export type Intro = "homework" | "learn";

const key = (intro: Intro) => `studi:intro:${intro}`;

export function introSeen(intro: Intro): boolean {
  try { return localStorage.getItem(key(intro)) !== null; } catch { return true; }
}

export function markIntroSeen(...intros: Intro[]): void {
  try { for (const intro of intros) localStorage.setItem(key(intro), new Date().toISOString()); } catch { /* A first-visit line is never worth an error. */ }
}
