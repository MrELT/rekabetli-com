/**
 * .env veya CI ortam değişkenlerinden → env-config.local.js
 * Yerel: node scripts/inject-env.mjs  |  Vercel build: npm run env:build
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const outPath = path.join(root, "env-config.local.js");

function parseEnvFile(content) {
  const vars = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

function loadDotEnv() {
  if (!fs.existsSync(envPath)) return {};
  return parseEnvFile(fs.readFileSync(envPath, "utf8"));
}

const fileVars = loadDotEnv();
const url = process.env.SUPABASE_URL?.trim() || fileVars.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_ANON_KEY?.trim() || fileVars.SUPABASE_ANON_KEY?.trim();

if (!url || !key) {
  console.error(
    "SUPABASE_URL ve SUPABASE_ANON_KEY gerekli.\n" +
      "  Yerel: .env dosyası\n" +
      "  Vercel: Project Settings → Environment Variables"
  );
  process.exit(1);
}

const output = `// Otomatik üretildi — npm run env:build (yerel .env veya Vercel CI)
// env-config.js bu dosyayı yükledikten sonra __applyRekabetliEnv__ çağırır.
(function () {
  if (typeof window.__applyRekabetliEnv__ === "function") {
    window.__applyRekabetliEnv__({
      SUPABASE_URL: ${JSON.stringify(url)},
      SUPABASE_ANON_KEY: ${JSON.stringify(key)},
    });
  } else {
    window.__ENV__ = {
      SUPABASE_URL: ${JSON.stringify(url)},
      SUPABASE_ANON_KEY: ${JSON.stringify(key)},
    };
    window.__ENV_READY__ = true;
    try {
      window.dispatchEvent(new CustomEvent("rekabetli-env-ready", { detail: window.__ENV__ }));
    } catch (_) {}
  }
})();
`;

fs.writeFileSync(outPath, output, "utf8");
console.log("env-config.local.js oluşturuldu.");
