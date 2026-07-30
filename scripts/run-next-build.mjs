/**
 * prepare → next build → restore (finally).
 * Build kırılsa bile stash geri alınır.
 */
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const here = path.dirname(fileURLToPath(import.meta.url));
const prepare = path.join(here, "prepare-notal-build.mjs");

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  return result.status ?? 1;
}

const prepCode = runNode(prepare);
if (prepCode !== 0) process.exit(prepCode);

const build = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build"],
  { stdio: "inherit", env: process.env, shell: process.platform === "win32" },
);
const buildCode = build.status ?? 1;

runNode(prepare, ["restore"]);
process.exit(buildCode);
