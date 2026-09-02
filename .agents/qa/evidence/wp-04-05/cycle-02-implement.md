# WP-04 + WP-05 cycle 02 implementation

Status: **implemented**

The renderer source is now explicit for each Electron launch. `dev:electron` passes `--studi-development-url=http://127.0.0.1:5173`. Electron main reads that switch and gives its value to `getDevelopmentUrl`. The resolver returns no development URL when the app is packaged or when the switch is absent. It still accepts only credential-free HTTP URLs on `127.0.0.1` or `localhost`.

`STUDI_DEVELOPMENT_MODE` and `VITE_DEV_SERVER_URL` no longer participate in renderer selection. The normal `start` command still ends in `electron .` with no development switch, so `loadRenderer` loads `dist/client/index.html`. The obsolete `cross-env` development dependency was removed from the package manifest and lockfile.

The closest contract check now covers the repaired boundary. It proves that an absent switch selects no development URL, local URLs remain accepted, malformed or non-local URLs fail closed, packaged launches ignore even invalid switch values, the development script passes the dedicated switch, and the normal start script does not.

## Evidence

- `npm run build:electron; node --test tests/contracts/development-url.test.mjs` exited 0. All 5 focused tests passed.
- `npm run typecheck` exited 0.
- `npm run test:electron -- --positive-only` exited 0. The command built the production renderer, launched Electron directly without the development switch, observed the app-ready marker, reopened file-backed storage, completed the Pi probe, inspected the visible `WebContentsView`, and removed its temporary profile.

## Subtraction pass

The final path reads one launch switch and resolves it directly to the load decision. No URL persistence, recovery layer, browser state, compatibility branch, or unrelated test was added. Production Electron code and package scripts contain no reference to either former environment variable. Plans and conclusion artifacts were not edited.

This implementation evidence does not claim the live Moodle restart result. The tester still needs to repeat the cycle-01 restart path, confirm the current sidebar and Codex-ready state return, reopen Moodle, and verify that the persistent school profile remains authenticated.
