import type { WebContents } from "electron";
import { externalLinkUrl } from "../shared/external-link.js";

export function configureAppNavigation(contents: WebContents, openExternal: (url: string) => Promise<unknown>): void {
  contents.setWindowOpenHandler(({ url }) => {
    const destination = externalLinkUrl(url);
    if (destination) {
      void openExternal(destination).catch(() => console.warn("Could not open the external link."));
    }
    return { action: "deny" };
  });
  contents.on("will-navigate", event => event.preventDefault());
}
