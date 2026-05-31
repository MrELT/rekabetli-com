import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesManifest = path.join(root, ".next", "routes-manifest.json");
const publicIndex = path.join(root, "public", "index.html");
const publicEnv = path.join(root, "public", "env-config.local.js");

const missing = [];
if (!fs.existsSync(routesManifest)) {
  missing.push(".next/routes-manifest.json (Next.js build çıktısı yok)");
}
if (!fs.existsSync(publicIndex)) {
  missing.push("public/index.html (statik sync yapılmamış)");
}
if (!fs.existsSync(publicEnv)) {
  missing.push("public/env-config.local.js (env inject yapılmamış)");
}

if (missing.length) {
  console.error("\n[rekabetli] Build doğrulaması BAŞARISIZ:");
  for (const item of missing) {
    console.error(`  - ${item}`);
  }
  console.error(
    "\nVercel'de Build Command override kapalı olmalı ve `npm run build` çalışmalı.\n",
  );
  process.exit(1);
}

console.log("[rekabetli] Build doğrulaması OK (Next.js + statik dosyalar hazır).");
