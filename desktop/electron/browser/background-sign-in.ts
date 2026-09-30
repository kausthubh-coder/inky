import { BrowserWindow, type Session, type WebContents } from "electron";

import { looksLikeSignIn } from "./read-only-guard.js";

const SIGN_IN_WAIT_MS = 20_000;
const hidden = new Set<WebContents>();

/** Whether these contents are a background sign-in page (which must never save a download). */
export const isBackgroundSignIn = (contents: WebContents) => hidden.has(contents);

/**
 * A plain download of a school link can land on the school's sign-in step, which needs JavaScript to finish (SAML
 * auto-posts, "Saving session information…"). Load the link once in a hidden page of the signed-in school session,
 * let the school's single sign-on run, and stop as soon as it heads back to the document, so the next download
 * carries the new sign-in cookies. Never types anything: if the school wants a password, this just times out.
 */
export async function completeBackgroundSignIn(session: Session, url: string): Promise<void> {
  const window = new BrowserWindow({ show: false, webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const contents = window.webContents;
  hidden.add(contents);
  try {
    await new Promise<void>(resolve => {
      let signingIn = false;
      const timer = setTimeout(resolve, SIGN_IN_WAIT_MS);
      const finish = () => { clearTimeout(timer); resolve(); };
      const isSignIn = (target: string) => { try { return looksLikeSignIn(new URL(target)); } catch { return false; } };
      const onward = (event: { preventDefault(): void }, target: string) => {
        if (isSignIn(target)) { signingIn = true; return; }
        // Back to the document: the sign-in cookies are set, and the file itself is left to the next download.
        if (signingIn) { event.preventDefault(); finish(); }
      };
      contents.on("will-redirect", onward);
      contents.on("will-navigate", onward);
      contents.on("did-start-navigation", (_event, target, _inPlace, isMainFrame) => { if (isMainFrame) onward({ preventDefault: () => contents.stop() }, target); });
      contents.on("did-stop-loading", () => { if (!signingIn) finish(); });
      contents.loadURL(url).catch(() => {});
    });
  } finally {
    hidden.delete(contents);
    window.destroy();
  }
}
