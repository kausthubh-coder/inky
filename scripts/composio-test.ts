import { Composio } from "@composio/core";
import { readFile } from "node:fs/promises";

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

const policySource = process.env.STUDI_COMPOSIO_TOOL_POLICY_JSON
  ?? await readFile(new URL("../config/composio-tool-policy.json", import.meta.url), "utf8");
const policy = readComposioPolicy(policySource);
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
  const available = await composio.tools.getRawComposioTools(
    { toolkits: [toolkitSlug], limit: 999, important: false },
    undefined,
    { signal: AbortSignal.timeout(20_000) },
  );
  const tools = item.access === "all" ? available : available.filter((tool) => item.tools.includes(tool.slug));
  const writePattern = /(?:CREATE|ADD|APPEND|UPDATE|EDIT|SEND|UPLOAD|MOVE|COPY|DELETE|REMOVE|ARCHIVE|REPLY|COMMENT|PUBLISH|SUBMIT|COMPLETE|INVITE|SHARE|LABEL|STAR|TRASH|MERGE)/;
  const writeTools = tools.filter((tool) => writePattern.test(tool.slug));
  if (item.access === "all" && writeTools.length === 0) {
    throw new Error(`${toolkitSlug} exposes no discoverable write actions`);
  }
  toolkits.push({
    slug: toolkit.slug,
    name: toolkit.name,
    version: item.version,
    access: item.access,
    actionCount: tools.length,
    writeActionCount: writeTools.length,
    writeExamples: writeTools.slice(0, 5).map((tool) => ({ slug: tool.slug, name: tool.name })),
  });
}

const searchSession = await composio.sessions.create("studi-catalog-probe", {
  toolkits: ["gmail"],
  manageConnections: false,
  sandbox: { enable: false },
});
const search = await searchSession.search({ query: "create an email draft", toolkits: ["gmail"] });
const searchTools = Object.values(search.toolSchemas).map((schema) => schema.toolSlug);
if (!search.success || !searchTools.some((slug) => /DRAFT|SEND/.test(slug))) {
  throw new Error("Full-access session search did not discover a Gmail write action");
}

process.stdout.write(`${JSON.stringify({ ok: true, toolkits, lazySearch: { toolkit: "gmail", query: "create an email draft", tools: searchTools } }, null, 2)}\n`);
