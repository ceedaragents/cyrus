# Rebuilding the CLI after package changes

The `cyrus-ai` CLI ships its own compiled copy of every workspace package under
`apps/cli/dist`. When you change source inside `packages/agent-runner`,
`packages/edge-worker`, or other packages consumed by the CLI, the running
binary will continue to use the previously generated output until you rebuild
both the package **and** the CLI bundle.

If you notice that new log statements or fixes are missing at runtime, clean the
old build artifacts and rebuild the dependent packages in this order:

```
rm -rf packages/agent-runner/dist packages/edge-worker/dist apps/cli/dist
pnpm --filter cyrus-agent-runner build
pnpm --filter cyrus-edge-worker build
pnpm --filter cyrus-ai build
```

Rebuilding in this sequence ensures:

- each package in `packages/*` emits its latest compiled output under `dist/`
- the CLI's compiled entry point (`apps/cli/dist/apps/cli/app.js`) is updated to
  point at the freshly built packages

After the commands finish, restart the CLI (e.g. `pnpm --filter cyrus-ai exec
node dist/apps/cli/app.js …`). Any new logging or behaviour changes will now be
visible. Skipping the clean step often leaves TypeScript artefacts from older
layouts (for example after adding new files or adjusting build outputs).

## Troubleshooting tips

- If the CLI reports `MODULE_NOT_FOUND` for a package under
  `apps/cli/dist/node_modules`, the package likely was not rebuilt or its `dist/
  index.js` shim was removed. Run the clean-and-build sequence above.
- If the first log lines do not show the new output you expect (for example the
  `[EdgeWorker] DEBUG_EDGE env: …` message), the CLI is still using cached
  sources. Clean and rebuild all three layers.
- When testing repeatedly, make sure to stop any previously running worker so
  the new binary can bind to the configured port.
