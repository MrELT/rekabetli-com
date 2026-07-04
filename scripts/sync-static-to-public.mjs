/**
 * Kök dizindeki statik site dosyalarını Next.js public/ klasörüne kopyalar.
 * Vercel build ve yerel `next dev` ile rekabetli.com/ + /notal birlikte çalışır.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");

const ROOT_JS = new Set([
  "admin.js",
  "app.js",
  "auth-store.js",
  "avatar-utils.js",
  "comment-ratings.js",
  "comment-replies.js",
  "communities-form.js",
  "communities.js",
  "community-feed.js",
  "competitions.js",
  "confirm-dialog.js",
  "env-config.js",
  "env-config.example.js",
  "feed-drafts.js",
  "feed-edit.js",
  "feed-skeleton.js",
  "forgot-password.js",
  "image-compression.js",
  "image-upload-limit.js",
  "login.js",
  "mentor-application.js",
  "mentor-public.js",
  "mentor-messaging.js",
  "mentor-sayfam.js",
  "mentor-vitrin-utils.js",
  "mentors-list.js",
  "mentorship-request.js",
  "nav-auth.js",
  "nav-profile.js",
  "notifications.js",
  "package-request.js",
  "profile.js",
  "quill-editor.js",
  "register.js",
  "reset-password.js",
  "security-utils.js",
  "site-footer.js",
  "supabase-client.js",
  "unsubscribe.js",
]);

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

fs.mkdirSync(publicDir, { recursive: true });

for (const name of fs.readdirSync(root)) {
  if (!name.endsWith(".html")) continue;
  copyFile(path.join(root, name), path.join(publicDir, name));
}

for (const name of ROOT_JS) {
  const src = path.join(root, name);
  if (fs.existsSync(src)) {
    copyFile(src, path.join(publicDir, name));
  }
}

const stylesPath = path.join(root, "styles.css");
if (fs.existsSync(stylesPath)) {
  copyFile(stylesPath, path.join(publicDir, "styles.css"));
}

const assetsPath = path.join(root, "assets");
if (fs.existsSync(assetsPath)) {
  copyDir(assetsPath, path.join(publicDir, "assets"));
}

const envLocal = path.join(root, "env-config.local.js");
if (fs.existsSync(envLocal)) {
  copyFile(envLocal, path.join(publicDir, "env-config.local.js"));
}

console.log("Statik dosyalar public/ klasörüne kopyalandı.");
