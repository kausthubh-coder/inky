import type { NextConfig } from "next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const landingRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: join(landingRoot, ".."),
  env: {
    NEXT_PUBLIC_ANALYTICS_ENV: process.env.VERCEL_ENV ?? "development",
  },
};

export default nextConfig;
