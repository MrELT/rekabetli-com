import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

function staticHtmlRewrites(): { source: string; destination: string }[] {
  const publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) return [];

  return fs
    .readdirSync(publicDir)
    .filter((name) => name.endsWith(".html") && name !== "index.html")
    .map((name) => ({
      source: `/${name.replace(/\.html$/i, "")}`,
      destination: `/${name}`,
    }));
}

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/r/:code",
        destination: "/?ref=:code",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      ...staticHtmlRewrites(),
      {
        source: "/odeme/basarili",
        destination: "/odeme/basarili/index.html",
      },
    ];
  },
};

export default nextConfig;
