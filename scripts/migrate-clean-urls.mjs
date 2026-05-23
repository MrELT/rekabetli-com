/**
 * Dahili .html linklerini clean URL'lere çevirir (tek seferlik migrasyon).
 * node scripts/migrate-clean-urls.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REPLACEMENTS = [
  ["kullanici-sozlesmesi.html", "/kullanici-sozlesmesi"],
  ["yarisma-bilgileri.html", "/yarisma-bilgileri"],
  ["sinav-bilgileri.html", "/sinav-bilgileri"],
  ["kimler-icin.html", "/kimler-icin"],
  ["community.html", "/community"],
  ["communities.html", "/communities"],
  ["competitions.html", "/competitions"],
  ["hakkimizda.html", "/hakkimizda"],
  ["register.html", "/register"],
  ["profile.html", "/profile"],
  ["mentors.html", "/mentors"],
  ["acik-riza.html", "/acik-riza"],
  ["login.html", "/login"],
  ["exams.html", "/exams"],
  ["kvkk.html", "/kvkk"],
  ["index.html", "/"],
];

const TARGET_DIRS = [root];
const EXTENSIONS = new Set([".html", ".js", ".ts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "supabase/.temp"]);

function shouldProcess(filePath) {
  const ext = path.extname(filePath);
  if (!EXTENSIONS.has(ext)) return false;
  const rel = path.relative(root, filePath);
  if (rel.includes("migrate-clean-urls")) return false;
  return true;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || rel.startsWith("supabase" + path.sep + ".temp")) continue;
      walk(full, files);
      continue;
    }
    if (shouldProcess(full)) files.push(full);
  }
  return files;
}

function migrateContent(content) {
  let next = content;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  return next;
}

const files = walk(root);
let changed = 0;

for (const file of files) {
  const before = fs.readFileSync(file, "utf8");
  const after = migrateContent(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed += 1;
    console.log("updated:", path.relative(root, file));
  }
}

console.log(`Done. ${changed} file(s) updated.`);
