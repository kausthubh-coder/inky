export default {
  packagerConfig: {
    name: "Studi",
    executableName: "Studi",
    asar: false,
    icon: "assets/studi-inky",
    extraResource: ["assets/studi-inky.png", "THIRD_PARTY_NOTICES.md"],
    ignore: [
      /^\/(?:\.agents|\.openai|\.playwright-mcp|convex|electron|landing|scripts|shared|src|tests|worker)(?:\/|$)/,
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
      config: {
        name: "studi",
        setupExe: "Studi-Setup.exe",
        setupIcon: "assets/studi-inky.ico",
        noMsi: true,
      },
    },
  ],
};
