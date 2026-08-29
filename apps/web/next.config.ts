import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@jobbbler/contracts",
    "@jobbbler/core-domain",
    "@jobbbler/jobs-domain",
    "@jobbbler/storage",
    "@jobbbler/storage-postgres",
    "@jobbbler/storage-sqlite",
    "@jobbbler/ui",
    "@jobbbler/webmcp",
  ],
};

export default nextConfig;
