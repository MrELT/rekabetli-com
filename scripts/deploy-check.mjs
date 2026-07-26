/**
 * Canlıya çıkmadan önce ortam, gizlilik ve build doğrulaması.
 * Kullanım: node scripts/deploy-check.mjs [--skip-build]
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const SECRET_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]?[A-Za-z0-9._-]{20,}/,
  /OPENAI_API_KEY\s*=\s*['"]?sk-[A-Za-z0-9]{10,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];

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

function loadEnv() {
  const fileVars = fs.existsSync(path.join(root, ".env"))
    ? parseEnvFile(fs.readFileSync(path.join(root, ".env"), "utf8"))
    : {};
  const pick = (name) => process.env[name]?.trim() || fileVars[name]?.trim() || "";
  return {
    SUPABASE_URL: pick("SUPABASE_URL"),
    SUPABASE_ANON_KEY: pick("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: pick("SUPABASE_SERVICE_ROLE_KEY"),
    OPENAI_API_KEY: pick("OPENAI_API_KEY"),
  };
}

function fail(message) {
  console.error(`\n[deploy-check] HATA: ${message}`);
  process.exit(1);
}

function warn(message) {
  console.warn(`[deploy-check] UYARI: ${message}`);
}

function ok(message) {
  console.log(`[deploy-check] OK: ${message}`);
}

function scanTrackedPublicForSecrets() {
  const publicDir = path.join(root, "public");
  if (!fs.existsSync(publicDir)) return;

  const offenders = [];
  for (const name of fs.readdirSync(publicDir)) {
    if (!/\.(html|js|css|json)$/i.test(name)) continue;
    if (name === "env-config.local.js") continue;
    const full = path.join(publicDir, name);
    if (!fs.statSync(full).isFile()) continue;
    const content = fs.readFileSync(full, "utf8");
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        offenders.push(name);
        break;
      }
    }
  }

  if (offenders.length) {
    fail(`public/ içinde gizli anahtar benzeri içerik: ${offenders.join(", ")}`);
  }
  ok("public/ dosyalarında gizli anahtar taraması temiz");
}

function ensureGitignoredSecrets() {
  const gitignorePath = path.join(root, ".gitignore");
  const gitignore = fs.readFileSync(gitignorePath, "utf8");
  const required = [".env", "env-config.local.js", "public/env-config.local.js"];
  for (const entry of required) {
    if (!gitignore.includes(entry)) {
      fail(`.gitignore içinde ${entry} yok — gizli dosyalar repoya girebilir`);
    }
  }
  ok(".gitignore gizli env dosyalarını kapsıyor");
}

function runBuild() {
  console.log("\n[deploy-check] npm run build çalıştırılıyor…\n");
  const result = spawnSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail("Build başarısız — deploy iptal");
  }
  ok("Production build başarılı");
}

const skipBuild = process.argv.includes("--skip-build");
const env = loadEnv();

console.log("\n=== Rekabetli deploy ön kontrol ===\n");

if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
  fail(
    "SUPABASE_URL ve SUPABASE_ANON_KEY gerekli (.env veya ortam değişkeni).\n" +
      "Vercel → Settings → Environment Variables",
  );
}
ok("Supabase URL + anon key mevcut");

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  warn("SUPABASE_SERVICE_ROLE_KEY yok — bazı sunucu API'leri çalışmaz");
}

ensureGitignoredSecrets();
scanTrackedPublicForSecrets();

if (!skipBuild) {
  runBuild();
}

console.log("\n=== Ön kontrol tamam ===\n");
console.log("Vercel ortam değişkenleri (Production):");
console.log("  - SUPABASE_URL");
console.log("  - SUPABASE_ANON_KEY");
console.log("  - SUPABASE_SERVICE_ROLE_KEY (sunucu API'leri)");
console.log("\nSupabase SQL (henüz çalıştırmadıysanız):");
console.log("  - supabase-community-bento-stats.sql (ana sayfa bento)");
console.log("\nDeploy: npm run deploy\n");
