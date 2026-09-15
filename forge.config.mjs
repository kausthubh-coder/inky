export default {
  packagerConfig: {
    name: "Studi",
    executableName: "Studi",
    asar: { unpack: "**/@napi-rs/canvas-*/*.node" },
    // Canvas selects its architecture-specific package at runtime. Preserve both
    // prebuilds rather than attempting to combine identical per-arch files.
    osxUniversal: { x64ArchFiles: "**/@napi-rs/canvas-darwin-{arm64,x64}/*.node" },
    icon: "assets/studi-inky",
    extraResource: ["assets/studi-inky.png", "assets/studi-inky.ico", "THIRD_PARTY_NOTICES.md"],
    ignore: [
      /^\/(?:\.agents|\.claude|\.cursor|\.github|\.studi-harness|\.studi-lms|agent-harness|\.playwright-mcp|\.vercel|clerk|config|convex|desktop|docs|landing|out|release|scripts|tests)(?:\/|$)/,
      /^\/\.env(?:\.|$)/,
      /^\/node_modules\/\.vite(?:\/|$)/,
      /^\/dist\/(?:\.openai|server)(?:\/|$)/,
      /^\/(?:\.gitignore|\.npmrc|\.vercelignore|\.worktreeinclude|AGENTS\.md|CLAUDE\.md|README\.md|biome\.json|bunfig\.toml|forge\.config\.mjs|index\.html|skills-lock\.json|tsconfig\.json|vite\.config\.mjs|vitest\.config\.ts)$/,
      /^\/assets(?:\/|$)/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      platforms: ["win32"],
      config: {
        name: "studi",
        setupExe: "Studi-Setup.exe",
        setupIcon: "assets/studi-inky.ico",
        noMsi: true,
      },
    },
    {
      name: "@electron-forge/maker-dmg",
      platforms: ["darwin"],
      config: {
        format: "ULFO",
      },
    },
  ],
};
