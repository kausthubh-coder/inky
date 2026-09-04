import { Composio } from "@composio/core";

import { readComposioPolicy } from "../convex/composioPolicy.js";

const mode = process.argv[2];
if (mode !== "probe" && mode !== "discover") {
  throw new Error(
    "Usage: bun run test:composio -- probe | bun scripts/composio-test.ts discover <toolkit> <search-or-tool-slug>",
  );
}

const apiKey = process.env.COMPOSIO_API_KEY?.trim();
if (!apiKey) {
  throw new Error("COMPOSIO_API_KEY is not configured in this process");
}

if (mode === "discover") {
  const toolkitSlug = process.argv[3]?.trim().toLowerCase();
  const search = process.argv[4]?.trim();
  if (!toolkitSlug || !/^[a-z0-9_-]+$/.test(toolkitSlug) || !search || search.length > 200) {
    throw new Error("discover requires a safe <toolkit> and <search-or-tool-slug>");
  }

  const composio = new Composio({
    apiKey,
    allowTracking: false,
    disableVersionCheck: true,
    dangerouslyAllowAutoUploadDownloadFiles: false,
    fileUploadDirs: false,
    host: "studi-composio-discovery",
  });
  const toolkit = await composio.toolkits.get(toolkitSlug, { signal: AbortSignal.timeout(10_000) });
  const allTools = await composio.tools.getRawComposioTools(
    { toolkits: [toolkitSlug], limit: 999, important: false },
    undefined,
    { signal: AbortSignal.timeout(10_000) },
  );
  const words = search.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const toolSlug = search.toLocaleUpperCase();
  const candidates = allTools.filter((candidate) => {
    const haystack = `${candidate.slug} ${candidate.name}`.toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const tool = allTools.find((candidate) => candidate.slug === toolSlug) ?? candidates[0];
  if (!tool) {
    throw new Error(`No tool matching ${search} is available for ${toolkitSlug}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    toolkit: {
      slug: toolkit.slug,
      name: toolkit.name,
      availableVersions: toolkit.meta.availableVersions ?? [],
    },
    tool: {
      slug: tool.slug,
      name: tool.name,
      version: tool.version ?? null,
      availableVersions: tool.availableVersions ?? [],
    },
    candidates: candidates.slice(0, 100).map((candidate) => ({
      slug: candidate.slug,
      name: candidate.name,
      version: candidate.version ?? null,
    })),
  }, null, 2)}\n`);
  process.exit(0);
}

const policy = readComposioPolicy();
if (Object.keys(policy).length === 0) {
  throw new Error("STUDI_COMPOSIO_TOOL_POLICY_JSON has no pinned toolkit allowlist");
}

const composio = new Composio({
  apiKey,
  allowTracking: false,
  disableVersionCheck: true,
  dangerouslyAllowAutoUploadDownloadFiles: false,
  fileUploadDirs: false,
  toolkitVersions: Object.fromEntries(
    Object.entries(policy).map(([toolkit, item]) => [toolkit, item.version]),
  ),
  host: "studi-composio-probe",
});

const toolkits = [];
for (const [toolkitSlug, item] of Object.entries(policy)) {
  const toolkit = await composio.toolkits.get(toolkitSlug, { signal: AbortSignal.timeout(10_000) });
  const tools = [];
  for (const toolSlug of item.tools) {
    const tool = await composio.tools.getRawComposioToolBySlug(
      toolSlug,
      { version: item.version },
      { signal: AbortSignal.timeout(10_000) },
    );
    tools.push({ slug: tool.slug, name: tool.name, version: item.version });
  }
  toolkits.push({ slug: toolkit.slug, name: toolkit.name, version: item.version, tools });
}

process.stdout.write(`${JSON.stringify({ ok: true, toolkits }, null, 2)}\n`);
