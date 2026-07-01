import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "sharp", "@napi-rs/canvas"],
};

export default nextConfig;
