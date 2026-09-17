import type { NextConfig } from "next";

// Static export: one bundle that FastAPI can serve (Shape A) or Vercel can host (Shape B).
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
