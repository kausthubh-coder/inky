export default {
  packagerConfig: {
    name: "Studi",
    executableName: "Studi",
    asar: true,
    icon: "assets/studi-inky",
    extraResource: ["assets/studi-inky.png", "assets/studi-inky.ico", "THIRD_PARTY_NOTICES.md"],
    ignore: [
      /^\/(?:\.agent|\.agents|\.openai|\.playwright-mcp|\.vercel|convex|desktop|landing|out|release|scripts|tests|worker)(?:\/|$)/,
      /^\/\.env(?:\.|$)/,
      /^\/node_modules\/\.vite(?:\/|$)/,
      /^\/dist\/(?:\.openai|server)(?:\/|$)/,
      /^\/(?:\.gitignore|\.npmrc|AGENTS\.md|forge\.config\.mjs|index\.html|STUDI_PRODUCT_DECISIONS\.md|tsconfig\.json|vite\.config\.mjs)$/,
      /^\/assets(?:\/|$)/,
      /^\/(?:cycle-|wp12-).*/,
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
