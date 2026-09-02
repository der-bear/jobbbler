import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./src/server/security-headers";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  outputFileTracingIncludes: {
    "/*": ["../../migrations/sqlite/*.sql", "../../migrations/postgres/*.sql"],
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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: Object.entries(securityHeaders()).map(([key, value]) => ({ key, value })),
      },
    ];
  },
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
