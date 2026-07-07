/**
 * lib/turkish-bank-codes.ts → turkish-bank-codes.js (tarayıcı IIFE)
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const entry = path.join(root, "lib", "turkish-bank-codes.ts");
const outfile = path.join(root, "turkish-bank-codes.js");

if (!fs.existsSync(entry)) {
  console.warn("lib/turkish-bank-codes.ts bulunamadı, derleme atlandı.");
  process.exit(0);
}

execSync(
  `npx --yes esbuild "${entry}" --bundle --format=iife --global-name=RekabetliTurkishBanks --outfile="${outfile}" --target=es2020`,
  { cwd: root, stdio: "inherit" },
);

console.log("turkish-bank-codes.js oluşturuldu.");
