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

const publicDir = path.join(root, "public");
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "env-config.local.js"), output, "utf8");

/** Next.js — istemci + sunucu ortam değişkenleri (.env.local) */
function upsertEnvLocal(supabaseUrl, anonKey, fileVars) {
  const envLocalPath = path.join(root, ".env.local");

  const pick = (name) =>
    process.env[name]?.trim() || fileVars[name]?.trim() || "";

  const inject = {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: anonKey,
  };

  const serviceRole = pick("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = pick("OPENAI_API_KEY");
  const openaiModel = pick("OPENAI_MODEL");
  const googleClientId = pick("GOOGLE_CLIENT_ID");
  const googleClientSecret = pick("GOOGLE_CLIENT_SECRET");
  const googleRedirect = pick("GOOGLE_REDIRECT_URI");
  const siteUrl = pick("NEXT_PUBLIC_SITE_URL");

  if (serviceRole) inject.SUPABASE_SERVICE_ROLE_KEY = serviceRole;
  if (openaiKey) inject.OPENAI_API_KEY = openaiKey;
  if (openaiModel) inject.OPENAI_MODEL = openaiModel;
  if (googleClientId) inject.GOOGLE_CLIENT_ID = googleClientId;
  if (googleClientSecret) inject.GOOGLE_CLIENT_SECRET = googleClientSecret;
  if (googleRedirect) inject.GOOGLE_REDIRECT_URI = googleRedirect;
  if (siteUrl) inject.NEXT_PUBLIC_SITE_URL = siteUrl;

  const lines = fs.existsSync(envLocalPath)
    ? fs.readFileSync(envLocalPath, "utf8").split(/\r?\n/)
    : [];

  const keys = new Set(Object.keys(inject));
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return true;
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    return !keys.has(key);
  });

  for (const [key, value] of Object.entries(inject)) {
    kept.push(`${key}=${value}`);
  }

  fs.writeFileSync(
    envLocalPath,
    `${kept.filter((line) => line !== "").join("\n")}\n`,
    "utf8",
  );
}

upsertEnvLocal(url, key, fileVars);

console.log("env-config.local.js oluşturuldu.");
