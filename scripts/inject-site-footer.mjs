import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tag = '    <script src="site-footer.js"></script>\n';

for (const name of fs.readdirSync(root)) {
  if (!name.endsWith(".html")) continue;
  const file = path.join(root, name);
  let html = fs.readFileSync(file, "utf8");
  if (html.includes("site-footer.js")) continue;
  if (!html.includes("</body>")) continue;
  html = html.replace("</body>", `${tag}  </body>`);
  fs.writeFileSync(file, html, "utf8");
  console.log("updated", name);
}
