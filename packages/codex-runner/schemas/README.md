`schemas/` is the regeneration workspace for Codex app-server protocol artifacts.

From `packages/codex-runner/`, refresh the protocol reference with:

```bash
codex app-server generate-ts --out ./schemas/ts
codex app-server generate-json-schema --out ./schemas/json
```

Equivalent package scripts:

```bash
pnpm run generate:app-server:ts
pnpm run generate:app-server:json
pnpm run generate:app-server
```

`src/appServerProtocol.ts` is the curated subset Cyrus actually consumes. Regenerate the artifacts above before editing that shim so manual changes stay aligned with the upstream app-server protocol.
