import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

const artifacts = [
  ["dist/apps/cli/app.js", "dist/app.js"],
  ["dist/apps/cli/app.js.map", "dist/app.js.map"],
  ["dist/apps/cli/app.d.ts", "dist/app.d.ts"],
  ["dist/apps/cli/app.d.ts.map", "dist/app.d.ts.map"],
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
