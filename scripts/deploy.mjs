/**
 * Ön kontrol + Vercel production deploy.
 *
 * Kullanım:
 *   npm run deploy          → kontrol + build + vercel --prod
 *   npm run deploy:check    → yalnızca kontrol + build
 *   node scripts/deploy.mjs --check-only
 *   node scripts/deploy.mjs --preview   → vercel deploy (önizleme)
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const checkOnly = args.includes("--check-only");
const preview = args.includes("--preview");

function runNodeScript(script, scriptArgs = []) {
  const result = spawnSync("node", [script, ...scriptArgs], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runVercel() {
  const vercelArgs = preview ? ["deploy"] : ["deploy", "--prod"];
  console.log(`\n[deploy] npx vercel ${vercelArgs.join(" ")}\n`);

  const result = spawnSync("npx", ["vercel", ...vercelArgs], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status !== 0) {
    console.error("\n[deploy] Vercel deploy başarısız.");
    console.error("  - Vercel CLI giriş: npx vercel login");
    console.error("  - Projeye bağlı mı: npx vercel link");
    process.exit(result.status ?? 1);
  }
}

console.log("\n=== Rekabetli deploy ===\n");

runNodeScript(path.join("scripts", "deploy-check.mjs"));

if (checkOnly) {
  console.log("[deploy] --check-only: Vercel deploy atlandı.\n");
  process.exit(0);
}

runVercel();
console.log("\n[deploy] Tamamlandı.\n");
