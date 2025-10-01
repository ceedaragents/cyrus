import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(projectRoot, "..", "..");

const artifacts = [
  ["dist/apps/cli/app.js", "dist/app.js"],
  ["dist/apps/cli/app.js.map", "dist/app.js.map"],
  ["dist/apps/cli/app.d.ts", "dist/app.d.ts"],
  ["dist/apps/cli/app.d.ts.map", "dist/app.d.ts.map"],
  ["dist/apps/cli/prompt-list.js", "dist/prompt-list.js"],
  ["dist/apps/cli/prompt-list.js.map", "dist/prompt-list.js.map"],
  ["dist/apps/cli/prompt-list.d.ts", "dist/prompt-list.d.ts"],
  ["dist/apps/cli/prompt-list.d.ts.map", "dist/prompt-list.d.ts.map"],
  ["dist/apps/cli/prompt-tui.js", "dist/prompt-tui.js"],
  ["dist/apps/cli/prompt-tui.js.map", "dist/prompt-tui.js.map"],
  ["dist/apps/cli/prompt-tui.d.ts", "dist/prompt-tui.d.ts"],
  ["dist/apps/cli/prompt-tui.d.ts.map", "dist/prompt-tui.d.ts.map"],
];

for (const [fromRel, toRel] of artifacts) {
  const from = resolve(projectRoot, fromRel);
  if (!existsSync(from)) {
    continue;
  }
  const to = resolve(projectRoot, toRel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

const directories = [
  [
    resolve(workspaceRoot, "packages", "edge-worker", "prompts"),
    resolve(projectRoot, "dist", "packages", "edge-worker", "prompts"),
  ],
];

for (const [from, to] of directories) {
  if (!existsSync(from)) {
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
}
