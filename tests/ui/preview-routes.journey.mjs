// Run through official Playwright MCP with the URL printed by preview:ui.
export async function verifyPreviewRoutes(page, base) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto(`${base}/?preview=gallery`);
    await page.waitForSelector("[data-studi-preview-gallery]");
    const routes = [...new Set(await page.locator('.preview-card a').evaluateAll(links => links.map(link => link.getAttribute("href"))))];
    if (!routes.length) throw new Error("Gallery has no scenarios");
    const source = await page.evaluate(async () => (await fetch('/__studi_preview/source')).json());
    if (!source.root || !source.revision) throw new Error("Preview source is unidentified");
    for (const route of routes) {
      await page.goto(`${base}${route}`);
      await page.waitForSelector("[data-studi-app-ready], .fable-window");
      const state = await page.evaluate(async () => ({
        auth: (await window.studi.getAuthState()).status,
        runtime: (await window.studi.getRuntimeInfo()).app,
      }));
      if (state.runtime !== `${source.version}-preview`) throw new Error(`Wrong version at ${route}`);
      if (state.auth !== (route === '/?preview=auth' ? 'signed_out' : 'approved')) throw new Error(`Wrong fixture at ${route}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return { routes: routes.length, source, pageErrors: errors };
  } finally { page.off('pageerror', onError); }
}
