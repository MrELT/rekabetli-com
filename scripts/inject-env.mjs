/**
 * .env → env-config.js (tarayıcıda okunur)
 * Kullanım: node scripts/inject-env.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const outPath = path.join(root, "env-config.js");

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

if (!fs.existsSync(envPath)) {
  console.error(".env bulunamadı. .env.example dosyasını .env olarak kopyalayıp doldurun.");
  process.exit(1);
}

const vars = parseEnvFile(fs.readFileSync(envPath, "utf8"));
const url = vars.SUPABASE_URL;
const key = vars.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(".env içinde SUPABASE_URL ve SUPABASE_ANON_KEY zorunludur.");
  process.exit(1);
}

const output = `// Otomatik üretildi — scripts/inject-env.mjs (.env dosyasından)
// Bu dosyayı düzenlemeyin; .env değişince scripti yeniden çalıştırın.
window.__ENV__ = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)},
};
`;

fs.writeFileSync(outPath, output, "utf8");
console.log("env-config.js oluşturuldu.");
