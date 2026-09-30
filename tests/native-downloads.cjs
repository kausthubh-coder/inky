const { app } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const root = mkdtempSync(join(tmpdir(), 'studi-download-routing-'));
app.setPath('userData', join(root, 'profile'));
mkdirSync(join(root, 'system-downloads'));
app.setPath('downloads', join(root, 'system-downloads'));
app.whenReady().then(() => import('./native-downloads.mjs').then(module => module.run(root)))
  .then(() => app.exit(0), error => { console.error(error); app.exit(1); });
