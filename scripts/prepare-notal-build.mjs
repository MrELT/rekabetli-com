/**
 * Production'da NotAl kapalıysa (NOTAL_ACCESS=off veya NOTAL_BUILD=0)
 * route klasörlerini build dışında bırakır → Node bellek / bundle düşer.
 * Local `next dev` bu script'i çalıştırmaz; NotAl her zaman localde vardır.
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const stashRoot = path.join(root, ".notal-build-stash");

const targets = [
  { live: path.join(root, "app", "notal"), stash: path.join(stashRoot, "app-notal") },
  {
    live: path.join(root, "app", "api", "notal"),
    stash: path.join(stashRoot, "api-notal"),
  },
];

function shouldInclude() {
  if (process.env.NOTAL_BUILD === "0") return false;
  if (process.env.NOTAL_BUILD === "1") return true;

  const access = (process.env.NOTAL_ACCESS || "").trim().toLowerCase();
  if (access === "off") return false;

  // Vercel + eski kill-switch: açıkça live değilse ve ACCESS boşsa admin build'e dahil
  if (process.env.NOTAL_LIVE_ENABLED === "true") return true;
  if (access === "public" || access === "admin" || !access) return true;

  return true;
}

function restoreIfStashed() {
  for (const target of targets) {
    if (fs.existsSync(target.stash) && !fs.existsSync(target.live)) {
      fs.mkdirSync(path.dirname(target.live), { recursive: true });
      fs.renameSync(target.stash, target.live);
      console.log(`[notal-build] restored ${path.relative(root, target.live)}`);
    }
  }
  if (fs.existsSync(stashRoot)) {
    try {
      fs.rmdirSync(stashRoot);
    } catch {
      /* stash hâlâ dolu olabilir */
    }
  }
}

function stashForBuild() {
  fs.mkdirSync(stashRoot, { recursive: true });
  for (const target of targets) {
    if (!fs.existsSync(target.live)) continue;
    if (fs.existsSync(target.stash)) {
      fs.rmSync(target.stash, { recursive: true, force: true });
    }
    fs.renameSync(target.live, target.stash);
    console.log(`[notal-build] stashed ${path.relative(root, target.live)}`);
  }

  // middleware matcher kalsın; off modunda zaten 404
}

const mode = process.argv[2] || "prepare";

if (mode === "restore") {
  restoreIfStashed();
  process.exit(0);
}

// prepare
restoreIfStashed();
if (!shouldInclude()) {
  stashForBuild();
  console.log("[notal-build] NotAl production build dışında (bellek tasarrufu).");
} else {
  console.log("[notal-build] NotAl build'e dahil.");
}
