/**
 * next dev sarmalayıcı.
 *
 * Node'un varsayılan HTTP başlık limiti 16 KB. localhost'ta birikmiş çerezler +
 * Authorization JWT bu limiti aşınca istek route'a hiç ulaşmadan 431 döner ve
 * Next log'una da düşmez (sessiz hata). Yerelde limiti yükseltip bu tuzağı kapatıyoruz.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const MAX_HEADER_SIZE = 65536;
const flag = `--max-http-header-size=${MAX_HEADER_SIZE}`;

const child = spawn(
  process.execPath,
  [flag, nextBin, "dev", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // Next'in ayrı süreçte başlattığı sunucu da aynı limiti kullansın.
      NODE_OPTIONS: [process.env.NODE_OPTIONS, flag].filter(Boolean).join(" "),
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
