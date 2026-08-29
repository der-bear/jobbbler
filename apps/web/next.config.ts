import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  outputFileTracingIncludes: {
    "/*": ["../../migrations/sqlite/*.sql"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["better-sqlite3"],
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
  webpack(configuration) {
    configuration.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    return configuration;
  },
};

export default nextConfig;
